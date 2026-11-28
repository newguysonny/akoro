import assert from "node:assert/strict";
import test from "node:test";

import {
  DIALOGUE_MOVES,
  LEARNER_PACE_MODES,
  applyTeachingObservation,
  capProtegeAnalysis,
  createTeachingEvidenceState,
  publicTeachingEvidence,
  resolveLearnerPace,
  serialiseTeachingEvidence,
} from "./teaching-evidence.js";

test("a clear definition alone is exposure, not verified mastery", () => {
  const initial = createTeachingEvidenceState({ conceptCount: 1 });
  const result = applyTeachingObservation(initial, 0, {
    coreExplanation: "clear",
    application: "none",
    reasoning: "none",
    correction: "none",
    misconceptionPresent: false,
  });

  assert.equal(result.current.masteryStatus, "developing");
  assert.equal(result.dialogue.canAdvance, false);
  assert.equal(result.dialogue.move, DIALOGUE_MOVES.APPLY_IN_CONTEXT);
  assert.ok(result.current.protegeUnderstanding <= 0.6);
});

test("a distinct clear application verifies the current concept", () => {
  const state = createTeachingEvidenceState({ conceptCount: 1 });
  applyTeachingObservation(state, 0, { coreExplanation: "clear" });
  const result = applyTeachingObservation(state, 0, {
    application: "clear",
    reasoning: "partial",
    misconceptionPresent: false,
  });

  assert.equal(result.current.masteryStatus, "verified");
  assert.equal(result.dialogue.canAdvance, true);
  assert.equal(result.dialogue.move, DIALOGUE_MOVES.CONSOLIDATE_AND_ADVANCE);
  assert.ok(result.current.learnerMastery >= 0.8);
  assert.ok(result.current.protegeUnderstanding >= 0.8);
});

test("an unresolved misconception blocks advancement until a clear repair", () => {
  const state = createTeachingEvidenceState({ conceptCount: 1 });
  applyTeachingObservation(state, 0, { coreExplanation: "clear", application: "clear", misconceptionPresent: true });
  let snapshot = publicTeachingEvidence(state, 0);
  assert.equal(snapshot.currentConcept.masteryStatus, "developing");
  assert.equal(snapshot.dialogue.move, DIALOGUE_MOVES.REPAIR_MISCONCEPTION);

  applyTeachingObservation(state, 0, { correction: "clear", misconceptionPresent: false });
  snapshot = publicTeachingEvidence(state, 0);
  assert.equal(snapshot.currentConcept.unresolvedMisconception, false);
  assert.equal(snapshot.currentConcept.masteryStatus, "verified");
});

test("learner-profile pace is expiry-aware and repeated gaps add temporary support", () => {
  const usableProfile = {
    pacing_recommendation: "stretch",
    evidence_count: 5,
    profile_confidence: 0.8,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
  assert.equal(resolveLearnerPace(usableProfile).mode, LEARNER_PACE_MODES.ACCELERATED);
  assert.equal(resolveLearnerPace({ ...usableProfile, expires_at: new Date(Date.now() - 60_000).toISOString() }).mode, LEARNER_PACE_MODES.STANDARD);

  const state = createTeachingEvidenceState({ conceptCount: 1 });
  applyTeachingObservation(state, 0, { coreExplanation: "none", misconceptionPresent: false });
  const result = applyTeachingObservation(state, 0, { coreExplanation: "none", misconceptionPresent: false });
  assert.equal(result.state.pace.mode, LEARNER_PACE_MODES.SUPPORTED);
  assert.equal(result.state.pace.source, "live_session");
});

test("one maxed-out message does not verify — two separate messages are required", () => {
  const state = createTeachingEvidenceState({ conceptCount: 1 });
  const first = applyTeachingObservation(state, 0, {
    coreExplanation: "clear", application: "clear", reasoning: "clear", misconceptionPresent: false,
  });
  assert.equal(first.current.attempts, 1);
  assert.equal(first.current.masteryStatus, "developing");
  assert.equal(first.dialogue.canAdvance, false);
  assert.equal(first.dialogue.missingEvidence.secondMessage, true);

  const second = applyTeachingObservation(state, 0, { coreExplanation: "partial", misconceptionPresent: false });
  assert.equal(second.current.masteryStatus, "verified");
  assert.equal(second.dialogue.canAdvance, true);
});

test("a dodged protégé question blocks the advance until it is answered", () => {
  const state = createTeachingEvidenceState({ conceptCount: 1 });
  applyTeachingObservation(state, 0, { coreExplanation: "clear", misconceptionPresent: false });
  const dodged = applyTeachingObservation(state, 0, {
    application: "clear", misconceptionPresent: false, answersQuestion: false,
  });
  assert.equal(dodged.current.masteryStatus, "verified");
  assert.equal(dodged.dialogue.canAdvance, false);
  assert.equal(dodged.dialogue.questionDodged, true);
  assert.equal(dodged.dialogue.missingEvidence.questionAnswer, true);

  const answered = applyTeachingObservation(state, 0, {
    reasoning: "partial", misconceptionPresent: false, answersQuestion: true,
  });
  assert.equal(answered.dialogue.canAdvance, true);
  assert.equal(answered.dialogue.questionDodged, false);
});

test("an unavailable evaluator fails closed without adding a negative learner signal", () => {
  const state = createTeachingEvidenceState({ conceptCount: 1 });
  const result = applyTeachingObservation(state, 0, { notChecked: true });

  assert.equal(result.current.attempts, 0);
  assert.equal(result.current.masteryStatus, "introduced");
  assert.equal(result.dialogue.canAdvance, false);
  assert.equal(result.state.pace.mode, LEARNER_PACE_MODES.STANDARD);
});

test("persisted evidence stays bounded and generated protege confidence is capped by evidence", () => {
  const state = createTeachingEvidenceState({ conceptCount: 1 });
  const result = applyTeachingObservation(state, 0, { coreExplanation: "clear" });
  const persisted = serialiseTeachingEvidence(state);
  const encoded = JSON.stringify(persisted);

  assert.doesNotMatch(encoded, /copied|learner said|raw transcript/i);
  assert.equal(persisted.concepts.length, 1);
  assert.equal(capProtegeAnalysis({ understanding: 98, confusion: 0 }, result.current).understanding, 40);

  const untrustedPersisted = serialiseTeachingEvidence({
    pace: { mode: "forged", source: "forged" },
    concepts: [{ humanMessage: "raw transcript must never persist", modelRationale: "also private", coreExplanation: 1 }],
  });
  assert.doesNotMatch(JSON.stringify(untrustedPersisted), /raw transcript|modelRationale|humanMessage/i);
  assert.equal(untrustedPersisted.pace.mode, LEARNER_PACE_MODES.STANDARD);
});
