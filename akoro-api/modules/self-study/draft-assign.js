/**
 * modules/self-study/draft-assign.js — THE approval. A draft's stored payload
 * is replayed through the one shared createAssignment path, so assigning from
 * the preview does the same insert, targets, notifications and ding as the
 * activities workbench. Only the human-facing routes reach this module.
 */

import db from "../../db.js";
import { callAsUser } from "../tasks/index.js";
import {
  announceFor, createAssignment, invalid,
} from "./createAssignment.js";
import {
  cleanReview, reviewInstruction, scheduleActivityReview,
} from "./activityReview.js";
import { saveToolDraft } from "./toolDrafts.js";
import {
  detailsFromVersion, latestReady, versionAt, versionsOf,
} from "./draftVersions.js";
import { assignGate } from "./markScheme.js";
import { resolveClassroomByName } from "./draft-store.js";
import { getActivityDraft } from "./draft-records.js";

/**
 * createJourneyBattle — a journey's battle stage, made for the journey's own learners.
 * It goes through the same invite endpoint the battle form and the task tool use, as the
 * instructor, so the battle behaves exactly as one set any other way. The learner side
 * reads the stage from the refs (kind "battle" + battleId) and unlocks the next stage when
 * the battle completes.
 */
async function createJourneyBattle(instructor, payload, st, audience = {}) {
  // Named learners within a class carry the class by NAME (the id is only kept for "everyone").
  const classId = payload.classroom_id || audience.classroom_id
    || (audience.class_name ? (await resolveClassroomByName(instructor.id, audience.class_name))?.id : null);
  if (!classId) throw invalid("A battle stage needs a class — pick one for this journey.", 400);
  let usernames = [...(payload.usernames ?? [])];
  if (!payload.whole_class) {
    if (payload.user_ids?.length) {
      const { data } = await db.from("users").select("username").in("id", payload.user_ids);
      usernames.push(...(data ?? []).map((u) => u.username).filter(Boolean));
    }
    usernames = [...new Set(usernames)];
    if (usernames.length < 2) throw invalid("A battle stage needs the whole class or at least two learners — a battle is learner against learner.", 400);
  }
  const { data: me } = await db.from("users").select("role, email").eq("id", instructor.id).maybeSingle();
  const out = await callAsUser(`/api/battle/classes/${classId}/battles/invite`, {
    userId: instructor.id, role: me?.role || instructor.role, email: me?.email,
    body: {
      title: st.title, topic: st.topic, subject: st.subject,
      difficulty: payload.difficulty || "intermediate",
      total_questions: st.questions || 5, time_limit_seconds: 15 * 60, xp_prize: 200, min_xp: 0,
      question_source: "auto",
      whole_class: !!payload.whole_class,
      usernames: payload.whole_class ? [] : usernames,
    },
  });
  const id = out?.data?.battle_id ?? out?.battle_id;
  if (!id) throw invalid(`The battle for "${st.title}" could not be created.`, 502);
  return { id };
}

/**
 * assignActivityDraft — THE approval. Replays the stored bench payload
 * through the one shared create path. For journeys, each stage is created
 * first (same path) and the parent travels with the real stage refs.
 * `overrides` lets the preview hand back human-edited fields.
 */
export async function assignActivityDraft({ instructor, id, overrides = null }) {
  const draft = await getActivityDraft(instructor, id);

  // A teaching resource has no learners: approving it saves it to the Library.
  if (draft.type === "teaching_tool") return { saved: await saveToolDraft(draft, { version: overrides?.version ?? null }) };

  // The due date: an exact one from the preview wins; a date the teacher only
  // said in words ("Friday 1 PM") must be pinned down before learners get it.
  if (overrides && typeof overrides === "object" && "due_at" in overrides && overrides.due_at != null) {
    const d = new Date(overrides.due_at);
    if (Number.isNaN(d.getTime())) throw invalid("That due date isn't a valid date.", 400);
    overrides = { ...overrides, due_at: d.toISOString() };
  }
  const dueAfter = overrides && "due_at" in overrides ? overrides.due_at : draft.payload?.due_at;
  if (!dueAfter && draft.payload?.due_hint && !["live_course", "battle", "multi_stage"].includes(draft.type)) {
    throw invalid(`Set the exact due date for "${draft.payload.due_hint}" before assigning.`, 409);
  }

  // Claim-first: win the draft atomically BEFORE creating anything, so two
  // rapid taps (or chat + the workbench strip) can never assign twice. The
  // winner carries the claim; losers get a clean 409.
  const { data: claim, error: claimErr } = await db.from("activity_drafts")
    .update({ status: "assigned", resolved_at: new Date().toISOString() })
    .eq("id", draft.id).eq("status", "draft")
    .select();
  if (claimErr) throw invalid(claimErr.message, 500);
  if (!claim?.length) throw invalid("This draft was already resolved", 409);

  // `review`: the review battle the activity comes with (self-study/activityReview.js).
  const { version: pickedVersion, review: reviewIn = undefined, ...rest } = overrides && typeof overrides === "object" ? overrides : {};
  const payload = { ...(draft.payload || {}), ...rest };
  const type = payload.type || draft.type;

  // An assignment with versions sends the one on screen (the newest ready
  // one when none is named) — unless the full edit form sent its own questions.
  if (versionsOf(draft.payload).length && !(Array.isArray(rest.details?.questions) && rest.details.questions.length)) {
    const v = pickedVersion != null ? versionAt(draft.payload, pickedVersion) : latestReady(draft.payload);
    if (!v || v.status !== "ready") {
      await db.from("activity_drafts").update({ status: "draft", resolved_at: null }).eq("id", draft.id).eq("status", "assigned");
      throw invalid(pickedVersion != null ? `Version ${pickedVersion} isn't ready to assign.` : "The questions are still being drafted — try again in a moment.", 409);
    }
    // Auto-grading on: the rubric must be there (and finished) before learners get the work.
    const gate = payload.details?.ai_auto_grade ? assignGate(v) : null;
    if (gate) {
      await db.from("activity_drafts").update({ status: "draft", resolved_at: null }).eq("id", draft.id).eq("status", "assigned");
      throw invalid(gate, 409);
    }
    payload.details = detailsFromVersion(payload.details, v);
    if (!payload.instructions && v.paper?.instructions) payload.instructions = v.paper.instructions;
  }
  delete payload.versions;
  delete payload.paper_request;
  delete payload.history;
  delete payload.history_current;

  // Battle drafts are completed through their battle form, not this path —
  // release the claim so the instructor can still finish it there.
  if (type === "battle") {
    await db.from("activity_drafts")
      .update({ status: "draft", resolved_at: null })
      .eq("id", draft.id).eq("status", "assigned");
    throw invalid("Battles are assigned from their battle form in the preview", 400);
  }

  let result;
  let review = null;
  try {
    // The review battle: checked before anything is created, so a bad time is a clear refusal.
    if (["assignment", "self_study", "project"].includes(type) && reviewIn !== undefined) {
      review = cleanReview(reviewIn, { dueAt: payload.due_at ?? null });
      // The questions its preview showed (Battle questions tab): the review battle asks exactly those.
      const prepared = draft.payload?.review_questions;
      if (review && Array.isArray(prepared?.items) && prepared.items.length) review.items = prepared.items.slice(0, review.questions);
      if (review) payload.instructions = [payload.instructions, reviewInstruction(review.at)].filter(Boolean).join("\n\n");
    }
    if (type === "multi_stage") {
    const stages = Array.isArray(payload.details?.stages) ? payload.details.stages.slice(0, 6) : [];
    if (!stages.length) throw invalid("The journey has no stages", 400);
    const refs = [];
    for (const st of stages) {
      if (st.refId || st.battleId) { refs.push(st); continue; }   // already-created stage ref
      if (st.kind === "battle") {
        const battle = await createJourneyBattle(instructor, payload, st, draft.audience || {});
        refs.push({ kind: "battle", battleId: battle.id, title: st.title, emoji: "\u2694\uFE0F" });
        continue;
      }
      const stageOut = await createAssignment(instructor, {
        type: st.kind || "self_study",
        title: st.title, subject: st.subject || "General", topic: st.topic || st.title,
        subtopics: st.subtopics ?? [], objectives: st.objectives ?? {},
        instructions: st.instructions ?? null, difficulty: payload.difficulty || "intermediate",
        due_at: payload.due_at ?? null,
        usernames: payload.usernames ?? [], user_ids: payload.user_ids ?? [],
        whole_class: payload.whole_class ?? false, classroom_id: payload.classroom_id ?? null,
      });
      refs.push({ kind: st.kind || "self_study", refId: stageOut.assignment.id, title: st.title });
    }
    result = await createAssignment(instructor, {
      type: "multi_stage",
      title: payload.title, subject: payload.subject, topic: payload.topic,
      instructions: payload.instructions || `A ${refs.length}-step journey: ${refs.map(r => r.title).join(" → ")}`,
      due_at: payload.due_at ?? null,
      details: { stages: refs },
      usernames: payload.usernames ?? [], user_ids: payload.user_ids ?? [],
      whole_class: payload.whole_class ?? false, classroom_id: payload.classroom_id ?? null,
    });
  } else {
    result = await createAssignment(instructor, payload);
  }
  } catch (e) {
    // Creation failed after the claim — release it so the human can fix the
    // draft (edit the audience, set the missing schedule) and try again. A
    // claim that 409s forever would be worse than the race it prevented.
    await db.from("activity_drafts")
      .update({ status: "draft", resolved_at: null })
      .eq("id", draft.id).eq("status", "assigned");
    throw e;
  }

  // Status was claimed up front; only the provenance link remains. If this
  // fails the assignment still stands (learners were notified) — it is a log.
  const { error } = await db.from("activity_drafts")
    .update({ assignment_id: result.assignment.id })
    .eq("id", draft.id);
  if (error) console.warn("[drafts] assign bookkeeping failed:", error.message);

  // Queue the review battle's runs (the assignment stands even if this fails: it is logged).
  if (review) {
    review = await scheduleActivityReview(result.assignment, review).catch((e) => { console.error("[drafts] review battle not scheduled:", e.message); return null; });
  }
  return { ...result, review, announce: announceFor(type) };
}
