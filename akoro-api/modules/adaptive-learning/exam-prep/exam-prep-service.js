/**
 * exam-prep-service.js — the topic-workflow layer of the study-prep build.
 *
 * Extracted from the exam-prep-confidence router (Master Plan §4.8.1) so the
 * study-prep harness can drive the same topic workflow the router exposes,
 * and so the submit race is fixed once, in one place (§4.8.2):
 *
 *   • The attempt write is a conditional update (submitted_at IS NULL) and the
 *     winner is CHECKED — a concurrent double-submit loses cleanly and returns
 *     attempt_already_submitted instead of double-scoring.
 *   • The run update is guarded by .eq("status", expected) so a concurrent
 *     status transition can never be clobbered.
 *
 * The router keeps auth + response envelope only. Behaviour (statuses,
 * teach-back handoff, change-approach copy) is unchanged.
 *
 * Phase 5 (Grand Plan §8.3): the run is an ATTEMPT RECORD. Inside Study Prep
 * the topic state machine is the state — a Study Prep attempt is submitted
 * through submitStudyPrepAttempt (one transaction: score + run record + topic
 * outcome, edu.study_prep_submit_attempt), and a Study Prep run gets no
 * separate projection. The standalone route keeps its run statuses and its
 * `workflow` projection (adaptive_workflow_runs), now checked by the one run
 * definition (study-prep/workflow.js examPrepRunWorkflow) — the old
 * workflow-state.js / adaptive-workflows.js are folded in here.
 */
import { v4 as uuid } from "uuid";

import db from "../../../db.js";
import { OPENAI_MODEL, openai } from "../../../lib/aiModel.js";
import { parseJsonLoose } from "../../tasks/tools/_json.js";
import { normaliseExamConfidenceQuestions } from "./exam-prep-confidence-validation.js";
import { applyThreshold, scoreAttempt } from "../study-prep/education-engine.js";
import { runStatusAfterScore } from "../study-prep/state-machine.js";
import { canTransitionRun, runStepEvent } from "../study-prep/workflow.js";
import { publicGroupedWorkflows } from "../study-prep/workflow-grouping.js";

// ── the run's projection for the standalone route (was adaptive-workflows.js) ──

// Default-on kill switch: workflow projections ship enabled; =false removes them.
const projectionsEnabled = () => String(process.env.AKORO_ADAPTIVE_WORKFLOWS_ENABLED ?? "true").toLowerCase() !== "false";
const safe = (value, maximum) => String(value || "").replace(/[\r\n\x00]+/g, " ").trim().slice(0, maximum);

export async function startExamPrepWorkflow({ learnerId, examPrepRunId, topic, subject, examBoard, policyVersion, attempt }) {
  if (!projectionsEnabled()) return null;
  const { data: run, error } = await db.schema("edu").from("adaptive_workflow_runs").insert({
    learner_id: learnerId, workflow_type: "exam_prep", exam_prep_run_id: examPrepRunId,
    topic: safe(topic, 180), subject: safe(subject, 180), exam_board: safe(examBoard, 80),
    policy_version: safe(policyVersion, 80), state: "diagnostic_ready", current_attempt: Number(attempt) || 1,
  }).select("*").single();
  if (error) throw error;
  const event = runStepEvent({ state: "diagnostic_ready", attempt });
  const { error: stepError } = await db.schema("edu").from("adaptive_workflow_steps").insert({
    workflow_run_id: run.id, state: event.state, label: event.label, attempt_number: event.attempt,
  });
  if (stepError) throw stepError;
  return publicWorkflow(run);
}

export async function transitionExamPrepWorkflow({ learnerId, examPrepRunId, from, to, attempt, score }) {
  if (!projectionsEnabled()) return null;
  if (!canTransitionRun(from, to)) throw new Error("Invalid adaptive workflow transition");
  const { data: current, error: currentError } = await db.schema("edu").from("adaptive_workflow_runs")
    .select("*").eq("learner_id", learnerId).eq("exam_prep_run_id", examPrepRunId).maybeSingle();
  if (currentError) throw currentError;
  // Migration/flag activation may happen after an existing exam-prep run. The
  // workflow remains additive and starts observing from the current public state.
  if (!current) return null;
  if (!canTransitionRun(current.state, to)) return publicWorkflow(current);
  const event = runStepEvent({ state: to, attempt, score });
  const { data: updated, error } = await db.schema("edu").from("adaptive_workflow_runs").update({
    state: to, current_attempt: event.attempt || current.current_attempt,
    // Starting a retest must retain the prior diagnostic score; a score exists
    // only when an assessment-recorded transition supplies one.
    last_score: event.score == null ? current.last_score : event.score,
    updated_at: new Date().toISOString(), completed_at: ["passed", "change_approach", "cancelled"].includes(to) ? new Date().toISOString() : null,
  }).eq("id", current.id).eq("state", current.state).select("*").maybeSingle();
  if (error) throw error;
  if (!updated) return publicWorkflow(current); // a concurrent transition won; no duplicate event
  const { error: stepError } = await db.schema("edu").from("adaptive_workflow_steps").insert({
    workflow_run_id: updated.id, state: event.state, label: event.label,
    attempt_number: event.attempt, score: event.score,
  });
  if (stepError) throw stepError;
  return publicWorkflow(updated);
}

export function publicWorkflow(row) {
  if (!row) return null;
  return {
    id: row.id, type: row.workflow_type, state: row.state, topic: row.topic,
    subject: row.subject, examBoard: row.exam_board, currentAttempt: Number(row.current_attempt),
    lastScore: row.last_score == null ? null : Number(row.last_score), policyVersion: row.policy_version,
    updatedAt: row.updated_at, completedAt: row.completed_at || null,
  };
}

export async function listLearnerWorkflows(learnerId, limit = 12) {
  if (!projectionsEnabled()) return [];
  // Fetch a wider window than the limit, then GROUP by study-prep session so
  // one session (even with six topics) is a single list entry with nested
  // topics — other workflow types stay visible beside it (Master Plan §4.8.3).
  const capped = Math.max(1, Math.min(Number(limit) || 12, 30));
  const { data, error } = await db.schema("edu").from("adaptive_workflow_runs").select("*")
    .eq("learner_id", learnerId).order("updated_at", { ascending: false }).limit(capped * 3);
  if (error) throw error;
  return publicGroupedWorkflows(data || [], publicWorkflow).slice(0, capped);
}

/** A run that belongs to a Study Prep topic: its topic is the state, not the run. */
const studyPrepRun = (run) => Boolean(run?.study_prep_topic_id);

export class ExamPrepRequestError extends Error {}
export class ExamPrepConflictError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// 8-4-4-4-12 (it once required 13 in the last group: every real run read as missing).
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value, maximum) => String(value || "").replace(/[\r\n\x00]+/g, " ").trim().slice(0, maximum);

export function examPrepInput(body) {
  const topic = text(body?.topic, 180);
  const subject = text(body?.subject || "General", 180);
  const examBoard = text(body?.examBoard || "WAEC", 80).toUpperCase();
  const requestedCount = Number(body?.questionCount ?? 5);
  if (topic.length < 3 || !subject || !examBoard || !Number.isInteger(requestedCount) || requestedCount < 3 || requestedCount > 10) {
    throw new ExamPrepRequestError("topic, subject, examBoard, and 3 to 10 questions are required");
  }
  return { topic, subject, examBoard, questionCount: requestedCount };
}

export function publicRun(row) {
  return {
    id: row.id, topic: row.topic, subject: row.subject, examBoard: row.exam_board,
    questionProvenance: row.question_provenance, questionCount: Number(row.question_count), passThreshold: Number(row.pass_threshold),
    maxAttempts: Number(row.max_attempts), currentAttempt: Number(row.current_attempt),
    lastScore: row.last_score == null ? null : Number(row.last_score), status: row.status,
    policyVersion: row.policy_version, completedAt: row.completed_at || null,
  };
}

export function publicAttempt(row) {
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

export async function examPrepPolicyFor(examBoard, subject) {
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

/**
 * `prepaid`: the caller already charged the learner a flat price for this
 * practice (Study Prep, harness.practice.generate), so the platform pays the
 * tokens — otherwise the learner was billed twice for one practice. Without
 * it (the standalone exam-prep route) the call is metered to the learner.
 */
export async function generateExamPrepAttempt({ topic, subject, examBoard, count, attemptNumber, kind, prepaid = false }) {
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL, max_tokens: 3500, __feature: "exam_prep_generation", ...(prepaid ? { __payer: "platform" } : {}), messages: [{ role: "user", content: `Create ${count} fresh multiple-choice, generated exam-style practice questions.
This is not a historical past paper and must not claim to be one.
Board style: ${examBoard}; subject: ${subject}; topic: ${topic}; attempt: ${attemptNumber}; kind: ${kind}.
Use different question wording/examples from earlier attempts. Every question needs exactly four options and one unambiguous answer index.
Return JSON only: {"questions":[{"question":"...","options":["...","...","...","..."],"answerIndex":0,"objective":"...","difficulty":"easy|medium|hard"}]}` }],
  });
  return normaliseExamConfidenceQuestions(
    parseJsonLoose(response.choices?.[0]?.message?.content || ""), count, uuid,
  );
}

export async function getOwnedExamPrepRun(runId, learnerId) {
  if (!RUN_ID.test(runId)) return null;
  const { data, error } = await db.schema("edu").from("learner_exam_prep_runs").select("*")
    .eq("id", runId).eq("learner_id", learnerId).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Pure submission scoring lives in the Education Engine
 * (study-prep/education-engine.js) — deterministic, LLM-free, unit-tested
 * there. The answer key never leaves the server; the caller sends only
 * {questionId, answerIndex} pairs the learner chose.
 */
export const scoreSubmission = scoreAttempt;

/**
 * The run record's status after a score — for the standalone route only.
 * Study Prep never reads it to move a topic (§8.3): the topic machine does.
 */
export function nextRunStatus({ score, passThreshold, currentAttempt, maxAttempts }) {
  const { passed, capped } = applyThreshold({ score, passThreshold, attemptsUsed: Number(currentAttempt), maxAttempts });
  return { passed, capped, status: runStatusAfterScore({ passed, currentAttempt, maxAttempts }) };
}

/** Start a diagnostic run (optionally linked to a study-prep session topic). */
export async function startExamPrepRun({ learnerId, request, studyPrepTopicId = null, prepaid = false }) {
  const policy = await examPrepPolicyFor(request.examBoard, request.subject);
  const questions = await generateExamPrepAttempt({ ...request, count: request.questionCount, attemptNumber: 1, kind: "diagnostic", prepaid });
  const insert = {
    learner_id: learnerId, topic: request.topic, subject: request.subject, exam_board: request.examBoard,
    pass_threshold: policy.pass_threshold, max_attempts: policy.max_attempts, policy_version: policy.policy_version,
    question_count: request.questionCount,
  };
  if (studyPrepTopicId) insert.study_prep_topic_id = studyPrepTopicId;
  const { data: run, error: runError } = await db.schema("edu").from("learner_exam_prep_runs").insert(insert).select("*").single();
  if (runError) throw runError;
  const answerKey = Object.fromEntries(questions.map((question) => [question.id, question.answerIndex]));
  const publicQuestions = questions.map(({ answerIndex, ...question }) => question);
  const { data: attempt, error: attemptError } = await db.schema("edu").from("learner_exam_prep_attempts").insert({
    run_id: run.id, attempt_number: 1, kind: "diagnostic", questions: publicQuestions, answer_key: answerKey,
  }).select("*").single();
  if (attemptError) throw attemptError;
  let workflow = null;
  // A Study Prep run is only an attempt record: its topic is the state (no projection).
  if (!studyPrepTopicId) try {
    workflow = await startExamPrepWorkflow({
      learnerId, examPrepRunId: run.id, topic: run.topic, subject: run.subject,
      examBoard: run.exam_board, policyVersion: run.policy_version, attempt: 1,
    });
  } catch (workflowError) {
    // The exam attempt remains authoritative. A workflow projection outage is
    // visible in logs and never causes a second generated diagnostic.
    console.error("[exam-prep-service/workflow-start]", workflowError?.message || workflowError);
  }
  return { run, attempt, workflow };
}

/**
 * Submit answers for the run's open attempt.
 *
 * Single-writer discipline (Master Plan §4.8.2): the attempt update is a
 * conditional write whose winner is checked; only the winner proceeds to the
 * status-guarded run update. A losing concurrent submit returns
 * attempt_already_submitted; a concurrent status change never gets clobbered.
 */
export async function submitExamPrepAttempt({ learnerId, runId, answers }) {
  const run = await getOwnedExamPrepRun(runId, learnerId);
  if (!run) return { notFound: true };
  if (!["diagnostic_ready", "retest_ready"].includes(run.status)) {
    throw new ExamPrepConflictError("This exam-prep attempt is not ready for submission", "attempt_not_ready");
  }
  // One source of state: a Study Prep attempt is submitted with its topic (submitStudyPrepAttempt).
  if (studyPrepRun(run)) {
    throw new ExamPrepConflictError("This practice belongs to a Study Prep topic — submit it from the plan", "attempt_not_ready");
  }
  const { data: attempt, error } = await db.schema("edu").from("learner_exam_prep_attempts").select("*")
    .eq("run_id", run.id).eq("attempt_number", run.current_attempt).is("submitted_at", null).maybeSingle();
  if (error) throw error;
  if (!attempt) throw new ExamPrepConflictError("This attempt was already submitted", "attempt_already_submitted");

  let scored;
  try {
    scored = scoreSubmission(attempt.answer_key || {}, answers);
  } catch {
    throw new ExamPrepRequestError("Answers are invalid");
  }
  const { submitted, total, correct, score } = scored;
  const { passed, status: nextStatus } = nextRunStatus({
    score, passThreshold: run.pass_threshold, currentAttempt: run.current_attempt, maxAttempts: run.max_attempts,
  });
  const now = new Date().toISOString();

  // 1) Conditional attempt write — the winner is the submit that flips
  //    submitted_at from NULL. A race loser updates zero rows here.
  const attemptWrite = await db.schema("edu").from("learner_exam_prep_attempts")
    .update({ submitted_answers: submitted, score, submitted_at: now })
    .eq("id", attempt.id).is("submitted_at", null).select("id").maybeSingle();
  if (attemptWrite.error) throw attemptWrite.error;
  if (!attemptWrite.data) {
    throw new ExamPrepConflictError("This attempt was already submitted", "attempt_already_submitted");
  }

  // 2) Status-guarded run update — only the attempt winner reaches this; a
  //    concurrent transition winner keeps its state.
  const runWrite = await db.schema("edu").from("learner_exam_prep_runs")
    .update({ status: nextStatus, last_score: score, updated_at: now, completed_at: passed ? now : null })
    .eq("id", run.id).eq("learner_id", learnerId).eq("status", run.status).select("*").maybeSingle();
  if (runWrite.error) throw runWrite.error;
  const updated = runWrite.data || { ...run, status: nextStatus, last_score: score, completed_at: passed ? now : null };

  let workflow = null;
  try {
    workflow = await transitionExamPrepWorkflow({
      learnerId, examPrepRunId: run.id, from: run.status, to: nextStatus,
      attempt: Number(run.current_attempt), score,
    });
  } catch (workflowError) {
    console.error("[exam-prep-service/workflow-transition]", workflowError?.message || workflowError);
  }
  return { run: updated, workflow, score, correct, total, passed, nextStatus };
}

/**
 * Submit a Study Prep attempt (Phase 5): the Education Engine scores it here
 * (the key never leaves the server), then ONE transaction —
 * edu.study_prep_submit_attempt — writes the attempt's score, the run record
 * and the topic's §8.3 outcome together, once. A second submit of the same
 * attempt changes nothing and reports the score already recorded.
 *   → { ok, applied, duplicate?, code?, score, correct, total, passed, capped, topic } | { notFound }
 * Evidence is the caller's, after commit (recordLearningEvent).
 */
export async function submitStudyPrepAttempt({ learnerId, sessionId, topicId, runId, answers }) {
  const run = await getOwnedExamPrepRun(runId, learnerId);
  if (!run || run.study_prep_topic_id !== topicId) return { notFound: true };
  const { data: attempt, error } = await db.schema("edu").from("learner_exam_prep_attempts").select("*")
    .eq("run_id", run.id).eq("attempt_number", run.current_attempt).maybeSingle();
  if (error) throw error;
  if (!attempt) return { notFound: true };
  if (attempt.submitted_at) {
    return { ok: true, applied: false, duplicate: true, code: "attempt_already_submitted", score: attempt.score == null ? null : Number(attempt.score) };
  }
  let scored;
  try {
    scored = scoreSubmission(attempt.answer_key || {}, answers);
  } catch {
    throw new ExamPrepRequestError("invalid_answers");
  }
  const { data, error: rpcError } = await db.schema("edu").rpc("study_prep_submit_attempt", {
    p_learner_id: learnerId, p_session_id: sessionId, p_topic_id: topicId, p_run_id: run.id, p_attempt_id: attempt.id,
    p_submitted: scored.submitted, p_correct: scored.correct, p_total: scored.total, p_score: scored.score,
  });
  if (rpcError) throw rpcError;
  const out = data || {};
  if (out.code === "not_found") return { notFound: true };
  return {
    ok: out.ok === true, applied: out.applied === true, duplicate: out.duplicate === true, code: out.code || null,
    score: out.score == null ? scored.score : Number(out.score), correct: scored.correct, total: scored.total,
    passed: out.passed === true, capped: out.capped === true, topic: out.topic || null, runStatus: out.run_status || null,
  };
}

/** Fresh retest — hard-gated on the learner's own teach-back confirmation. */
export async function startExamPrepRetest({ learnerId, runId, learnerConfirmedReady, prepaid = false }) {
  const run = await getOwnedExamPrepRun(runId, learnerId);
  if (!run) return { notFound: true };
  if (run.status !== "teach_back_required" || Number(run.current_attempt) >= Number(run.max_attempts)) {
    throw new ExamPrepConflictError("A retest is not available for this run", "retest_not_available");
  }
  if (learnerConfirmedReady !== true) {
    throw new ExamPrepRequestError("learnerConfirmedReady must be true to request a fresh retest");
  }
  const attemptNumber = Number(run.current_attempt) + 1;
  const questions = await generateExamPrepAttempt({ topic: run.topic, subject: run.subject, examBoard: run.exam_board, count: Number(run.question_count), attemptNumber, kind: "retest", prepaid });
  const key = Object.fromEntries(questions.map((question) => [question.id, question.answerIndex]));
  const publicQuestions = questions.map(({ answerIndex, ...question }) => question);
  const { data: attempt, error: attemptError } = await db.schema("edu").from("learner_exam_prep_attempts").insert({
    run_id: run.id, attempt_number: attemptNumber, kind: "retest", questions: publicQuestions, answer_key: key,
  }).select("*").single();
  if (attemptError) throw attemptError;
  const { data: updated, error: runError } = await db.schema("edu").from("learner_exam_prep_runs").update({
    current_attempt: attemptNumber, status: "retest_ready", updated_at: new Date().toISOString(),
  }).eq("id", run.id).eq("learner_id", learnerId).eq("status", run.status).select("*").maybeSingle();
  if (runError) throw runError;
  let workflow = null;
  if (!studyPrepRun(run)) try {
    workflow = await transitionExamPrepWorkflow({
      learnerId, examPrepRunId: run.id, from: run.status, to: "retest_ready",
      attempt: attemptNumber,
    });
  } catch (workflowError) {
    console.error("[exam-prep-service/workflow-retest]", workflowError?.message || workflowError);
  }
  return { run: updated || { ...run, current_attempt: attemptNumber, status: "retest_ready" }, attempt, workflow };
}

export async function listExamPrepRuns(learnerId, limit = 10) {
  const { data, error } = await db.schema("edu").from("learner_exam_prep_runs").select("*")
    .eq("learner_id", learnerId).order("updated_at", { ascending: false }).limit(Math.max(1, Math.min(Number(limit) || 10, 50)));
  if (error) throw error;
  return data || [];
}

export async function getExamPrepAttemptRow(learnerId, runId, attemptNumber) {
  const run = await getOwnedExamPrepRun(runId, learnerId);
  if (!run) return { notFound: true };
  const { data: attempt, error } = await db.schema("edu").from("learner_exam_prep_attempts").select("*")
    .eq("run_id", run.id).eq("attempt_number", Number(attemptNumber)).maybeSingle();
  if (error) throw error;
  if (!attempt || !attempt.submitted_at) return { notReady: true, run };
  return { run, attempt };
}
