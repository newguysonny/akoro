/**
 * Learner-owned exam-prep confidence loop.
 *
 * This is deliberately a small, stateful workflow instead of changing the
 * existing teacher task `exam_prep` tool. It creates generated exam-style MCQ
 * practice only; it must never be described as a historical WAEC/JAMB/NECO
 * paper. A low score offers a learner-initiated teach-back handoff but creates
 * no task, notification, autonomous session, or instructor escalation.
 */
import express from "express";
import { v4 as uuid } from "uuid";

import db from "../../db.js";
import { OPENAI_MODEL, openai } from "../../lib/aiModel.js";
import { parseJsonLoose } from "../tasks/tools/_json.js";
import { normaliseExamConfidenceQuestions } from "./exam-prep-confidence-validation.js";
import { listLearnerWorkflows, startExamPrepWorkflow, transitionExamPrepWorkflow } from "./adaptive-workflows.js";

const router = express.Router();
const enabled = String(process.env.AKORO_EXAM_PREP_CONFIDENCE_ENABLED || "").toLowerCase() === "true";
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value, maximum) => String(value || "").replace(/[\r\n\x00]+/g, " ").trim().slice(0, maximum);
const fail = (res, status, error) => res.status(status).json({ success: false, error });
class ExamPrepRequestError extends Error {}

function input(body) {
  const topic = text(body?.topic, 180);
  const subject = text(body?.subject || "General", 180);
  const examBoard = text(body?.examBoard || "WAEC", 80).toUpperCase();
  const requestedCount = Number(body?.questionCount ?? 5);
  if (topic.length < 3 || !subject || !examBoard || !Number.isInteger(requestedCount) || requestedCount < 3 || requestedCount > 10) {
    throw new ExamPrepRequestError("topic, subject, examBoard, and 3 to 10 questions are required");
  }
  return { topic, subject, examBoard, questionCount: requestedCount };
}

function publicRun(row) {
  return {
    id: row.id, topic: row.topic, subject: row.subject, examBoard: row.exam_board,
    questionProvenance: row.question_provenance, questionCount: Number(row.question_count), passThreshold: Number(row.pass_threshold),
    maxAttempts: Number(row.max_attempts), currentAttempt: Number(row.current_attempt),
    lastScore: row.last_score == null ? null : Number(row.last_score), status: row.status,
    policyVersion: row.policy_version, completedAt: row.completed_at || null,
  };
}

function publicAttempt(row) {
  return {
    attemptNumber: Number(row.attempt_number), kind: row.kind,
    questions: Array.isArray(row.questions) ? row.questions.map((question) => ({
      id: question.id, question: question.question, options: question.options,
      objective: question.objective, difficulty: question.difficulty,
    })) : [],
    submittedAt: row.submitted_at || null,
    score: row.score == null ? null : Number(row.score),
  };
}

async function policyFor(examBoard, subject) {
  const scoped = await db.schema("edu").from("exam_prep_confidence_policies")
    .select("pass_threshold, max_attempts, policy_version")
    .eq("exam_board", examBoard).eq("subject", subject).maybeSingle();
  if (scoped.error) throw scoped.error;
  if (scoped.data) return scoped.data;
  const board = await db.schema("edu").from("exam_prep_confidence_policies")
    .select("pass_threshold, max_attempts, policy_version")
    .eq("exam_board", examBoard).eq("subject", "*").maybeSingle();
  if (board.error) throw board.error;
  // The default is explicit and can be overridden via the policy table; it is
  // not represented as an evidence score or hidden inside the model prompt.
  return board.data || { pass_threshold: 0.70, max_attempts: 3, policy_version: "exam-confidence-v1" };
}

async function generateAttempt({ topic, subject, examBoard, count, attemptNumber, kind }) {
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL, max_tokens: 3500, messages: [{ role: "user", content: `Create ${count} fresh multiple-choice, generated exam-style practice questions.
This is not a historical past paper and must not claim to be one.
Board style: ${examBoard}; subject: ${subject}; topic: ${topic}; attempt: ${attemptNumber}; kind: ${kind}.
Use different question wording/examples from earlier attempts. Every question needs exactly four options and one unambiguous answer index.
Return JSON only: {"questions":[{"question":"...","options":["...","...","...","..."],"answerIndex":0,"objective":"...","difficulty":"easy|medium|hard"}]}` }],
  });
  return normaliseExamConfidenceQuestions(
    parseJsonLoose(response.choices?.[0]?.message?.content || ""), count, uuid,
  );
}

async function ownedRun(runId, learnerId) {
  if (!RUN_ID.test(runId)) return null;
  const { data, error } = await db.schema("edu").from("learner_exam_prep_runs").select("*")
    .eq("id", runId).eq("learner_id", learnerId).maybeSingle();
  if (error) throw error;
  return data;
}

router.post("/confidence-runs", async (req, res) => {
  if (!enabled) return fail(res, 409, "Exam-prep confidence loop is not enabled");
  try {
    const request = input(req.body || {});
    const policy = await policyFor(request.examBoard, request.subject);
    const questions = await generateAttempt({ ...request, count: request.questionCount, attemptNumber: 1, kind: "diagnostic" });
    const { data: run, error: runError } = await db.schema("edu").from("learner_exam_prep_runs").insert({
      learner_id: req.user.id, topic: request.topic, subject: request.subject, exam_board: request.examBoard,
      pass_threshold: policy.pass_threshold, max_attempts: policy.max_attempts, policy_version: policy.policy_version,
      question_count: request.questionCount,
    }).select("*").single();
    if (runError) throw runError;
    const answerKey = Object.fromEntries(questions.map((question) => [question.id, question.answerIndex]));
    const publicQuestions = questions.map(({ answerIndex, ...question }) => question);
    const { data: attempt, error: attemptError } = await db.schema("edu").from("learner_exam_prep_attempts").insert({
      run_id: run.id, attempt_number: 1, kind: "diagnostic", questions: publicQuestions, answer_key: answerKey,
    }).select("*").single();
    if (attemptError) throw attemptError;
    let workflow = null;
    try {
      workflow = await startExamPrepWorkflow({
        learnerId: req.user.id, examPrepRunId: run.id, topic: run.topic, subject: run.subject,
        examBoard: run.exam_board, policyVersion: run.policy_version, attempt: 1,
      });
    } catch (workflowError) {
      // The exam attempt remains authoritative. A workflow projection outage is
      // visible in logs and never causes a second generated diagnostic.
      console.error("[exam-prep-confidence/workflow-start]", workflowError?.message || workflowError);
    }
    return res.status(201).json({ success: true, run: publicRun(run), attempt: publicAttempt(attempt), workflow });
  } catch (error) {
    if (error instanceof ExamPrepRequestError) return fail(res, 422, error.message);
    console.error("[exam-prep-confidence/start]", error?.message || error);
    return fail(res, 503, "Exam-prep practice could not be prepared");
  }
});

// A bounded learner-owned index lets the client resume a previous generated
// practice run without recreating questions or relying on browser storage.
router.get("/confidence-runs", async (req, res) => {
  if (!enabled) return res.json({ success: true, enabled: false, runs: [] });
  try {
    const { data, error } = await db.schema("edu").from("learner_exam_prep_runs").select("*")
      .eq("learner_id", req.user.id).order("updated_at", { ascending: false }).limit(12);
    if (error) throw error;
    return res.json({ success: true, enabled: true, runs: (data || []).map(publicRun) });
  } catch (error) {
    console.error("[exam-prep-confidence/list]", error?.message || error);
    return fail(res, 503, "Exam-prep runs are unavailable");
  }
});

router.get("/workflows", async (req, res) => {
  try {
    return res.json({ success: true, workflows: await listLearnerWorkflows(req.user.id) });
  } catch (error) {
    console.error("[exam-prep-confidence/workflows]", error?.message || error);
    return fail(res, 503, "Adaptive workflows are unavailable");
  }
});

router.get("/confidence-runs/:runId", async (req, res) => {
  if (!enabled) return fail(res, 409, "Exam-prep confidence loop is not enabled");
  try {
    const run = await ownedRun(req.params.runId, req.user.id);
    if (!run) return fail(res, 404, "Exam-prep run was not found");
    const { data: attempt, error } = await db.schema("edu").from("learner_exam_prep_attempts").select("*")
      .eq("run_id", run.id).eq("attempt_number", run.current_attempt).maybeSingle();
    if (error) throw error;
    return res.json({ success: true, run: publicRun(run), attempt: attempt ? publicAttempt(attempt) : null });
  } catch (error) {
    return fail(res, 503, "Exam-prep run is unavailable");
  }
});

router.post("/confidence-runs/:runId/submit", async (req, res) => {
  if (!enabled) return fail(res, 409, "Exam-prep confidence loop is not enabled");
  try {
    const run = await ownedRun(req.params.runId, req.user.id);
    if (!run) return fail(res, 404, "Exam-prep run was not found");
    if (!["diagnostic_ready", "retest_ready"].includes(run.status)) return fail(res, 409, "This exam-prep attempt is not ready for submission");
    const { data: attempt, error } = await db.schema("edu").from("learner_exam_prep_attempts").select("*")
      .eq("run_id", run.id).eq("attempt_number", run.current_attempt).is("submitted_at", null).maybeSingle();
    if (error) throw error;
    if (!attempt) return fail(res, 409, "This attempt was already submitted");
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    if (answers.length > 10) return fail(res, 422, "Too many answers");
    const submitted = {};
    for (const item of answers) {
      const id = text(item?.questionId, 80);
      const answerIndex = Number(item?.answerIndex);
      if (!id || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3 || submitted[id] !== undefined) return fail(res, 422, "Answers are invalid");
      submitted[id] = answerIndex;
    }
    const key = attempt.answer_key || {};
    const total = Object.keys(key).length;
    const correct = Object.entries(key).filter(([id, answer]) => submitted[id] === Number(answer)).length;
    const score = total ? Math.round((correct / total) * 10_000) / 10_000 : 0;
    const passed = score >= Number(run.pass_threshold);
    const capped = !passed && Number(run.current_attempt) >= Number(run.max_attempts);
    const nextStatus = passed ? "passed" : capped ? "change_approach" : "teach_back_required";
    const now = new Date().toISOString();
    const [attemptWrite, runWrite] = await Promise.all([
      db.schema("edu").from("learner_exam_prep_attempts").update({ submitted_answers: submitted, score, submitted_at: now })
        .eq("id", attempt.id).is("submitted_at", null),
      db.schema("edu").from("learner_exam_prep_runs").update({ status: nextStatus, last_score: score, updated_at: now, completed_at: passed ? now : null })
        .eq("id", run.id).eq("learner_id", req.user.id),
    ]);
    if (attemptWrite.error || runWrite.error) throw attemptWrite.error || runWrite.error;
    const updated = { ...run, status: nextStatus, last_score: score, completed_at: passed ? now : null };
    let workflow = null;
    try {
      workflow = await transitionExamPrepWorkflow({
        learnerId: req.user.id, examPrepRunId: run.id, from: run.status, to: nextStatus,
        attempt: Number(run.current_attempt), score,
      });
    } catch (workflowError) {
      console.error("[exam-prep-confidence/workflow-transition]", workflowError?.message || workflowError);
    }
    return res.json({
      success: true, run: publicRun(updated), workflow, score, correct, total, passed,
      teachBack: nextStatus === "teach_back_required" ? {
        available: true, learnerInitiated: true,
        config: { topic: run.topic, subject: run.subject, mode: "fresh" },
        reason: "A fresh teach-back and retrieval session may help before a new retest.",
      } : null,
      changeApproach: nextStatus === "change_approach" ? {
        required: true, reason: "The attempt cap was reached; choose a different explanation or seek support before more testing.",
      } : null,
    });
  } catch (error) {
    console.error("[exam-prep-confidence/submit]", error?.message || error);
    return fail(res, 503, "Exam-prep result could not be recorded");
  }
});

router.post("/confidence-runs/:runId/retest", async (req, res) => {
  if (!enabled) return fail(res, 409, "Exam-prep confidence loop is not enabled");
  try {
    const run = await ownedRun(req.params.runId, req.user.id);
    if (!run) return fail(res, 404, "Exam-prep run was not found");
    if (run.status !== "teach_back_required" || Number(run.current_attempt) >= Number(run.max_attempts)) return fail(res, 409, "A retest is not available for this run");
    if (req.body?.learnerConfirmedReady !== true) return fail(res, 422, "learnerConfirmedReady must be true to request a fresh retest");
    const attemptNumber = Number(run.current_attempt) + 1;
    const questions = await generateAttempt({ topic: run.topic, subject: run.subject, examBoard: run.exam_board, count: Number(run.question_count), attemptNumber, kind: "retest" });
    const key = Object.fromEntries(questions.map((question) => [question.id, question.answerIndex]));
    const publicQuestions = questions.map(({ answerIndex, ...question }) => question);
    const { data: attempt, error: attemptError } = await db.schema("edu").from("learner_exam_prep_attempts").insert({
      run_id: run.id, attempt_number: attemptNumber, kind: "retest", questions: publicQuestions, answer_key: key,
    }).select("*").single();
    if (attemptError) throw attemptError;
    const { data: updated, error: runError } = await db.schema("edu").from("learner_exam_prep_runs").update({
      current_attempt: attemptNumber, status: "retest_ready", updated_at: new Date().toISOString(),
    }).eq("id", run.id).eq("learner_id", req.user.id).select("*").single();
    if (runError) throw runError;
    let workflow = null;
    try {
      workflow = await transitionExamPrepWorkflow({
        learnerId: req.user.id, examPrepRunId: run.id, from: run.status, to: "retest_ready",
        attempt: attemptNumber,
      });
    } catch (workflowError) {
      console.error("[exam-prep-confidence/workflow-retest]", workflowError?.message || workflowError);
    }
    return res.status(201).json({ success: true, run: publicRun(updated), attempt: publicAttempt(attempt), workflow });
  } catch (error) {
    console.error("[exam-prep-confidence/retest]", error?.message || error);
    return fail(res, 503, "Fresh exam-prep retest could not be prepared");
  }
});

export default router;
