/**
 * lib/learningRecordBridge.js — the ONE learning-evidence recorder and the
 * retention refresh, installed at boot (Phase 19 step 2). The concept-state
 * gateway reads this instead of importing adaptive-learning/learner internals.
 */
let bridge = null;

export function setLearningRecordBridge(next) {
  bridge = next;
}

/** → { recordLearningEvent, refreshConceptRetention } */
export function learningRecordBridge() {
  if (!bridge) throw new Error("Learning record bridge used before installation (setLearningRecordBridge at boot).");
  return bridge;
}
