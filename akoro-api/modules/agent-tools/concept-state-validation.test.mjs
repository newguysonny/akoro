import assert from "node:assert/strict";
import test from "node:test";

import {
  conceptObservationsRequest,
  conceptResolutionRequest,
  conceptSnapshotRequest,
  publicState,
} from "./concept-state-validation.js";

const conceptId = "0e5be9d1-8c57-4f5d-b2ce-9879de1d5000";
const context = { sessionId: "python_session_1", toolContext: "signed-capability" };

test("concept scope resolution requires an explicit approved curriculum scope", () => {
  assert.deepEqual(conceptResolutionRequest({
    ...context, curriculumKey: " NERDC-JSS2-BASIC-SCIENCE-V1 ", subject: "Basic   Science", topicKey: "Photosynthesis",
  }), {
    ...context, curriculumKey: "nerdc-jss2-basic-science-v1", subject: "Basic Science", topicKey: "photosynthesis",
  });
  assert.throws(() => conceptResolutionRequest({ ...context, subject: "Biology", topicKey: "photosynthesis" }), /required/);
});

test("concept snapshots are bounded and reject duplicate or non-UUID ids", () => {
  assert.deepEqual(conceptSnapshotRequest({ ...context, conceptIds: [conceptId] }), { ...context, conceptIds: [conceptId] });
  assert.throws(() => conceptSnapshotRequest({ ...context, conceptIds: [conceptId, conceptId] }), /duplicates/);
  assert.throws(() => conceptSnapshotRequest({ ...context, conceptIds: ["invented"] }), /UUIDs/);
});

test("observations have separate quality, validity, and confidence fractions", () => {
  const parsed = conceptObservationsRequest({
    ...context,
    turnId: "turn_0001",
    observations: [{
      conceptId,
      kind: "demonstrated_understanding",
      responseQuality: 0.8,
      claimValidity: 0.9,
      modelConfidence: 0.7,
      claimStatus: "supported",
      evidenceSummary: "The response correctly identified the inputs.",
    }],
  });
  assert.equal(parsed.observations[0].claimValidity, 0.9);
  assert.throws(() => conceptObservationsRequest({ ...parsed, observations: [{ ...parsed.observations[0], responseQuality: 80 }] }), /fraction/);
  assert.throws(() => conceptObservationsRequest({ ...parsed, observations: [parsed.observations[0], parsed.observations[0]] }), /repeat/);
});

test("empty state is rendered as canonical fraction values", () => {
  assert.deepEqual(publicState(null, conceptId), {
    conceptId, mastery: 0, retention: 0, evidenceConfidence: 0,
    misconceptionActive: false, evidenceCount: 0, lastEvidenceAt: null,
    nextReviewDue: null, lastRetentionDecayAt: null, stateVersion: 1,
  });
});
