/**
 * modules/self-study/service-activities.js — teacher/school activity
 * orchestration: AI drafting of plans/questions/rubrics, create/list/edit/
 * delete, adding and removing learners, analytics, AI reports and the class
 * review. The router stays thin; store-assignments.js owns the queries and
 * service-common.js owns the ownership guard.
 */
import { getStudentState } from "../learner-state/index.js";
import {
  nana, ACTIVITY_TYPES, mySchool, resolveStudents, notifyAll, createAssignment, announceFor,
} from "./createAssignment.js";
import { draftPaper, parseQuestionRequest, summarizePaper } from "./questionPaper.js";
import { cleanPaperDetails } from "./paperLayout.js";
import { pdfMeta } from "./submissionView.js";
import { ok, bad, denied, missing } from "./http.js";
import { ASSIGNMENT_EDITABLE, isStaleDraft } from "./rules.js";
import { ownedAssignment, now } from "./service-common.js";
import * as store from "./store-assignments.js";
import * as people from "./store-people.js";

/* ── Drafting: plan, questions, rubric ───────────────────────────────────── */

/** POST /api/self-study/plan — subtopics + objectives to review before assigning. */
export async function plan(req, res) {
  const { topic, subject } = req.body;
  if (!topic?.trim() || !subject?.trim()) return bad(res, "topic and subject are required");

  const { subtopics } = await nana.generateSubtopics(topic, subject);
  const lists = await Promise.all(subtopics.map((st) => nana.generateObjectives(st, topic, subject)));
  const objectives = {};
  subtopics.forEach((st, i) => { objectives[st] = lists[i]; });

  ok(res, { topic, subject, subtopics, objectives });
}

/** POST /assignment-draft/questions — the assignment's questions, points and levels. */
export async function draftQuestions(req, res) {
  const { topic, subject, total_points, question_types, difficulty, subtopics, request, class_level } = req.body;
  if (!topic?.trim() || !subject?.trim()) return bad(res, "topic and subject are required");
  // The teacher's own words drive the paper ("5 questions, 3 MCQ, 2 theory,
  // one with a diagram"); the workbench's ticked types and total fill in
  // what the words leave open.
  const types = Array.isArray(question_types) ? question_types.filter((t) => typeof t === "string").slice(0, 8) : [];
  const words = typeof request === "string" ? request.slice(0, 1500) : "";
  const fallback = parseQuestionRequest(words).mix.length || !types.length ? "" : ` Use only these question types: ${types.join(", ")}.`;
  try {
    const { paper, warning } = await draftPaper({
      chat: (messages, opts = {}) => nana.generateAssignmentQuestions({ messages, ...opts, billing: { __userId: req.user.id, __feature: "assignment_questions" } }),
      topic: topic.trim(), subject: String(subject).trim(),
      classLevel: typeof class_level === "string" ? class_level.slice(0, 60) : null,
      request: (words + fallback).trim(),
      plan: Number(total_points) > 0 && !parseQuestionRequest(words).totalPoints ? { total_points: Number(total_points) } : null,
      difficulty: typeof difficulty === "string" ? difficulty : null,
      subtopics: Array.isArray(subtopics) ? subtopics.filter((x) => typeof x === "string") : null,
    });
    ok(res, { ...paper, warning, summary: summarizePaper(paper) });
  } catch (e) {
    return bad(res, e.message || "Could not draft the questions.");
  }
}

/** POST /assignment-draft/rubric — the marking rubric for the drafted questions. */
export async function draftRubric(req, res) {
  const { topic, subject, total_points, question_types } = req.body;
  if (!topic?.trim() || !subject?.trim()) return bad(res, "topic and subject are required");
  const rubric = await nana.generateAssignmentRubric({
    topic:        topic.trim(),
    subject,
    totalPoints:  Number(total_points) || null,
    questionTypes: Array.isArray(question_types) ? question_types : null,
  });
  ok(res, { rubric });
}

/* ── Create, list, read, edit, delete ────────────────────────────────────── */

/** POST /api/self-study — create the brief and assign it (the shared path). */
export async function create(req, res) {
  const { assignment, assigned } = await createAssignment(req.user, req.body);
  res.status(201).json({ success: true, data: { ...assignment, assigned } });
}

/** GET /api/self-study — assignments I created (or my school's), with progress. */
export async function list(req, res) {
  const school = await mySchool(req.user.id);

  const { data: rows, error } = await store.listAssignments(req.user.id, school?.id);
  if (error) throw new Error(error.message);

  const ids = (rows ?? []).map((r) => r.id);
  const { data: targets } = ids.length
    ? await store.targetsByAssignmentIds(ids)
    : { data: [] };

  const progress = {};
  for (const t of (targets ?? [])) {
    const p = progress[t.assignment_id] ??= { assigned: 0, started: 0, complete: 0 };
    p.assigned += 1;
    if (t.status === "started")  p.started  += 1;
    if (t.status === "complete") p.complete += 1;
  }

  ok(res, (rows ?? []).map((r) => ({ ...r, progress: progress[r.id] ?? { assigned: 0, started: 0, complete: 0 } })));
}

/** GET /api/self-study/:id — the brief plus every learner's state. */
export async function detail(req, res) {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");

  const { data: targets } = await store.targetsForAssignment(assignment.id);

  const ids = (targets ?? []).map((t) => t.student_id);
  const { data: users } = ids.length
    ? await people.usersByIds(ids, "id, full_name, username, avatar_emoji")
    : { data: [] };
  const byId = new Map((users ?? []).map((u) => [u.id, u]));

  // Submission attachments (metadata only — never the base64 payload).
  const targetIds = (targets ?? []).map((t) => t.id);
  const { data: fileRows } = targetIds.length
    ? await store.filesForTargets(targetIds)
    : { data: [] };
  const filesByTarget = new Map();
  for (const f of (fileRows ?? [])) {
    (filesByTarget.get(f.target_id) ?? filesByTarget.set(f.target_id, []).get(f.target_id)).push(f);
  }

  ok(res, {
    ...assignment,
    targets: (targets ?? []).map(({ submission_pdf, marked_pdf, ...t }) => {
      // Only what was handed in: files uploaded and then left out of the
      // submission (or still in progress) aren't the learner's work yet.
      const handedIn = new Set((t.submission?.files ?? []).map((f) => f.id));
      return {
        ...t,
        full_name: byId.get(t.student_id)?.full_name ?? "Unknown",
        username:  byId.get(t.student_id)?.username ?? null,
        emoji:     byId.get(t.student_id)?.avatar_emoji ?? null,
        files:     (filesByTarget.get(t.id) ?? []).filter((f) => handedIn.has(f.id))
          .map(({ question_index, ...f }) => ({ ...f, ...(Number.isInteger(question_index) ? { question: question_index } : {}) })),
        // A draft still "making" long after it started was cut off (a restart): offer Redraft.
        ai_grade: isStaleDraft(t.ai_grade)
          ? { ...t.ai_grade, status: "failed", error: "Drafting was interrupted — draft again." } : t.ai_grade ?? null,
        submissionPdf: pdfMeta({ ...t, submission_pdf }),
        markedPdf: marked_pdf?.key ? { ready: true, builtAt: marked_pdf.builtAt ?? null } : null,
      };
    }),
  });
}

/** PATCH /api/self-study/:id — edit the brief. */
export async function patch(req, res) {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");

  if (req.body.type && !ACTIVITY_TYPES.includes(req.body.type)) return bad(res, `Unknown activity type: ${req.body.type}`);
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => ASSIGNMENT_EDITABLE.includes(k)));
  if (!Object.keys(updates).length) return bad(res, "No editable fields provided");
  if (updates.details) updates.details = cleanPaperDetails(updates.details);
  updates.updated_at = now();

  const { data, error: uErr } = await store.updateAssignmentReturning(assignment.id, updates);
  if (uErr) throw new Error(uErr.message);
  ok(res, data);
}

/** DELETE /api/self-study/:id — remove the brief and its targets. */
export async function remove(req, res) {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");

  const { error: dErr } = await store.deleteAssignment(assignment.id);
  if (dErr) throw new Error(dErr.message);
  ok(res, { id: assignment.id, deleted: true });
}

/* ── Learners on the assignment ──────────────────────────────────────────── */

/** POST /api/self-study/:id/assign — add more learners later. */
export async function assignMore(req, res) {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");

  const { ids, notFound } = await resolveStudents({
    usernames:    req.body.usernames,
    user_ids:     req.body.user_ids,
    whole_class:  req.body.whole_class,
    classroom_id: req.body.classroom_id ?? assignment.classroom_id,
    course_id:    req.body.course_id    ?? assignment.course_id,
  });
  if (notFound.length) return bad(res, `No account found for: ${notFound.join(", ")}`);
  if (!ids.length)     return bad(res, "Pick at least one learner");

  const { error: tErr } = await store.upsertTargets(ids.map((student_id) => ({ assignment_id: assignment.id, student_id })));
  if (tErr) throw new Error(tErr.message);

  const announce = announceFor(assignment.type);
  await notifyAll(ids, {
    type: "self_study_assigned",   // kept: learner notification handlers key on this string
    title: `${announce.emoji} ${announce.label}: ${assignment.title}`,
    content: `${assignment.subject} · ${assignment.topic}`,
    related_id: assignment.id,
    link: "/activities",           // tapping the bell item opens the Activity feed
  });
  // The real-time "ding": same event the create path emits, so work added to
  // an assignment later is announced exactly like new work.
  for (const sid of ids) global.io?.to(`user:${sid}`).emit("self_study_assigned", { assignment });
  ok(res, { assigned: ids.length });
}

/** DELETE /api/self-study/:id/targets/:studentId — unassign one learner. */
export async function unassign(req, res) {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");

  await store.deleteTarget(assignment.id, req.params.studentId);
  ok(res, { unassigned: req.params.studentId });
}

/* ── Class results ───────────────────────────────────────────────────────── */

/**
 * classRows — per-learner analytics rows for one assignment.
 *
 * Joins each learner's progress (self_study_targets) with their agent's
 * live cognitive state (edu.student_states via getStudentState). Reads only;
 * never creates agents or states.
 */
async function classRows(assignment) {
  const { data: targets } = await store.targetsForAssignment(assignment.id);
  const rows = targets ?? [];
  const ids = rows.map((t) => t.student_id);

  const { data: users } = ids.length
    ? await people.usersByIds(ids, "id, full_name, username, avatar_emoji")
    : { data: [] };
  const { data: agents } = ids.length
    ? await people.agentsForStudents(ids)
    : { data: [] };
  const userBy   = new Map((users ?? []).map((u) => [u.id, u]));
  const agentBy  = new Map((agents ?? []).map((a) => [a.student_id, a]));

  return Promise.all(rows.map(async (t) => {
    const u = userBy.get(t.student_id);
    const agent = agentBy.get(t.student_id);
    let cognitive = null;
    if (agent?.id) {
      const st = await getStudentState(agent.id);
      const c = st?.cognitive ?? {};
      cognitive = {
        understanding: Math.round((c.understanding ?? 0) * 100),
        confusion:     Math.round((c.confusion ?? 0) * 100),
        engagement:    Math.round((c.engagement ?? 0.5) * 100),
      };
    }
    return {
      student:     { id: t.student_id, name: u?.full_name ?? "Unknown", username: u?.username ?? null, emoji: u?.avatar_emoji || "🧑‍🎓" },
      status:      t.status,
      startedAt:   t.started_at,
      completedAt: t.completed_at,
      knowledgeScore: agent ? Math.round(Number(agent.knowledge_score ?? 0)) : null,
      agentLevel:     agent?.level ?? null,
      cognitive,
    };
  }));
}

/** GET /api/self-study/:id/analytics — class results for one activity, plus any saved AI report. */
export async function analytics(req, res) {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");

  const rows = await classRows(assignment);
  const avg  = (key) => {
    const vals = rows.map((r) => r.cognitive?.[key]).filter((v) => typeof v === "number");
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };

  ok(res, {
    assignment: {
      id: assignment.id, title: assignment.title, subject: assignment.subject,
      topic: assignment.topic, subtopics: assignment.subtopics ?? [],
      difficulty: assignment.difficulty, type: assignment.type ?? "self_study",
    },
    summary: {
      assigned: rows.length,
      started:  rows.filter((r) => r.status === "started").length,
      complete: rows.filter((r) => r.status === "complete").length,
      avgUnderstanding: avg("understanding"),
      avgConfusion:     avg("confusion"),
      avgEngagement:    avg("engagement"),
    },
    learners: rows,
    report: assignment.details?.ai_report ?? null,   // { report, generatedAt } when one was generated
  });
}

/** POST /api/self-study/:id/report — generate (and save) the AI report for this activity. */
export async function report(req, res) {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");

  const rows = await classRows(assignment);
  if (!rows.length) return bad(res, "Assign it to at least one learner before asking for a report.");

  const generated = await nana.classAnalytics({
    topic: assignment.topic, subject: assignment.subject,
    subtopics: assignment.subtopics ?? [], difficulty: assignment.difficulty,
    type: assignment.type ?? "self_study",
  }, rows.map((r) => ({
    name: (r.student.name || "Learner").split(" ")[0],   // first names only in the prompt
    status: r.status,
    understanding: r.cognitive?.understanding ?? null,
    confusion: r.cognitive?.confusion ?? null,
    engagement: r.cognitive?.engagement ?? null,
    knowledgeScore: r.knowledgeScore,
  })));

  const generatedAt = now();
  const details = { ...(assignment.details ?? {}), ai_report: { report: generated, generatedAt } };
  const { error: uErr } = await store.updateAssignment(assignment.id, { details, updated_at: generatedAt });
  if (uErr) throw new Error(uErr.message);

  ok(res, { report: generated, generatedAt });
}

/**
 * GET /api/self-study/:id/reviews — the activity's review battle: when it runs
 * (one class battle, sent to their Challenges) and each learner's state
 * (waiting · sent · accepted · running · done with its mark · missed). The
 * instructor's view (self-study/activityReview.js).
 */
export async function reviews(req, res) {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");
  const review = assignment.details?.review || null;
  if (!review?.on) return ok(res, { review: null, reviews: [] });
  const { activityReviews } = await import("./activityReview.js");
  const { reviews: rows, battleId, battleStatus, startsAt } = await activityReviews(assignment.id);
  const ids = rows.map((r) => r.learnerId);
  const { data: users } = ids.length ? await people.usersByIds(ids, "id, full_name, username") : { data: [] };
  const nameOf = new Map((users || []).map((u) => [u.id, u.full_name || u.username]));
  ok(res, { review, battleId, battleStatus, startsAt, reviews: rows.map((r) => ({ ...r, name: nameOf.get(r.learnerId) || null })) });
}
