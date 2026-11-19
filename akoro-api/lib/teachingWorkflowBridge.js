/**
 * lib/teachingWorkflowBridge.js — the canonical teaching-session and turn
 * workflow functions the Python agent bridge drives, installed at boot
 * (Phase 19 step 2). agent-tools/teaching-workflow-routes.js reads this instead
 * of importing adaptive-learning/teaching-session and teaching-workflow.
 */
let bridge = null;

export function setTeachingWorkflowBridge(next) {
  bridge = next;
}

/**
 * → { TEACHING_TURN_WORKFLOW, prepareTeachingSession, TEACHING_MODES,
 *     createSessionRecord, ensureSessionRecord, appendSessionBlocks,
 *     completeSessionRecord, carryForward, resultToTypedBlocks }
 */
export function teachingWorkflowBridge() {
  if (!bridge) throw new Error("Teaching workflow bridge used before installation (setTeachingWorkflowBridge at boot).");
  return bridge;
}
