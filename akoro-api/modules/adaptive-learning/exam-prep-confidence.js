/**
 * Learner-owned exam-prep confidence loop — HTTP surface.
 *
 * Auth + response envelope only: the topic workflow itself lives in
 * exam-prep-service.js (extracted per the Study-Prep Master Plan §4.8.1 so
 * the study-prep harness drives the same code). It creates generated
 * exam-style MCQ practice only; it must never be described as a historical
 * WAEC/JAMB/NECO paper. A low score offers a learner-initiated teach-back
 * handoff but creates no task, notification, autonomous session, or
 * instructor escalation.
 */
import express from "express";

import {
  ExamPrepConflictError, ExamPrepRequestError,
  examPrepInput, getExamPrepAttemptRow, getOwnedExamPrepRun,
  listExamPrepRuns, publicAttempt, publicRun,
  startExamPrepRetest, startExamPrepRun, submitExamPrepAttempt,
} from "./exam-prep-service.js";
import { listLearnerWorkflows } from "./adaptive-workflows.js";

const router = express.Router();
// Default-on kill switch: the confidence loop ships enabled; =false removes it.
const enabled = String(process.env.AKORO_EXAM_PREP_CONFIDENCE_ENABLED ?? "true").toLowerCase() !== "false";
const fail = (res, status, error, code = null) => res.status(status).json({ success: false, code: code || undefined, error });

router.post("/confidence-runs", async (req, res) => {
  if (!enabled) return fail(res, 409, "Exam-prep confidence loop is not enabled", "exam_prep_disabled");
  try {
    const request = examPrepInput(req.body || {});
    const { run, attempt, workflow } = await startExamPrepRun({ learnerId: req.user.id, request });
    return res.status(201).json({ success: true, run: publicRun(run), attempt: publicAttempt(attempt), workflow });
  } catch (error) {
    if (error instanceof ExamPrepRequestError) return fail(res, 422, error.message, "invalid_exam_prep_input");
    console.error("[exam-prep-confidence/start]", error?.message || error);
    return fail(res, 503, "Exam-prep practice could not be prepared");
  }
});

router.get("/confidence-runs", async (req, res) => {
  if (!enabled) return fail(res, 409, "Exam-prep confidence loop is not enabled", "exam_prep_disabled");
  try {
    const runs = await listExamPrepRuns(req.user.id, req.query?.limit);
    return res.json({ success: true, runs: runs.map(publicRun) });
  } catch (error) {
    console.error("[exam-prep-confidence/list]", error?.message || error);
    return fail(res, 503, "Exam-prep runs are unavailable");
  }
});

router.get("/workflows", async (req, res) => {
  if (!enabled) return fail(res, 409, "Exam-prep confidence loop is not enabled", "exam_prep_disabled");
  try {
    return res.json({ success: true, workflows: await listLearnerWorkflows(req.user.id) });
  } catch (error) {
    console.error("[exam-prep-confidence/workflows]", error?.message || error);
    return fail(res, 503, "Adaptive workflows are unavailable");
  }
});

router.get("/confidence-runs/:runId", async (req, res) => {
  if (!enabled) return fail(res, 409, "Exam-prep confidence loop is not enabled", "exam_prep_disabled");
  try {
    const run = await getOwnedExamPrepRun(req.params.runId, req.user.id);
    if (!run) return fail(res, 404, "Exam-prep run was not found", "exam_prep_run_not_found");
    return res.json({ success: true, run: publicRun(run) });
  } catch (error) {
    console.error("[exam-prep-confidence/get]", error?.message || error);
    return fail(res, 503, "Exam-prep run is unavailable");
  }
});

router.get("/confidence-runs/:runId/attempts/:attemptNumber", async (req, res) => {
  if (!enabled) return fail(res, 409, "Exam-prep confidence loop is not enabled", "exam_prep_disabled");
  try {
    const result = await getExamPrepAttemptRow(req.user.id, req.params.runId, req.params.attemptNumber);
    if (result.notFound) return fail(res, 404, "Exam-prep run was not found", "exam_prep_run_not_found");
    if (result.notReady) return fail(res, 409, "That attempt has not been submitted yet", "attempt_not_submitted");
    return res.json({
      success: true, run: publicRun(result.run), attempt: publicAttempt(result.attempt),
      submittedAnswers: result.attempt.submitted_answers || {},
    });
  } catch (error) {
    console.error("[exam-prep-confidence/attempt]", error?.message || error);
    return fail(res, 503, "Exam-prep attempt is unavailable");
  }
});

router.post("/confidence-runs/:runId/submit", async (req, res) => {
  if (!enabled) return fail(res, 409, "Exam-prep confidence loop is not enabled", "exam_prep_disabled");
  try {
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    if (answers.length > 10) return fail(res, 422, "Too many answers", "too_many_answers");
    const result = await submitExamPrepAttempt({ learnerId: req.user.id, runId: req.params.runId, answers });
    if (result.notFound) return fail(res, 404, "Exam-prep run was not found", "exam_prep_run_not_found");
    return res.json({
      success: true, run: publicRun(result.run), workflow: result.workflow, score: result.score,
      correct: result.correct, total: result.total, passed: result.passed,
      teachBack: result.nextStatus === "teach_back_required" ? {
        available: true, learnerInitiated: true,
        config: { topic: result.run.topic, subject: result.run.subject, mode: "fresh" },
        reason: "A fresh teach-back and retrieval session may help before a new retest.",
      } : null,
      changeApproach: result.nextStatus === "change_approach" ? {
        required: true, reason: "The attempt cap was reached; choose a different explanation or seek support before more testing.",
      } : null,
    });
  } catch (error) {
    if (error instanceof ExamPrepRequestError) return fail(res, 422, error.message, "invalid_answers");
    if (error instanceof ExamPrepConflictError) return fail(res, 409, error.message, error.code);
    console.error("[exam-prep-confidence/submit]", error?.message || error);
    return fail(res, 503, "Exam-prep result could not be recorded");
  }
});

router.post("/confidence-runs/:runId/retest", async (req, res) => {
  if (!enabled) return fail(res, 409, "Exam-prep confidence loop is not enabled", "exam_prep_disabled");
  try {
    const result = await startExamPrepRetest({
      learnerId: req.user.id, runId: req.params.runId, learnerConfirmedReady: req.body?.learnerConfirmedReady,
    });
    if (result.notFound) return fail(res, 404, "Exam-prep run was not found", "exam_prep_run_not_found");
    return res.status(201).json({ success: true, run: publicRun(result.run), attempt: publicAttempt(result.attempt), workflow: result.workflow });
  } catch (error) {
    if (error instanceof ExamPrepRequestError) return fail(res, 422, error.message, "learner_confirmed_ready_required");
    if (error instanceof ExamPrepConflictError) return fail(res, 409, error.message, error.code);
    console.error("[exam-prep-confidence/retest]", error?.message || error);
    return fail(res, 503, "Fresh exam-prep retest could not be prepared");
  }
});

export default router;
