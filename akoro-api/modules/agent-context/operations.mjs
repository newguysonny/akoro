/**
 * modules/agent-context/operations.mjs — operation → context set, per
 * workflow (Grand Plan §7.4, Phase 4). Data, not behaviour: a workflow
 * controller names the OPERATION it is about to run and asks contextSetFor()
 * which manifest set to load. No caller hard-codes a set name.
 *
 * An operation is live only when all five parts exist (§7.4 five-part rule):
 * context set (manifest.mjs), trigger (the controller's operationFor), the
 * permitted tools, the narrator's decision nodes, the UI category. LIVE lists
 * the operations whose controller already calls contextSetFor(); the rest are
 * mapped (and their sets preflighted at boot) but dormant until their phase.
 *
 * Context failure (§7.4): an unknown workflow or operation throws a
 * `context_unavailable` error — the caller leaves workflow state unchanged and
 * ends the step with that code. It never falls back to a guessed set.
 */

import { SETS } from "./manifest.mjs";

export const OPERATION_SETS = Object.freeze({
  study_prep: Object.freeze({
    research: "research",
    inspection: "research",
    planning: "planning",
    replanning: "planning",
    draft: "planning",
    verification: "safety",
    strategy_selection: "strategies",
    teach_back_creation: "strategies",
    diagnostic: "reflection",
    retest: "reflection",
    reflection: "reflection",
    outcome_evaluation: "reflection",
    synthesis: "reflection",
    topic_advance: "reflection",
    session_completion: "reflection",
    // The agent's short turns after the plan is approved (reasoning/WAKES.md).
    wake: "wake",
  }),
  teaching: Object.freeze({
    // Every teaching-turn operation, by mode (§9): teach_agent → the protégé
    // controller; learn_with_guide → NaNa teaches directly.
    "turn:teach_agent": "teaching_controller",
    "turn:learn_with_guide": "guide_controller",
    select_teaching_strategy: "teaching_strategy",
    adapt_strategy: "teaching_strategy",
  }),
  decay_review: Object.freeze({
    inspect_decay: "decay_inspection",
    inspect_history: "decay_inspection",
    inspect_concept: "decay_inspection",
    evaluate_retention: "decay_inspection",
    intervene: "decay_review",
    select_strategy: "decay_review",
  }),
  practice: Object.freeze({
    prepare: "practice",
    generate: "practice",
    evaluate: "practice",
  }),
});

/** Operations whose controller loads its context through contextSetFor() today. */
export const LIVE_OPERATIONS = Object.freeze({
  study_prep: Object.freeze(["planning", "replanning", "wake"]),
  teaching: Object.freeze([]),       // Phase 6 — the agent-driven teaching controller
  decay_review: Object.freeze([]),   // Phase 8
  practice: Object.freeze([]),       // Phase 9
});

/**
 * Joined sets no operation maps to, each with the reason. Pinned by the
 * contract test so an unreachable set is a conscious decision.
 */
export const UNMAPPED_SETS = Object.freeze({
  teaching: "legacy study-prep inline teaching step; teaching runs as the Teaching workflow (teaching_controller) — retire with Phase 6",
});

export class ContextUnavailableError extends Error {
  constructor(message) { super(message); this.code = "context_unavailable"; }
}

/** The teaching-turn operation for a teaching mode. */
export function teachingTurnOperation(mode) {
  return `turn:${mode === "learn_with_guide" ? "learn_with_guide" : "teach_agent"}`;
}

/** The manifest set one operation of one workflow loads — or context_unavailable. */
export function contextSetFor(workflow, operation) {
  const table = OPERATION_SETS[workflow];
  if (!table) throw new ContextUnavailableError(`No context sets are mapped for workflow "${workflow}"`);
  const set = table[operation];
  if (!set) throw new ContextUnavailableError(`Workflow "${workflow}" has no context set for operation "${operation}"`);
  if (!SETS[set] || SETS[set].mode !== "joined") throw new ContextUnavailableError(`Operation "${workflow}.${operation}" maps to "${set}", which is not a joined manifest set`);
  return set;
}

/** Every (workflow, operation, set) row — for the gate scenario and the contract test. */
export function operationRows() {
  return Object.entries(OPERATION_SETS).flatMap(([workflow, table]) =>
    Object.entries(table).map(([operation, set]) => ({
      workflow, operation, set, live: (LIVE_OPERATIONS[workflow] || []).includes(operation),
    })));
}
