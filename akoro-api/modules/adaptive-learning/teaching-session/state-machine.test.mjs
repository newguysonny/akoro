import assert from "node:assert/strict";
import test from "node:test";

import {
  STUDENT_PHASES, TEACHING_SESSION_PHASES, ACTION_FOR_DIALOGUE_MOVE,
  applyTeachingProgress,
} from "./state-machine.js";

test("the phase tables are frozen and complete", () => {
  assert.deepEqual(TEACHING_SESSION_PHASES, ["PHASE_1", "PHASE_2", "PHASE_3", "PHASE_4", "MASTERY"]);
  for (const phase of TEACHING_SESSION_PHASES) {
    assert.ok(STUDENT_PHASES[phase], `${phase} has a learner-facing label`);
  }
  assert.ok(Object.isFrozen(ACTION_FOR_DIALOGUE_MOVE));
});

test("evidence-verified advancement moves to the next subtopic", () => {
  const result = applyTeachingProgress({
    phase: "PHASE_2", mustKnowIndex: 0, mustKnowCount: 4,
    canAdvance: true, allConceptsVerified: false,
    requestedPhase: "PHASE_3", dialogueMove: "consolidate_and_advance",
  });
  assert.equal(result.subtopicAdvanced, true);
  assert.equal(result.mustKnowIndex, 1);
  assert.equal(result.nextAction, "NEXT_SUBTOPIC");
  assert.equal(result.nextMustKnowIndex, 1);
  // Advancement evidence also honours the guide's requested phase change in
  // the same turn — both applied together, exactly as the inline gate did.
  assert.equal(result.phaseChanged, true);
  assert.equal(result.phase, "PHASE_3");

  // No phase requested → only the subtopic moves.
  const noRequest = applyTeachingProgress({
    phase: "PHASE_2", mustKnowIndex: 0, mustKnowCount: 4,
    canAdvance: true, allConceptsVerified: false,
    requestedPhase: null, dialogueMove: "consolidate_and_advance",
  });
  assert.equal(noRequest.subtopicAdvanced, true);
  assert.equal(noRequest.phaseChanged, false);
  assert.equal(noRequest.phase, "PHASE_2");
});

test("without advancement evidence the guide digs into the dialogue move instead", () => {
  const result = applyTeachingProgress({
    phase: "PHASE_2", mustKnowIndex: 1, mustKnowCount: 4,
    canAdvance: false, allConceptsVerified: false,
    requestedPhase: "PHASE_3", dialogueMove: "repair_misconception",
  });
  assert.equal(result.subtopicAdvanced, false);
  assert.equal(result.mustKnowIndex, 1);
  assert.equal(result.nextAction, "CLEAR_MISTAKE");
  assert.equal(result.phaseChanged, false);
  // An unknown dialogue move falls back to the safe default.
  assert.equal(applyTeachingProgress({
    phase: "PHASE_1", mustKnowIndex: 0, mustKnowCount: 2,
    canAdvance: false, allConceptsVerified: false, dialogueMove: "unknown_move",
  }).nextAction, "DIG_DEEPER");
});

test("mastery requires every concept verified and no subtopic left", () => {
  const result = applyTeachingProgress({
    phase: "PHASE_4", mustKnowIndex: 2, mustKnowCount: 3,
    canAdvance: true, allConceptsVerified: true,
    requestedPhase: null, dialogueMove: "synthesise",
  });
  assert.equal(result.enteredMastery, true);
  assert.equal(result.phase, "MASTERY");
  assert.equal(result.phaseChanged, true);
  assert.equal(result.nextAction, "MASTERY");

  // Last subtopic but concepts still unverified: no mastery, no advance past the gate.
  const held = applyTeachingProgress({
    phase: "PHASE_4", mustKnowIndex: 2, mustKnowCount: 3,
    canAdvance: true, allConceptsVerified: false,
    requestedPhase: "MASTERY", dialogueMove: "synthesise",
  });
  assert.equal(held.enteredMastery, false);
  assert.equal(held.phase, "PHASE_4");
});

test("a guide-requested phase applies only when the evidence allows advancement", () => {
  const allowed = applyTeachingProgress({
    phase: "PHASE_1", mustKnowIndex: 0, mustKnowCount: 3,
    canAdvance: true, allConceptsVerified: false,
    requestedPhase: "PHASE_2", dialogueMove: "clarify_core",
  });
  assert.equal(allowed.phaseChanged, true);
  assert.equal(allowed.phase, "PHASE_2");

  // Without advancement evidence the request changes nothing.
  const denied = applyTeachingProgress({
    phase: "PHASE_1", mustKnowIndex: 0, mustKnowCount: 3,
    canAdvance: false, allConceptsVerified: false,
    requestedPhase: "PHASE_2", dialogueMove: "clarify_core",
  });
  assert.equal(denied.phaseChanged, false);
  assert.equal(denied.phase, "PHASE_1");

  // A request for the phase the session is already in changes nothing.
  const same = applyTeachingProgress({
    phase: "PHASE_2", mustKnowIndex: 1, mustKnowCount: 3,
    canAdvance: true, allConceptsVerified: false,
    requestedPhase: "PHASE_2", dialogueMove: "clarify_core",
  });
  assert.equal(same.phaseChanged, false);
});
