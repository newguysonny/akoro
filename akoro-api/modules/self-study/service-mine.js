/**
 * modules/self-study/service-mine.js — the learner's own view: what has been
 * assigned (including multi-stage journeys and their sequential unlocking)
 * and the activity streak. Reads only, scoped to the caller.
 */
import { briefForLearner, pdfMeta } from "./submissionView.js";
import { ok } from "./http.js";
import * as store from "./store-assignments.js";
import * as people from "./store-people.js";

/** GET /api/self-study/mine — what I, a learner, have been assigned. */
export async function mine(req, res) {
  const { data: targets } = await store.targetsForStudent(req.user.id);

  const ids = [...new Set((targets ?? []).map((t) => t.assignment_id))];
  const openTargets = (targets ?? []).filter((t) => t.status !== "complete").map((t) => t.id);
  const { data: openFiles } = openTargets.length
    ? await store.openFilesForTargets(openTargets)
    : { data: [] };
  const draftFilesBy = new Map();
  for (const f of openFiles ?? []) {
    const list = draftFilesBy.get(f.target_id) || [];
    list.push({ id: f.id, name: f.name, size: f.size, mime: f.mime, kind: f.kind, ...(Number.isInteger(f.question_index) ? { question: f.question_index } : {}) });
    draftFilesBy.set(f.target_id, list);
  }
  const { data: assignments } = ids.length
    ? await store.assignmentsByIds(ids)
    : { data: [] };
  const byId = new Map((assignments ?? []).map((a) => [a.id, a]));

  // Who set it — learners want to know it came from their teacher.
  const teacherIds = [...new Set((assignments ?? []).map((a) => a.created_by))];
  const { data: teachers } = teacherIds.length
    ? await people.usersByIds(teacherIds, "id, full_name")
    : { data: [] };
  const teacherById = new Map((teachers ?? []).map((u) => [u.id, u.full_name]));

  // ── Multi-stage journeys: sequential unlocking ──────────────────────────
  // A journey's stages complete IN ORDER. Stage state is derived, never
  // trusted from the client: a study stage is this learner's target status
  // on the child assignment; a battle stage is their participant row in a
  // finished battle. Stages with no resolvable ref are "open" — displayed
  // but never gating, so a legacy journey cannot dead-end its learners.
  const journeys = (assignments ?? []).filter((a) => (a.type ?? "self_study") === "multi_stage" && a.status !== "archived");
  const myTargetByAssignment = new Map((targets ?? []).map((t) => [t.assignment_id, t]));

  const journeyInfoById = new Map();   // child assignment id → { journey, position, total, locked }
  const journeyStateById = new Map();  // journey id → computed stage list

  for (const journey of journeys) {
    const refs = Array.isArray(journey.details?.stages) ? journey.details.stages : [];

    const battleIds = refs.map((r) => r.battleId).filter(Boolean);
    const { data: myBattleRows } = battleIds.length
      ? await people.battleSeatsFor(req.user.id, battleIds)
      : { data: [] };
    const { data: battleRows } = battleIds.length
      ? await people.battlesByIds(battleIds)
      : { data: [] };
    const myBattleBy = new Map((myBattleRows ?? []).map((r) => [r.battle_id, r]));
    const battleBy = new Map((battleRows ?? []).map((r) => [r.id, r]));

    const resolve = (ref) => {
      if (ref.kind === "battle") {
        if (!ref.battleId) return null;                     // legacy: battle id was not captured
        const me = myBattleBy.get(ref.battleId);
        if (!me) return "assigned";                         // invited, never joined
        return battleBy.get(ref.battleId)?.status === "completed" ? "complete" : "started";
      }
      if (!ref.refId) return null;                          // not tracked
      return myTargetByAssignment.get(ref.refId)?.status ?? null;
    };

    const resolved = refs.map(resolve);
    // The active stage is the FIRST resolvable, unfinished one — "open"
    // stages are skipped by the gate so they can never dead-end a journey.
    let activeIndex = resolved.findIndex((st) => st === "assigned" || st === "started");
    if (activeIndex === -1) activeIndex = refs.length;

    const stages = refs.map((ref, i) => ({
      title: ref.title ?? null,
      kind: ref.kind ?? null,
      emoji: ref.emoji ?? null,
      status: resolved[i] === null
        ? (i < activeIndex ? "passed" : i > activeIndex ? "locked" : "open")
        : i < activeIndex ? "complete" : i === activeIndex ? "active" : "locked",
    }));

    const doneCount = stages.filter((st) => st.status === "complete").length;
    const allDone = resolved.every((st, i) => st === "complete" || st === null);
    journeyStateById.set(journey.id, {
      stages,
      progress: { done: doneCount, total: refs.length },
      status: allDone && refs.length ? "complete" : (myTargetByAssignment.get(journey.id)?.status ?? "assigned"),
    });

    refs.forEach((ref, i) => {
      if (ref.refId) journeyInfoById.set(ref.refId, {
        journeyId: journey.id, journeyTitle: journey.title,
        position: i + 1, total: refs.length, locked: i > activeIndex,
      });
    });
  }

  ok(res, (targets ?? [])
    .filter((t) => byId.has(t.assignment_id) && byId.get(t.assignment_id).status !== "archived")
    .map((t) => {
      const a = byId.get(t.assignment_id);
      const isJourney = (a.type ?? "self_study") === "multi_stage";
      const jState = isJourney ? journeyStateById.get(a.id) : null;
      return {
        id:           a.id,
        targetId:     t.id,
        type:         a.type ?? "self_study",
        details:      briefForLearner(a.details, t.grade != null),
        title:        a.title,
        subject:      a.subject,
        topic:        a.topic,
        subtopics:    a.subtopics ?? [],
        objectives:   a.objectives ?? {},
        instructions: a.instructions,
        difficulty:   a.difficulty,
        dueAt:        a.due_at,
        assignedBy:   teacherById.get(a.created_by) ?? null,
        status:       jState?.status ?? t.status,
        grade:        t.grade ?? null,                       // published 0–100, null until graded
        graded:       t.grade != null,
        feedbackText: t.feedback?.text || null,
        // Once graded: the rubric levels behind the score, and the marked copy.
        feedbackRubric: t.grade != null && Array.isArray(t.feedback?.rubric) ? t.feedback.rubric : [],
        feedbackQuestions: t.grade != null && Array.isArray(t.feedback?.questions) ? t.feedback.questions : [],
        // Marked by the AI at once (the teacher can still adjust), and the marking points behind each question's mark.
        feedbackAi: t.grade != null && !!t.feedback?.ai,
        feedbackMarking: t.grade != null && Array.isArray(t.feedback?.marking) ? t.feedback.marking : [],
        // The AI is marking right now (auto-grade on, score released instantly).
        aiMarking: t.grade == null && t.ai_grade?.status === "making" && t.status === "complete" && !!a.details?.ai_auto_grade && a.details?.ai_release !== "review",
        // Answers submitted question by question, not yet handed in.
        draft:        t.draft?.answers ? { answers: t.draft.answers, savedAt: t.draft.savedAt ?? null } : null,
        // Files uploaded but not handed in yet — each with its question, so
        // the work follows the learner to another device.
        draftFiles:   t.status !== "complete" ? (draftFilesBy.get(t.id) || []) : [],
        markedPdf:    t.grade != null && !!t.submission?.submittedAt,
        // The work the learner turned in — text, per-question answers and
        // file metadata. Server copy wins once submitted.
        submission:   t.submission ?? null,
        submissionPdf: pdfMeta(t),
        sessionId:    t.session_id,
        startedAt:    t.started_at,
        completedAt:  t.completed_at,
        // The journey's roadmap with per-stage state — the learner surface
        // for sequential unlocking.
        ...(jState ? { stages: jState.stages, journeyProgress: jState.progress } : {}),
        // A child stage knows which journey it belongs to and whether its
        // turn has come. Locked stages are hidden by learner surfaces.
        ...(journeyInfoById.has(a.id) ? { journey: journeyInfoById.get(a.id) } : {}),
      };
    }));
}

/**
 * GET /api/self-study/streak — the learner's activity streak.
 *
 * Consecutive days ending today (or yesterday, so an early visit keeps a
 * streak alive) with at least one completed activity, derived from the
 * learner's own completion timestamps. No new state: it is computed from
 * what really happened, so it can never show a number the learner did not
 * earn. Registered before /:id so "streak" is never read as an id.
 */
export async function streak(req, res) {
  const { data: targets } = await store.completionDaysFor(req.user.id);
  const days = new Set((targets ?? [])
    .filter((t) => t.completed_at)
    .map((t) => String(t.completed_at).slice(0, 10)));   // YYYY-MM-DD (UTC)

  const key = (d) => d.toISOString().slice(0, 10);
  const cursor = new Date();
  if (!days.has(key(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);   // grace: yesterday counts

  let streak = 0;
  while (days.has(key(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  ok(res, { streak });
}
