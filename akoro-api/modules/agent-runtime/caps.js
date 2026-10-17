/**
 * agent-runtime/caps.js — each workflow's loop limits (Grand Plan §7.2).
 * Code constants: the model never sets them.
 *
 *   maxIterations     decisions per step / turn
 *   maxToolCalls      tool calls per step (Study Prep's session guard)
 *   decisionTimeoutMs one decision; past it the loop falls back (Teaching,
 *                     Decay) or ends the step as an agent error (Study Prep,
 *                     Practice)
 *
 * Study Prep's values are today's (6 iterations, 40 calls); its timeout sits
 * above the LLM call's own 45 s × 2 tries so the runtime never cuts it short.
 * The others are the plan's starting values, to tune (§20).
 */
export const WORKFLOW_CAPS = Object.freeze({
  study_prep:   Object.freeze({ maxIterations: 6, maxToolCalls: 40,  decisionTimeoutMs: 120_000, onTimeout: "error" }),
  teaching:     Object.freeze({ maxIterations: 3, maxToolCalls: 120, decisionTimeoutMs: 8_000,   onTimeout: "fallback" }),
  decay_review: Object.freeze({ maxIterations: 3, maxToolCalls: 60,  decisionTimeoutMs: 8_000,   onTimeout: "fallback" }),
  practice:     Object.freeze({ maxIterations: 4, maxToolCalls: 30,  decisionTimeoutMs: 20_000,  onTimeout: "error" }),
});

export function capsFor(workflowType, overrides = {}) {
  const base = WORKFLOW_CAPS[workflowType];
  if (!base) throw new Error(`No caps for workflow "${workflowType}"`);
  return { ...base, ...overrides };
}
