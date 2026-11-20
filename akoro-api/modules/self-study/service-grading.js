/**
 * modules/self-study/service-grading.js — publishing and un-publishing grades,
 * the grader's marks on the submission PDF, and the AI marking draft. The
 * learner's instant release of an AI mark lives here too. Nothing here ever
 * overwrites a teacher's grade; the marked copy is rebuilt after a publish.
 */
import { notifyAll } from "./createAssignment.js";
import { buildMarkedCopyLater, aiGradeTarget } from "./submissionArtifacts.js";
import { validateMarks } from "./submissionMarkup.js";
import { cleanQuestionMarks } from "./submissionView.js";
import { ok, bad, denied, missing } from "./http.js";
import { isDraftInFlight, readGrade } from "./rules.js";
import { ownedAssignment, now } from "./service-common.js";
import * as store from "./store-assignments.js";

/**
 * Show the learner the AI's marks the moment they're ready (auto-grade on, release "instant").
 * Provisional: feedback.ai is set, and the teacher can still adjust or unpublish. Never overwrites a teacher's grade.
 */
export async function releaseAiGrade(targetId) {
  const { data: t } = await store.targetById(targetId, "id, assignment_id, student_id, grade, ai_grade, submission");
  const ai = t?.ai_grade;
  if (!t || t.grade != null || ai?.status !== "ready" || ai.score == null) return null;
  const { data: a } = await store.findAssignmentFields(t.assignment_id, "id, title");
  const feedback = {
    text: String(ai.feedback || "").slice(0, 4000),
    rubric: (ai.rubric || []).filter((r) => r.level != null).slice(0, 12).map((r) => ({ name: r.name, max: r.max, level: r.level })),
    questions: (ai.questions || []).map((q) => ({ index: q.index, awarded: q.awarded, max: q.max, comment: String(q.why || "").slice(0, 400) })),
    ...(ai.marking?.length ? { marking: ai.marking } : {}),
    mode: "questions", ai: true,
  };
  const patch = { grade: Math.round(ai.score), graded_at: now(), feedback };
  const { data: done } = await store.updateTarget(t.id, patch).is("grade", null).select("id").maybeSingle();
  if (!done) return null;
  await notifyAll([t.student_id], {
    type: "activity_graded", title: `📋 Marked: ${a?.title || "your work"}`,
    content: `Your score: ${patch.grade}%`, related_id: t.assignment_id, link: "/activities",
  });
  global.io?.to(`user:${t.student_id}`).emit("activity_graded", { assignmentId: t.assignment_id, grade: patch.grade });
  buildMarkedCopyLater(t.id);
  return patch.grade;
}



/**
 * PATCH /api/self-study/:id/targets/:studentId/grade — publish a grade.
 *
 * The workbench autosaves drafts locally (they never touch the server);
 * this is the deliberate PUBLISH: the number becomes the learner's grade,
 * the feedback (text + rubric levels) travels with it, the learner is
 * notified, and their gradebook files the work under "Graded activity".
 * Republishing overwrites — the latest deliberate grade wins.
 */
export async function publishGrade(req, res) {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");

  const studentId = req.params.studentId;
  const { grade } = req.body;
  const sentFeedback = req.body.feedback;
  if (sentFeedback != null && (typeof sentFeedback !== "object" || Array.isArray(sentFeedback))) return bad(res, "feedback must be an object");
  const feedback = sentFeedback || {};
  const g = readGrade(grade);
  if (g.error) return bad(res, g.error);
  const n = g.n;

  const patch = { grade: Math.round(n), graded_at: now(), graded_by: req.user.id };
  if (sentFeedback == null) {
    // A score-only publish (the gradebook) keeps the feedback already given —
    // but a score typed over question marks is now the teacher's own number.
    const { data: prev } = await store.targetByStudent(assignment.id, studentId, "feedback");
    if (prev?.feedback?.mode === "questions") patch.feedback = { ...prev.feedback, mode: "manual" };
  } else {
    // Marked question by question: each row is { index, awarded, max, comment }.
    const qm = cleanQuestionMarks(assignment.details?.questions || [], feedback.questions);
    if (qm.error) return bad(res, qm.error);
    patch.feedback = {
      text: typeof feedback.text === "string" ? feedback.text.slice(0, 4000) : "",
      rubric: Array.isArray(feedback.rubric) ? feedback.rubric.slice(0, 12) : [],
      questions: qm.marks,
      mode: ["manual", "questions"].includes(feedback.mode) ? feedback.mode : "rubric",
    };
  }
  const { data: target, error: tErr } = await store.updateTargetForStudent(assignment.id, studentId, patch);
  if (tErr || !target) return missing(res, "That learner is not assigned this activity");

  await notifyAll([studentId], {
    type: "activity_graded",
    title: `📋 Graded: ${assignment.title}`,
    content: `Your score: ${Math.round(n)}%${feedback.text ? " · feedback waiting" : ""}`,
    related_id: assignment.id,
    link: "/activities",
  });
  global.io?.to(`user:${studentId}`).emit("activity_graded", { assignmentId: assignment.id, grade: Math.round(n) });
  // The marked copy (the PDF with the grader's marks + the grade page) is
  // what the learner gets back — built now, so it's ready when they look.
  if (target.submission?.submittedAt) buildMarkedCopyLater(target.id);

  ok(res, { grade: target.grade, graded_at: target.graded_at });
}

/**
 * DELETE /api/self-study/:id/targets/:studentId/grade — unpublish: the work
 * goes back to "submitted, not graded". The marks and comments stay as the
 * teacher's draft (they come back when the grading view reopens); the
 * learner stops seeing a grade.
 */
export async function unpublishGrade(req, res) {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");
  const { data: target, error: tErr } = await store.updateTargetForStudent(
    assignment.id, req.params.studentId,
    { grade: null, graded_at: null, graded_by: null, marked_pdf: null }, "id, grade",
  );
  if (tErr || !target) return missing(res, "That learner is not assigned this activity");
  global.io?.to(`user:${req.params.studentId}`).emit("activity_graded", { assignmentId: assignment.id, grade: null });
  ok(res, { grade: null });
}

/** PUT /api/self-study/:id/targets/:studentId/markup { marks } — the
 *  grader's marks on the submission PDF (autosaved while marking). They
 *  reach the learner only inside the marked copy, after a grade is published. */
export async function saveMarkup(req, res) {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");
  const v = validateMarks(req.body?.marks);
  if (v.error) return bad(res, v.error);
  const markup = { marks: v.marks, updatedAt: now(), by: req.user.id };
  const { data: target, error: tErr } = await store.updateTargetForStudentMaybe(
    assignment.id, req.params.studentId, { markup }, "id, grade, submission",
  );
  if (tErr || !target) return missing(res, "That learner is not assigned this activity");
  // Already graded: the learner's marked copy follows the new marks.
  if (target.grade != null && target.submission?.submittedAt) buildMarkedCopyLater(target.id);
  ok(res, { count: v.marks.length, updatedAt: markup.updatedAt });
}

/** POST /api/self-study/:id/targets/:studentId/ai-grade — draft marks with
 *  AI for this submission (the instructor approves; nothing is published).
 *  Runs after the response; the draft lands on the target as ai_grade. */
export async function draftAiGrade(req, res) {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");
  const { data: t } = await store.targetByStudent(assignment.id, req.params.studentId, "id, submission, ai_grade");
  if (!t) return missing(res, "That learner is not assigned this activity");
  if (!t.submission?.submittedAt) return bad(res, "Nothing has been submitted yet");
  if (isDraftInFlight(t.ai_grade)) {
    return res.status(409).json({ success: false, error: "Marks are already being drafted — they'll appear in a moment" });
  }
  void aiGradeTarget(t.id);
  res.status(202).json({ success: true, data: { ai_grade: { status: "making", at: now() } } });
}
