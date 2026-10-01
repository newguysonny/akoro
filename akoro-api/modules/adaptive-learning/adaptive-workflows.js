/** Durable, learner-owned workflow projection for adaptive multi-turn paths. */
import db from "../../db.js";
import { canTransitionWorkflow, workflowEvent } from "./workflow-state.js";
import { publicGroupedWorkflows } from "./study-prep/workflow-grouping.js";

const enabled = () => String(process.env.AKORO_ADAPTIVE_WORKFLOWS_ENABLED || "").toLowerCase() === "true";
const safe = (value, maximum) => String(value || "").replace(/[\r\n\x00]+/g, " ").trim().slice(0, maximum);

export async function startExamPrepWorkflow({ learnerId, examPrepRunId, topic, subject, examBoard, policyVersion, attempt }) {
  if (!enabled()) return null;
  const { data: run, error } = await db.schema("edu").from("adaptive_workflow_runs").insert({
    learner_id: learnerId, workflow_type: "exam_prep", exam_prep_run_id: examPrepRunId,
    topic: safe(topic, 180), subject: safe(subject, 180), exam_board: safe(examBoard, 80),
    policy_version: safe(policyVersion, 80), state: "diagnostic_ready", current_attempt: Number(attempt) || 1,
  }).select("*").single();
  if (error) throw error;
  const event = workflowEvent({ state: "diagnostic_ready", attempt });
  const { error: stepError } = await db.schema("edu").from("adaptive_workflow_steps").insert({
    workflow_run_id: run.id, state: event.state, label: event.label, attempt_number: event.attempt,
  });
  if (stepError) throw stepError;
  return publicWorkflow(run);
}

export async function transitionExamPrepWorkflow({ learnerId, examPrepRunId, from, to, attempt, score }) {
  if (!enabled()) return null;
  if (!canTransitionWorkflow(from, to)) throw new Error("Invalid adaptive workflow transition");
  const { data: current, error: currentError } = await db.schema("edu").from("adaptive_workflow_runs")
    .select("*").eq("learner_id", learnerId).eq("exam_prep_run_id", examPrepRunId).maybeSingle();
  if (currentError) throw currentError;
  // Migration/flag activation may happen after an existing exam-prep run. The
  // workflow remains additive and starts observing from the current public state.
  if (!current) return null;
  if (!canTransitionWorkflow(current.state, to)) return publicWorkflow(current);
  const event = workflowEvent({ state: to, attempt, score });
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
  if (!enabled()) return [];
  // Fetch a wider window than the limit, then GROUP by study-prep session so
  // one session (even with six topics) is a single list entry with nested
  // topics — other workflow types stay visible beside it (Master Plan §4.8.3).
  const capped = Math.max(1, Math.min(Number(limit) || 12, 30));
  const { data, error } = await db.schema("edu").from("adaptive_workflow_runs").select("*")
    .eq("learner_id", learnerId).order("updated_at", { ascending: false }).limit(capped * 3);
  if (error) throw error;
  return publicGroupedWorkflows(data || [], publicWorkflow).slice(0, capped);
}
