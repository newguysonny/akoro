/**
 * modules/agent-proposals/inbox.js — one inbox over the agent's two kinds of
 * suggestion (Grand Plan §7.16.8 step 1):
 *
 *   chat     public.agent_suggestions — `suggest_help` during a conversation
 *   planner  edu.agent_proposals      — the background cycle (Full Autonomy)
 *
 * Items carry a ref ("s:<id>" | "p:<id>") so one accept / dismiss door serves
 * both. The same suggestion offered by both sources shows once (newest kept),
 * and each source checks the other before adding a duplicate (openTitles).
 *
 * Accepting does what the kind says: a task becomes a task, a goal a goal
 * (agent-sourced, under the 10-goal cap), a conversation is handed back as
 * the message to start the chat with — never all of them turned into tasks.
 * Planner proposals keep their claim-first approve path (approveProposal).
 */
import db from "../../db.js";
import { executeChatTool } from "../adaptive-learning/chat.js";
import { createGoal } from "../learner-goals/service.js";
import { markPostedDecision, reportInChat } from "../autonomy/deliver.js";
import { spreadDue } from "../autonomy/readyKinds.js";

import { DISMISS_REASONS, reasonOf, normalizeTitle, mergeInbox, parseRef } from "./inboxCore.js";

export { DISMISS_REASONS, reasonOf, normalizeTitle, mergeInbox, parseRef };

const edu = () => db.schema("edu");
const now = () => new Date().toISOString();
const PENDING = "proposed";
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** The open inbox for one learner. */
export async function loadInbox(userId) {
  await edu().from("agent_proposals").update({ status: "expired", decided_at: now() })
    .eq("user_id", userId).eq("status", PENDING).lt("expires_at", now());
  const [s, p] = await Promise.all([
    db.from("agent_suggestions").select("*").eq("user_id", userId).eq("status", "open")
      .order("created_at", { ascending: false }).limit(50),
    edu().from("agent_proposals").select("*").eq("user_id", userId).eq("status", PENDING)
      .order("created_at", { ascending: false }).limit(50),
  ]);
  if (s.error || p.error) throw fail("Could not load your suggestions", 503);
  return mergeInbox({ suggestions: s.data || [], proposals: p.data || [] });
}

/** Normalised titles open in either inbox — each source skips what the other already offers. */
export async function openTitles(userId) {
  const [s, p] = await Promise.all([
    db.from("agent_suggestions").select("title").eq("user_id", userId).eq("status", "open").limit(100)
      .then((r) => r.data ?? []).catch(() => []),
    edu().from("agent_proposals").select("title").eq("user_id", userId).eq("status", PENDING).limit(100)
      .then((r) => r.data ?? []).catch(() => []),
  ]);
  return new Set([...s, ...p].map((r) => normalizeTitle(r.title)).filter(Boolean));
}

/* ── chat suggestions ─────────────────────────────────────────────────── */

/**
 * Accept one chat suggestion as what it is. → { kind, task? | goal? | prompt?, suggestion }
 * `asTask`: the legacy Tasks-tab route, whose UI says "added to your tasks" —
 * every kind becomes a task there until that UI moves to the inbox.
 */
export async function acceptChatSuggestion(userId, id, { asTask = false } = {}) {
  const { data: sg } = await db.from("agent_suggestions").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!sg || sg.status !== "open") throw fail("Suggestion not found", 404);
  const kind = !asTask && ["task", "goal", "conversation"].includes(sg.kind) ? sg.kind : "task";
  // Claim first: a double tap acts once.
  const { data: claimed } = await db.from("agent_suggestions")
    .update({ status: "accepted", resolved_at: now() })
    .eq("id", sg.id).eq("status", "open").select("*");
  if (!claimed?.length) throw fail("This suggestion was already decided.", 409);
  const reopen = () => db.from("agent_suggestions").update({ status: "open", resolved_at: null }).eq("id", sg.id).eq("status", "accepted");
  try {
    if (kind === "goal") {
      const r = await createGoal(userId, { title: sg.title }, { source: "agent" });
      if (r.error) throw fail(r.error, r.status || 400);
      const { data } = await db.from("agent_suggestions").update({ goal_id: r.goal.id }).eq("id", sg.id).select("*").single();
      return { kind, goal: r.goal, suggestion: data || claimed[0] };
    }
    if (kind === "conversation") {
      // Nothing to create: the learner starts the chat with it.
      return { kind, prompt: sg.title, suggestion: claimed[0] };
    }
    const { data: task, error } = await db.from("tasks").insert({
      creator_id: userId, agent_id: sg.agent_id,
      title: sg.title, description: sg.rationale || null,
      priority: "medium", status: "pending", task_type: "general",
    }).select().single();
    if (error) throw fail("Could not create the task", 503);
    const { data } = await db.from("agent_suggestions").update({ task_id: task.id }).eq("id", sg.id).select("*").single();
    global.io?.to(`user:${userId}`).emit("task:created", task);
    return { kind, task, suggestion: data || claimed[0] };
  } catch (e) {
    await reopen();   // still open: the learner can try again or dismiss it
    throw e;
  }
}

export async function dismissChatSuggestion(userId, id, reason) {
  const { data, error } = await db.from("agent_suggestions")
    .update({ status: "dismissed", resolved_at: now(), dismiss_reason: reasonOf(reason) })
    .eq("id", id).eq("user_id", userId).eq("status", "open").select();
  if (error) throw fail("Could not dismiss the suggestion", 503);
  if (!data?.length) throw fail("Suggestion not found", 404);
  return data[0];
}

/* ── planner proposals ────────────────────────────────────────────────── */

/** The ONE door from proposal to reality: claim-first, then the chat's own tool. */
export async function approveProposal(userId, id) {
  const { data: claimed, error: claimError } = await edu().from("agent_proposals")
    .update({ status: "approved", decided_at: now() })
    .eq("id", id).eq("user_id", userId).eq("status", PENDING)
    .select("*").maybeSingle();
  if (claimError) throw fail("Could not approve the proposal", 503);
  if (!claimed) throw fail("This proposal was already decided or has expired.", 404);

  const kind = claimed.kind;
  const payload = claimed.payload || {};
  try {
    let ref = null;
    let detail = null;
    if (kind === "task" || kind === "practice") {
      // The chat's own create_task — validation, autonomy scheduling and the
      // task:created socket broadcast ride along.
      const result = await executeChatTool("create_task", { priority: "medium", ...payload }, userId, { role: "student", channel: "proposal" });
      if (result?.needsClarification || result?.error) throw new Error(result.question || result.error || "The task could not be created.");
      ref = result?.taskId ?? null;
      detail = { taskId: ref, title: result?.title ?? claimed.title };
    } else if (kind === "session") {
      const result = await executeChatTool("schedule_chat_follow_up", payload, userId, { role: "student", channel: "proposal" });
      if (result?.needsClarification || result?.error) throw new Error(result.question || result.error || "The check-in could not be scheduled.");
      ref = result?.followUpId ?? result?.id ?? null;
      detail = { followUpId: ref, scheduledAt: result?.scheduledAt ?? payload?.scheduledAt ?? null };
    } else if (kind === "goal") {
      // The goals service: the same title rules and 10-goal cap as the app.
      const r = await createGoal(userId, { title: payload?.title || claimed.title, category: payload?.category, target_date: payload?.target_date }, { source: "agent" });
      if (r.error) throw new Error(r.error);
      ref = r.goal.id;
      detail = { goalId: ref, title: r.goal.title };
    } else if (kind === "goal_nudge") {
      // A first step toward a goal: the same create_task as chat.
      const { goalId, ...task } = payload;
      const result = await executeChatTool("create_task", { priority: "medium", ...task }, userId, { role: "student", channel: "proposal" });
      if (result?.needsClarification || result?.error) throw new Error(result.question || result.error || "The task could not be created.");
      ref = result?.taskId ?? null;
      detail = { taskId: ref, title: result?.title ?? payload.title, goalId: goalId || null };
    } else if (kind === "quiz_from_records") {
      // The reader builds the quiz from the whole document: approving opens it there (still theirs, not deleted).
      const { data: rec } = await db.schema("edu").from("records").select("id, name").eq("id", payload.recordId).eq("user_id", userId).is("deleted_at", null).maybeSingle();
      if (!rec) throw new Error("That document is no longer in your Library.");
      ref = rec.id;
      detail = { recordId: rec.id, recordName: rec.name, href: `/library?record=${rec.id}&tool=quiz` };
    } else if (kind === "teach_weak_topic") {
      detail = { teach: { topic: payload.topic, subject: payload.subject || null } };
    } else if (kind === "study_plan") {
      // Study Prep's own plan card and coin gate still apply (rule 7): this only starts the plan.
      const result = await executeChatTool("start_study_prep_session", { goal: String(payload.goal || claimed.title).slice(0, 300), ...(payload.subject ? { subject: payload.subject } : {}), ...(payload.examBoard ? { examBoard: payload.examBoard } : {}) }, userId, { role: "student", channel: "proposal" });
      if (result?.enabled === false || result?.error || !result?.sessionId) throw new Error(result?.error || result?.message || "The study plan could not be started.");
      ref = result.sessionId;
      detail = { sessionId: result.sessionId, status: result.status || null };
    } else if (kind === "revision_battle") {
      const { createCheckBattle } = await import("../battle/agentCheck.js");
      const r = await createCheckBattle({ learnerId: userId, subject: payload.subject || null, topic: payload.topic, total: 5, mode: "retest" });
      ref = r.battleId;
      detail = { battleId: r.battleId, placed: r.placed, title: r.title };
    } else if (kind === "follow_up_question") {
      // Continues as an ordinary chat turn: the app sends this as the learner's message.
      detail = { prompt: String(payload.prompt || "").slice(0, 300) };
    } else if (kind === "chase_missing") {
      // The instructor's own activity; only learners still not started, now.
      const { data: act } = await edu().from("self_study_assignments").select("id, title").eq("id", payload.assignmentId).eq("created_by", userId).maybeSingle();
      if (!act) throw new Error("That activity is no longer yours to chase.");
      const { data: still } = await edu().from("self_study_targets").select("student_id").eq("assignment_id", act.id).eq("status", "assigned")
        .in("student_id", (payload.studentIds || []).slice(0, 60));
      const { notifyUser } = await import("../notify.js");
      for (const t of still || []) {
        await notifyUser({ userId: t.student_id, type: "activity_reminder", relatedId: act.id, link: `/activities/${act.id}`,
          title: `Reminder from your teacher: "${String(act.title).slice(0, 80)}"`, content: "You haven't started it yet — open it when you're ready." }).catch(() => {});
      }
      ref = act.id;
      detail = { reminded: (still || []).length, title: act.title };
    } else if (kind === "revise_low_scores" || kind === "next_activity") {
      // A DRAFT through the instructor's own prepare_activity — assigning stays their tap.
      let topic = payload.topic;
      if (kind === "next_activity") {
        const { resolveTopics } = await import("../adaptive-learning/study-prep/syllabus-resolver.js");
        const { nextTopicAfter } = await import("../autonomy/instructorCore.js");
        const syllabus = await resolveTopics({ subject: payload.subject }).catch(() => []);
        topic = nextTopicAfter(payload.topic, syllabus);
      } else topic = `Revision: ${String(payload.topic).slice(0, 100)}`;
      const audience = payload.classroomId ? { classroom_id: payload.classroomId } : { user_ids: (payload.studentIds || []).slice(0, 60) };
      const result = await executeChatTool("prepare_activity", { type: "self_study", subject: payload.subject || undefined, topic, audience }, userId, { role: "instructor", channel: "proposal" });
      if (result?.needsClarification || result?.error || !result?.draftId) throw new Error(result?.question || result?.error || "The draft could not be prepared.");
      ref = result.draftId;
      detail = { draftId: result.draftId, title: result.title, draft: { id: result.draftId, title: result.title, type: result.type, audience: result.audience } };
    } else if (kind === "fix_it" && payload.fix === "overdue_tasks") {
      const { data: tasks } = await db.from("tasks").select("id, due_at").eq("creator_id", userId).in("id", (payload.taskIds || []).slice(0, 6)).in("status", ["pending", "queued"]);
      const moves = spreadDue(tasks || []);
      for (const m of moves) await db.from("tasks").update({ due_at: m.due_at }).eq("id", m.id).eq("creator_id", userId);
      detail = { moved: moves.length, days: Math.max(1, Math.ceil(moves.length / 2)) };
    } else {
      throw new Error(`"${kind}" proposals are not executable yet — dismiss it or start it yourself from its tab.`);
    }
    const { data: done, error: doneError } = await edu().from("agent_proposals")
      .update({ status: "executed", executed_ref: ref, decided_at: now() })
      .eq("id", claimed.id).eq("status", "approved").select("id").maybeSingle();
    if (doneError || !done) throw new Error("Could not record the approval.");
    await markPostedDecision(userId, claimed.id, "executed");
    // Report (§7.16.2): the result in the same thread it was offered in.
    const { data: tzRow } = await edu().from("learner_agent_autonomy").select("time_zone").eq("user_id", userId).maybeSingle();
    const report = await reportInChat(userId, claimed, { ...detail, timeZone: tzRow?.time_zone || "Africa/Lagos" });
    return { executed: true, kind, ...detail, ...(report ? { report } : {}) };
  } catch (execError) {
    // Released to a visible FAILED state — never back to proposed, never silent.
    await edu().from("agent_proposals")
      .update({ status: "failed", decision_note: String(execError.message).slice(0, 300), decided_at: now() })
      .eq("id", claimed.id).eq("status", "approved");
    await markPostedDecision(userId, claimed.id, "failed");
    throw fail(execError.message || "Could not execute the proposal.", 400);
  }
}

/** Dismiss with a taste reason the next cycle reads. */
export async function dismissProposal(userId, id, reason) {
  const why = reasonOf(reason);
  const { data, error } = await edu().from("agent_proposals")
    .update({ status: "dismissed", decision_note: why, decided_at: now() })
    .eq("id", id).eq("user_id", userId).eq("status", PENDING).select("id").maybeSingle();
  if (error) throw fail("Could not dismiss the proposal", 503);
  if (!data) throw fail("This proposal was already decided or has expired.", 404);
  await markPostedDecision(userId, id, "dismissed");
  return { dismissed: true, reason: why };
}

