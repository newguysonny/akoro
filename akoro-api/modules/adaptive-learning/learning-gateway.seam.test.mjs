// Phase 4a: the recorder takes a VALIDATED claim (the Python concept-state
// gateway), so the gateway's misconceptions open struggles; an accepted Study
// Prep strategy is judged by the next attempt.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
const { default: db } = await import("../../db.js");
const { installFakeDb } = await import("../../lib/testing/fakeDb.mjs");
const { claimShape, recordLearningEvent, refreshConceptRetention } = await import("./learning-events.js");
const { judgeStrategyOutcome } = await import("./strategies/outcomes.js");

const C = "33333333-3333-4333-8333-333333333333";
const L = "44444444-4444-4444-8444-444444444444";

function fake(t, seed = {}) {
  const f = installFakeDb(db, { "edu.concept_catalog": [{ id: C, status: "approved", subject: "Basic Science", topic_key: "evaporation", title: "Evaporation" }], ...seed }, {
    rpc: {
      record_learner_concept_evidence: (args) => ({ data: [{ learner_id: args.p_learner_id, concept_id: args.p_concept_id, mastery: 0.3, misconception_active: args.p_observation_kind === "misconception_detected" }] }),
      refresh_learner_concept_retention: () => ({ data: null }),
    },
  });
  t.after(() => f.restore());
  return f;
}

test("claimShape passes the guardian's claim through; an invalid claim is refused, never guessed", () => {
  assert.deepEqual(claimShape({ kind: "misconception_detected", source: "python_agent", quality: 0.3, claim: { status: "contradicted", validity: 0.25, confidence: 0.9 } }),
    { response_quality: 0.3, claim_validity: 0.25, model_confidence: 0.9, claim_status: "contradicted" });
  assert.equal(claimShape({ kind: "recall_success", source: "python_agent", claim: { status: "maybe", validity: 1, confidence: 1 } }), null);
  assert.equal(claimShape({ kind: "recall_success", source: "python_agent", claim: { status: "supported", validity: 1.5, confidence: 1 } }), null);
  assert.equal(claimShape({ kind: "recall_success", source: "python_agent", claim: { status: "supported", validity: "", confidence: 1 } }), null);
});

test("a gateway misconception goes through the recorder: the claim is stored as given and a struggle opens", async (t) => {
  const f = fake(t);
  assert.equal((await recordLearningEvent({ learnerId: L, conceptId: C, kind: "misconception_detected", source: "python_agent", sessionRef: "py-s", turnRef: "py-t", claim: { status: "nope" } })).reason, "invalid_claim");
  const r = await recordLearningEvent({
    learnerId: L, conceptId: C, kind: "misconception_detected", source: "python_agent", sessionRef: "py-s", turnRef: "py-t", quality: 0.2,
    claim: { status: "contradicted", validity: 0.3, confidence: 0.85 }, summary: "Thinks evaporation needs boiling", details: { contract: "concept-state-v1" },
  });
  assert.equal(r.recorded, true);
  const call = f.rpcCalls.find((c) => c.name === "record_learner_concept_evidence").args;
  assert.deepEqual([call.p_claim_status, call.p_claim_validity, call.p_model_confidence, call.p_response_quality], ["contradicted", 0.3, 0.85, 0.2]);
  assert.equal(call.p_provenance.source, "python_agent");
  const [struggle] = f.rows("edu.learning_struggles");
  assert.deepEqual([struggle.struggle_type, struggle.concept_id, struggle.status, struggle.detected_by], ["misconception", C, "open", "rule"]);
  assert.deepEqual((await refreshConceptRetention({ learnerId: L, conceptIds: [C] })), { ok: true });
});

test("the concept-state gateway writes only through the recorder (no direct SQL calls left)", async () => {
  const src = await readFile(new URL("../agent-tools/concept-state-routes.js", import.meta.url), "utf8");
  assert.match(src, /recordLearningEvent\(\{/);
  assert.match(src, /claim: \{ status: observation\.claimStatus, validity: observation\.claimValidity, confidence: observation\.modelConfidence \}/);
  assert.match(src, /refreshConceptRetention\(/);
  assert.doesNotMatch(src, /rpc\("record_learner_concept_evidence"|rpc\("refresh_learner_concept_retention"/);
});

test("judgeStrategyOutcome: passed → worked; a clear gain → partial; else did_not_work", () => {
  assert.equal(judgeStrategyOutcome({ scoreBefore: 0.4, scoreAfter: 0.8, passed: true }), "worked");
  assert.equal(judgeStrategyOutcome({ scoreBefore: 0.4, scoreAfter: 0.6, passed: false }), "partial");
  assert.equal(judgeStrategyOutcome({ scoreBefore: 0.4, scoreAfter: 0.45, passed: false }), "did_not_work");
  assert.equal(judgeStrategyOutcome({ scoreBefore: null, scoreAfter: 0.6 }), "did_not_work");
});

test("Study Prep offer → outcome: the next attempt on the topic judges the accepted strategy, once", async (t) => {
  const f = fake(t, {
    "edu.learning_strategy_outcomes": [
      { id: "o1", learner_id: L, strategy_id: "space_out", outcome: "abandoned", workflow: "study_prep", session_ref: "study_prep:s1", turn_ref: "accept:t1:1", concept_id: C, topic_label: "Evaporation", score_before: 0.4, details: { pending: true, use: "study_prep:s1#1" } },
      { id: "o2", learner_id: L, strategy_id: "interleave", outcome: "abandoned", workflow: "study_prep", session_ref: "study_prep:s1", turn_ref: "accept:t2:1", concept_id: null, topic_label: "Matter", score_before: 0.4, details: { pending: true } },
    ],
  });
  const attempt = { learnerId: L, subject: "Basic Science", topic: "Evaporation", kind: "partial_understanding", source: "agent_recall", sessionRef: "study_prep:s1", turnRef: "study_prep:s1:check", quality: 0.6, checked: false };
  const r = await recordLearningEvent(attempt);
  assert.deepEqual(r.strategyOutcomes, [{ id: "o1", strategyId: "space_out", outcome: "partial" }]);
  const [o1, o2] = f.rows("edu.learning_strategy_outcomes");
  assert.deepEqual([o1.outcome, o1.score_after, o1.details.pending], ["partial", 0.6, false]);
  assert.equal(o2.outcome, "abandoned", "another topic's strategy waits for its own attempt");
  const again = await recordLearningEvent({ ...attempt, kind: "assessment_result", quality: 0.9 });
  assert.equal(again.strategyOutcomes, undefined, "judged once");
});
