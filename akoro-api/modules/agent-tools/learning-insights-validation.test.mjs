import test from "node:test";
import assert from "node:assert/strict";

import { insightMeasurementRequest, publicProfile } from "./learning-insights-validation.js";

const capability = { sessionId: "lesson_12", toolContext: "signed-context" };
const conceptId = "550e8400-e29b-41d4-a716-446655440000";

test("accepts one bounded observed measurement and a reviewed episode reference", () => {
  const result = insightMeasurementRequest({
    ...capability, turnId: "turn-1",
    measurement: {
      attention: 0.82, fatigue: 0.12, reasoningQuality: 0.71,
      reasoningStyle: "causal", measurementStatus: "observed",
      episode: { conceptId, kind: "verified_progress" },
    },
  });
  assert.equal(result.measurement.attention, 0.82);
  assert.equal(result.episode.kind, "verified_progress");
});

test("rejects a fake not_checked signal and raw episode wording", () => {
  assert.throws(() => insightMeasurementRequest({
    ...capability, turnId: "turn-1",
    measurement: { attention: 0.1, fatigue: 0, reasoningQuality: 0, reasoningStyle: "not_observed", measurementStatus: "not_checked" },
  }), /not_checked/);
  assert.throws(() => insightMeasurementRequest({
    ...capability, turnId: "turn-1",
    measurement: {
      attention: 0, fatigue: 0, reasoningQuality: 0, reasoningStyle: "not_observed", measurementStatus: "not_checked",
      episode: { conceptId, kind: "verified_progress", summary: "This must never be accepted" },
    },
  }), /episode/);
});

test("keeps a profile public shape free of timestamps and raw turn data", () => {
  const profile = publicProfile({ evidence_count: 4, profile_confidence: 0.66, reasoning_style: "transfer", pacing_recommendation: "steady" });
  assert.deepEqual(profile, {
    evidenceCount: 4, profileConfidence: 0.66, meanAttention: 0, meanFatigue: 0,
    meanReasoningQuality: 0, reasoningStyle: "transfer", pacingRecommendation: "steady",
    policyVersion: "learner-signals-v1", expiresAt: null,
  });
});
