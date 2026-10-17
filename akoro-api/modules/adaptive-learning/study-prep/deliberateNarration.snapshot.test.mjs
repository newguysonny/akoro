import assert from "node:assert/strict";
import test from "node:test";

/**
 * deliberate() narration snapshot tests (Master Plan §4.7): the harness's
 * narration over the CLOSED decision-node enum, with typed facts only.
 * Snapshot-tested over harness decisions — never agent cognition.
 */

import { DECISION_NODES } from "./state-machine.js";
import { deliberate, NARRATION_POLICY_VERSION, pauseCopy } from "./narration.js";

const SNAPSHOTS = {
  plan_validated: { topicCount: 6 },
  plan_confirmed: { topicCount: 6 },
  plan_adjusted: { dropped: 1 },
  topic_started: { topicLabel: "Water Cycle" },
  practice_generated: { topicLabel: "Water Cycle", attemptNumber: 2, coins: 2 },
  practice_scored: { topicLabel: "Water Cycle", score: 3, total: 5, percentage: 60, passed: false, thresholdPercentage: 70 },
  agent_check_started: { topicLabel: "Water Cycle", mode: "diagnostic", coins: 2 },
  agent_check_skipped: { topicLabel: "Water Cycle" },
  agent_check_scored: { topicLabel: "Water Cycle", correct: 4, total: 5, guessed: 1, percentage: 80, passed: true, thresholdPercentage: 70 },
  strategy_offered: { strategy: "teach_back", topicLabel: "Water Cycle" },
  teach_back_confirmed: { topicLabel: "Water Cycle" },
  topic_advanced: { topicLabel: "Water Cycle", nextTopicLabel: "Photosynthesis" },
  topic_deferred: { topicLabel: "Human Body Systems", reason: "attempt_cap_reached" },
  topic_flagged: { topicLabel: "Energy", reason: "confuses kinetic and potential" },
  session_concluded: { understood: 4 },
  session_paused: { reason: "agent_loop_cap" },
  harness_rejection: { code: "insufficient_balance" },
};

test("every decision node narrates, and the snapshots are stable", () => {
  for (const node of DECISION_NODES) {
    const result = deliberate(node, SNAPSHOTS[node] || {});
    assert.ok(result, `${node} narrates`);
    assert.equal(result.policyVersion, NARRATION_POLICY_VERSION);
    assert.ok(result.narrative.length > 10 && result.narrative.length <= 500);
  }
  // golden lines the learner must always see verbatim
  assert.match(deliberate("session_paused", { reason: "agent_loop_cap" }).narrative, /I got stuck — tap to retry or adjust\./);
  assert.match(deliberate("harness_rejection", { code: "teach_back_gate" }).narrative, /retest unlocks only after you confirm the teach-back/);
  assert.match(deliberate("practice_scored", SNAPSHOTS.practice_scored).narrative, /3 of 5/);
  assert.match(deliberate("practice_scored", SNAPSHOTS.practice_scored).narrative, /60%/);
});

test("unknown nodes and off-enum inputs are silence, never invention", () => {
  assert.equal(deliberate("agent_thinking", {}), null);
  assert.equal(deliberate(null, {}), null);
  assert.equal(deliberate("harness_rejection", { code: "made_up_code" }).narrative, "That action was not allowed (made_up_code).");
});

test("narration never leaks model-authored text — facts are typed scalars only", () => {
  // Even if a caller passes a rogue fact, templates only interpolate known keys.
  const result = deliberate("topic_started", { topicLabel: "<script>alert(1)</script>" });
  assert.ok(!/<script>/.test(result.narrative) || result.narrative.includes("Starting <script>"), "labels pass through text only");
  assert.ok(result.narrative.length <= 500);
});

test("pause copy is shared between narration and the UI banners", () => {
  assert.equal(pauseCopy("agent_loop_cap"), "I got stuck — tap to retry or adjust.");
  assert.match(pauseCopy("insufficient_balance"), /Not enough coins/);
  assert.match(pauseCopy("anything_else"), /paused/i);
});

test("the Agent Check narrates the agent's result, never the learner's mastery", () => {
  const n = deliberate("agent_check_scored", SNAPSHOTS.agent_check_scored).narrative;
  assert.match(n, /Your agent answered 4 of 5/);
  assert.match(n, /guess on 1/);
  assert.doesNotMatch(n, /you mastered/i);
});
