/**
 * Public, observable state machine for learner-owned adaptive workflows.
 * It is deliberately separate from an LLM scratchpad and admits no hidden
 * reasoning, raw tool output, or browser-provided state transition.
 */
export const WORKFLOW_STATES = new Set([
  "researching", "planned", "diagnostic_ready", "teach_back_required",
  "retest_ready", "passed", "change_approach", "cancelled",
]);

const NEXT = {
  researching: new Set(["planned", "cancelled"]),
  planned: new Set(["diagnostic_ready", "cancelled"]),
  diagnostic_ready: new Set(["teach_back_required", "passed", "change_approach", "cancelled"]),
  teach_back_required: new Set(["retest_ready", "cancelled"]),
  retest_ready: new Set(["teach_back_required", "passed", "change_approach", "cancelled"]),
  passed: new Set(), change_approach: new Set(), cancelled: new Set(),
};

export function canTransitionWorkflow(from, to) {
  return WORKFLOW_STATES.has(from) && WORKFLOW_STATES.has(to) && (from === to || NEXT[from]?.has(to) === true);
}

export function workflowEvent({ state, attempt = null, score = null }) {
  if (!WORKFLOW_STATES.has(state)) throw new Error("Unknown workflow state");
  const cleanAttempt = Number.isInteger(Number(attempt)) && Number(attempt) > 0 ? Number(attempt) : null;
  // No score is no score: Number(null) is 0, which used to overwrite the
  // learner's earlier diagnostic score with 0 when a retest started.
  const cleanScore = score != null && score !== "" && Number.isFinite(Number(score)) ? Math.max(0, Math.min(1, Number(score))) : null;
  const label = {
    researching: "Preparing approved study context",
    planned: "Practice plan ready",
    diagnostic_ready: "Generated practice ready",
    teach_back_required: "Teach-back available before a fresh retest",
    retest_ready: "Fresh generated retest ready",
    passed: "Assessment result recorded",
    change_approach: "Attempt cap reached; choose a different approach",
    cancelled: "Workflow cancelled",
  }[state];
  // The event payload is safe for learner/status surfaces, not a model trace.
  return { state, label, ...(cleanAttempt ? { attempt: cleanAttempt } : {}), ...(cleanScore != null ? { score: cleanScore } : {}) };
}
