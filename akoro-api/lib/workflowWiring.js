/**
 * lib/workflowWiring.js — the Study Prep and Decay Review wiring modules,
 * imported by boot so their workflow registrations run before any route or
 * worker. battle/worker.js and workflows/routes.js read this registry instead
 * of importing the wiring modules themselves (Phase 19 step 2).
 */
let wiring = null;

export function setWorkflowWiring(next) {
  wiring = next;
}

/**
 * → { reportCheckQuestion, completeAgentCheckBattle, ensureStudyPrepWorkflow,
 *     backfillStudyPrepWorkflows, decayReview }
 */
export function workflowWiring() {
  if (!wiring) throw new Error("Workflow wiring used before installation (setWorkflowWiring at boot).");
  return wiring;
}
