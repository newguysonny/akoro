/**
 * study-prep/teaching-handoff.js — Study Prep → Teaching → Study Prep
 * (Phase 6, 2026-10-20). Everything injectable; wiring.js supplies the real
 * engine, queries and Study Prep calls.
 *
 *   1. propose   an Agent Check came in below the pass mark: a teaching
 *                workflow (child of the Study Prep one) is offered on the card,
 *                on what the agent couldn't answer
 *   2. approve   the learner confirms — or, after a minute, it approves itself:
 *                the start_teaching_session step creates the session, which
 *                waits on the learner's dashboard
 *   3. bind      the learner opens it from the dashboard (the normal teaching
 *                modal): the live socket session is tied to the workflow
 *   4. progress  each part taught is told to Study Prep (its card and chat follow)
 *   5. finish    the learner ends it: its outcome goes back to Study Prep, which
 *                unlocks the retest (it starts by itself a minute later)
 *
 * The parent hears about the child only through learner-visible events on its
 * own workflow (what its card and chat already read) and the engine's
 * outcome hook (onChildOutcome). Every line the learner sees is code-written
 * from the facts — no model call, no cost — except the wake after the session.
 */
import { autoApproveAt, dueForAutoApprove, handoffFromCheck, OPEN_TEACHING_STATES, teachingOutcome, teachingProgress, teachingView } from "../teaching-session/workflow.js";

export const START_TEACHING_TOOL = "teaching.start_session";
/** The tool row for following a live session (started, each part taught). */
export const TRACK_TEACHING_TOOL = "teaching.track_session";
const list = (items) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

export function makeTeachingHandoff({ engine, findOpen, listDueProposals, studyPrep, now = () => new Date().toISOString(), log = console }) {
  const quiet = (what) => (error) => { log.warn?.(`[teaching-handoff] ${what} failed: ${error?.message || error}`); return null; };

  /** Learner-visible events on the Study Prep workflow (its card and chat read them). */
  const toParent = (parentId, event) => (parentId ? engine.appendEvent(parentId, { actor: "system", visibility: "learner", ...event }).catch(quiet(event.event_type)) : null);

  /** A short code-written run in the Study Prep chat: its own message, a tool row, what it means. */
  async function run(child, { trigger, label, tool, headline, resultLine, message, extra = [] }) {
    const m = child.metadata || {};
    const parentId = child.parent_workflow_id;
    if (!parentId) return;
    const wakeId = `${trigger}:${Date.now().toString(36)}`;
    await studyPrep.openWake?.({ sessionId: m.studyPrepSessionId, learnerId: child.learner_id, wakeId, trigger, label }).catch(quiet("wake message"));
    const mark = (phase) => toParent(parentId, {
      event_type: phase === "completed" ? "operation.completed" : "operation.started", category: "action", operation: "wake", actor: "agent",
      payload: { operation: "wake", wakeId, trigger, label },
    });
    await mark("started");
    if (tool) {
      await toParent(parentId, { event_type: "tool.started", category: "action", actor: "agent", payload: { tool, iteration: 1, narrative: headline } });
      await toParent(parentId, { event_type: "tool.completed", category: "action", actor: "agent", payload: { tool, iteration: 1, narrative: headline, resultLine } });
    }
    for (const event of extra) await toParent(parentId, event);
    if (message) await toParent(parentId, { event_type: "activity", category: "synthesis", actor: "agent", payload: { message } });
    await mark("completed");
  }

  /** 1. Offer a teaching session on what the check missed. → view | null */
  async function propose({ session, topic, outcome, gaps = [] }) {
    const handoff = handoffFromCheck({ outcome, topic, gaps });
    const parentId = session?.workflowId || session?.workflow_id || null;
    const learnerId = session?.learnerId || session?.learner_id || null;
    if (!handoff || !parentId || !learnerId) return null;
    // One open session per topic: a second miss keeps the one already offered or waiting.
    const open = await findOpen(parentId, topic.id).catch(() => null);
    if (open) return teachingView(open);
    const proposedAt = now();
    const made = await engine.create({
      workflowType: "teaching", learnerId, entryMode: "study_prep_handoff", state: "proposed",
      parent: parentId, source: { workflowId: parentId, topicId: topic.id, reason: "teach_back" },
      idempotencyKey: `teach_back:${topic.id}:${Number(topic.attemptsUsed ?? topic.attempts_used) || 0}`,
      metadata: {
        topic: handoff.topic, subject: session.subject || null, focus: handoff.focus,
        studyPrepSessionId: session.id, topicId: topic.id, fromLabel: `Study Prep · ${session.subject || "your plan"}`,
        proposedAt, autoApproveAt: autoApproveAt(proposedAt),
      },
    }).catch(quiet("propose"));
    const child = made?.instance;
    if (!child) return null;
    if (made.created) {
      await engine.appendEvent(child.id, { event_type: "workflow.created", actor: "system", visibility: "learner", payload: { label: "Teaching session", topic: handoff.topic, focus: handoff.focus } }).catch(quiet("child created"));
      await toParent(parentId, {
        event_type: "learner.action_required", category: "teaching",
        payload: {
          kind: "teaching_handoff", teachingWorkflowId: child.id, topicId: topic.id, topic: handoff.topic, focus: handoff.focus,
          autoApproveAt: child.metadata.autoApproveAt, label: "Confirm the teaching session",
          narrative: `A teaching session on ${handoff.topic} — confirm it, or it's set up by itself in a minute`,
        },
      });
    }
    return teachingView(child);
  }

  /** 2. Confirmed (or a minute passed): start_teaching_session — it waits on the dashboard. */
  async function approve({ workflowId, learnerId, auto = false }) {
    const child = await engine.get(workflowId, learnerId);
    if (!child || child.workflow_type !== "teaching") return null;
    if (child.state !== "proposed") return teachingView(child);   // already done — idempotent
    const moved = await engine.transition(child.id, { from: "proposed", to: "scheduled", patch: { metadata: { approvedAt: now(), approvedBy: auto ? "auto" : "learner" } } });
    if (!moved) return teachingView(await engine.get(workflowId, learnerId));   // raced: the other one did it
    const m = moved.metadata || {};
    await engine.appendEvent(moved.id, { event_type: "workflow.state_changed", actor: auto ? "system" : "learner", visibility: "learner", payload: { from: "proposed", to: "scheduled", narrative: "Waiting on your dashboard" } }).catch(quiet("child scheduled"));
    const focus = m.focus?.length ? ` — ${list(m.focus.map((f) => f.toLowerCase()))}` : "";
    await run(moved, {
      trigger: "teaching_created", label: auto ? "The teaching session was set up" : "You approved the teaching session",
      tool: START_TEACHING_TOOL, headline: `Teaching session created: ${m.topic}`, resultLine: "On your dashboard",
      extra: [{ event_type: "workflow.handoff_created", category: "teaching", payload: { teachingWorkflowId: moved.id, topicId: m.topicId, topic: m.topic, focus: m.focus || [], narrative: `Teaching session on ${m.topic}: on your dashboard` } }],
      message: `Your teaching session on ${m.topic} is on your dashboard. Open it there and teach me what I missed${focus}. I'll follow along here, and my retest starts by itself a minute after you finish.`,
    });
    return teachingView(moved);
  }

  /** The sweep: proposals nobody tapped for a minute approve themselves. */
  async function autoApproveDue({ nowMs = Date.now() } = {}) {
    let approved = 0;
    for (const row of (await listDueProposals(new Date(nowMs).toISOString()).catch(() => [])) || []) {
      if (!dueForAutoApprove(row, nowMs)) continue;
      if (await approve({ workflowId: row.id, learnerId: row.learner_id, auto: true }).catch(quiet("auto-approve"))) approved += 1;
    }
    return { approved };
  }

  /** The topic left this path (taught elsewhere, moved on, set aside, plan cancelled): close its session. */
  async function cancelFor({ parentId, topicId, reason = "topic_moved_on" }) {
    const open = await findOpen(parentId, topicId).catch(() => null);
    if (!open) return null;
    const done = await engine.cancel(open.id, reason).catch(quiet("cancel"));
    if (done) await toParent(parentId, { event_type: "workflow.handoff_completed", category: "teaching", payload: { teachingWorkflowId: open.id, topicId, cancelled: true, reason, narrative: `The teaching session on ${open.metadata?.topic || "this topic"} was closed` } });
    return done ? teachingView(done) : null;
  }

  /** 3. The dashboard opened it in the teaching modal: tie the live session to it. → view (with its focus) | null */
  async function bind({ workflowId, learnerId, liveSessionId }) {
    const child = await engine.get(workflowId, learnerId);
    if (!child || child.workflow_type !== "teaching" || !OPEN_TEACHING_STATES.includes(child.state)) return null;
    if (child.state === "scheduled") {
      const moved = await engine.transition(child.id, { from: "scheduled", to: "teaching_active", patch: { metadata: { liveSessionId, startedAt: now() } } });
      if (moved) {
        const m = moved.metadata || {};
        await engine.appendEvent(moved.id, { event_type: "workflow.started", actor: "learner", visibility: "learner", payload: { narrative: "You started teaching" } }).catch(quiet("child started"));
        // Its own run in the Study Prep chat; the card only re-reads its one tracking line.
        await run(moved, {
          trigger: "teaching_started", label: "You started teaching", tool: TRACK_TEACHING_TOOL,
          headline: `You started teaching ${m.topic}`, resultLine: m.focus?.length ? `${m.focus.length} part${m.focus.length === 1 ? "" : "s"}` : "",
          extra: [{ event_type: "teaching.phase_changed", category: "teaching", actor: "learner", payload: { teachingWorkflowId: moved.id, stage: "started", topic: m.topic, narrative: `You started teaching ${m.topic}` } }],
          message: m.focus?.length ? `I'm following along. First: ${m.focus[0].toLowerCase()}.` : "I'm following along.",
        });
        return teachingView(moved);
      }
    }
    // Resumed (a continuation, or a second device): just the newest live session.
    const annotated = await engine.annotate(child.id, { liveSessionId }).catch(quiet("rebind"));
    return teachingView(annotated || child);
  }

  /** The session's row was saved (the dashboard's Continue reopens it). */
  async function saved({ workflowId, adaptiveSessionId }) {
    if (!workflowId || !adaptiveSessionId) return null;
    return engine.annotate(workflowId, { adaptiveSessionId }).catch(quiet("saved"));
  }

  /** 4. A teaching turn: a drift changes tack; a part taught is told to Study Prep. */
  async function progress({ workflowId, result }) {
    const child = await engine.get(workflowId).catch(() => null);
    if (!child || !OPEN_TEACHING_STATES.includes(child.state) || child.state === "scheduled") return null;
    const previous = child.metadata?.progress || {};
    const p = teachingProgress(result, previous);
    let state = child.state;
    if (p.drift && state === "teaching_active") state = (await engine.transition(child.id, { from: state, to: "adapt_strategy", reason: "drift" }).catch(() => null))?.state || state;
    else if (!p.drift && state === "adapt_strategy") state = (await engine.transition(child.id, { from: state, to: "teaching_active" }).catch(() => null))?.state || state;
    const changed = p.part !== previous.part || p.of !== previous.of || p.done !== previous.done || p.phase !== previous.phase;
    if (changed) await engine.annotate(child.id, { progress: { part: p.part, of: p.of, done: p.done, phase: p.phase, mastery: p.mastery } }).catch(quiet("progress"));
    // A part taught (not every turn): its own run in the Study Prep chat — the tool row and what it means.
    if (p.milestone && p.done > (Number(previous.done) || 0)) {
      const m = child.metadata || {};
      const topic = m.topic || "this topic";
      const focus = Array.isArray(m.focus) ? m.focus : [];
      const narrative = p.of ? `Teaching ${topic}: ${p.done} of ${p.of} part${p.of === 1 ? "" : "s"} taught` : `Teaching ${topic}: a part taught`;
      const taught = focus[p.done - 1];
      const next = focus[p.done];
      await engine.appendEvent(child.id, { event_type: "teaching.phase_changed", category: "teaching", actor: "system", visibility: "learner", payload: { ...p, narrative } }).catch(quiet("child progress"));
      await run(child, {
        trigger: "teaching_progress", label: narrative, tool: TRACK_TEACHING_TOOL, headline: narrative, resultLine: taught || "",
        extra: [{ event_type: "teaching.phase_changed", category: "teaching", payload: { teachingWorkflowId: child.id, stage: "progress", topic, done: p.done, of: p.of, narrative } }],
        message: p.of && p.done >= p.of
          ? `That's every part${taught ? ` — ${taught.toLowerCase()} too` : ""}. End the session when you're ready, and my retest starts a minute later.`
          : `${taught ? `You've taught me ${taught.toLowerCase()}.` : "That part is taught."}${next ? ` Next: ${next.toLowerCase()}.` : ""}`,
      });
    }
    return p;
  }

  /**
   * 5. The learner ended it: assessment → completed, and the outcome goes to
   * Study Prep. A session that ended before any teaching stays open (the
   * dashboard offers it again).
   */
  async function finish({ workflowId, endResult = {}, notesAdded = 0 }) {
    const child = await engine.get(workflowId).catch(() => null);
    if (!child || !["teaching_active", "adapt_strategy"].includes(child.state)) return null;
    const outcome = teachingOutcome(endResult, { focus: child.metadata?.focus || [], notesAdded, progress: child.metadata?.progress || null });
    if (!outcome.taught) return { ignored: "nothing_taught", view: teachingView(child) };
    const assessing = await engine.transition(child.id, { from: child.state, to: "assessment" });
    if (!assessing) return null;
    const done = await engine.transition(child.id, { from: "assessment", to: "completed", patch: { metadata: { outcome, endedAt: now() } } });
    if (!done) return null;
    await engine.appendEvent(done.id, { event_type: "workflow.completed", actor: "learner", visibility: "learner", payload: { outcome, narrative: "Session finished" } }).catch(quiet("child completed"));
    await engine.emitOutcome(done.id, outcome).catch(quiet("outcome"));
    return { view: teachingView(done), outcome };
  }

  /** The dashboard's list: teaching sessions waiting for the learner. */
  async function listOpen(learnerId) {
    const rows = await engine.listForLearner(learnerId, { active: true }).catch(() => []);
    return rows.filter((r) => r.workflow_type === "teaching" && OPEN_TEACHING_STATES.includes(r.state)).map(teachingView);
  }

  /**
   * Study Prep's side of the outcome hook: the teach-back is confirmed (the
   * retest unlocks and starts a minute later), the card and chat hear it, and
   * the agent wakes on what was taught.
   */
  const controller = {
    async onChildOutcome(parent, { child, outcome }) {
      const m = child.metadata || {};
      const sessionId = parent.metadata?.studyPrepSessionId || m.studyPrepSessionId;
      if (!sessionId || !m.topicId) return;
      await studyPrep.confirmTeachBack({ sessionId, learnerId: parent.learner_id, topicId: m.topicId }).catch(quiet("teach-back"));
      const parts = outcome.parts ? ` · ${outcome.partsDone ?? 0} of ${outcome.parts} parts` : "";
      await toParent(parent.id, {
        event_type: "workflow.handoff_completed", category: "teaching", actor: "learner",
        payload: { teachingWorkflowId: child.id, topicId: m.topicId, topic: m.topic, outcome, narrative: `You finished teaching ${m.topic}${parts}` },
      });
      studyPrep.wake?.({ sessionId, learnerId: parent.learner_id, trigger: "teaching_done", facts: { topic: m.topic, notesAdded: outcome.notesAdded, partsDone: outcome.partsDone, parts: outcome.parts } });
    },
  };

  return { propose, approve, autoApproveDue, cancelFor, bind, saved, progress, finish, listOpen, controller, findOpen };
}
