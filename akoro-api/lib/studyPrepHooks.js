/**
 * lib/studyPrepHooks.js — the Study Prep hooks materials filing needs,
 * installed at boot (Phase 19 step 2). materials/filingDb.js reads this instead
 * of importing adaptive-learning/study-prep internals.
 */
let hooks = null;

export function setStudyPrepHooks(next) {
  hooks = next;
}

/** → { attachUploadsToStudyPrep } */
export function studyPrepHooks() {
  if (!hooks) throw new Error("Study Prep hooks used before installation (setStudyPrepHooks at boot).");
  return hooks;
}
