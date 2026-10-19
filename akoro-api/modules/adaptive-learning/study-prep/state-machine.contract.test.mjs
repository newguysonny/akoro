import assert from "node:assert/strict";
import test from "node:test";

/**
 * Session & topic state machines + policy constants (Master Plan §1.3, §4.12).
 * Pure — mirrors the transitions the migration CHECK constraints enforce.
 */

import {
  ACTIVE_SESSION_STATES, POLICY, REJECTION_CODES, attemptCapGate, canTransitionSession, canTransitionTopic,
  teachBackGate, validatePlan,
} from "./state-machine.js";

const SYLLABUS = [
  { id: "water-cycle" }, { id: "photosynthesis" }, { id: "matter" }, { id: "energy" },
];
const PREREQS = [{ before: "water-cycle", after: "photosynthesis", beforeLabel: "Water Cycle", afterLabel: "Photosynthesis" }];

test("session transitions follow the plan exactly", () => {
  assert.ok(canTransitionSession("planning", "awaiting_confirmation"));
  assert.ok(canTransitionSession("awaiting_confirmation", "topic_active"));
  assert.ok(canTransitionSession("topic_active", "paused"));
  assert.ok(canTransitionSession("paused", "topic_active"));
  assert.ok(canTransitionSession("topic_active", "completed"));
  assert.ok(canTransitionSession("replanning", "topic_active"));
  // and nothing leaves a terminal state
  for (const terminal of ["completed", "abandoned", "cancelled"]) {
    assert.equal(canTransitionSession(terminal, "planning"), false);
    assert.equal(canTransitionSession(terminal, "topic_active"), false);
  }
  // a plan cannot be confirmed straight from planning
  assert.equal(canTransitionSession("planning", "topic_active"), false);
});

test("topic transitions follow the plan exactly", () => {
  assert.ok(canTransitionTopic("queued", "active"));
  assert.ok(canTransitionTopic("active", "understood"));
  assert.ok(canTransitionTopic("active", "capped_out"));
  assert.ok(canTransitionTopic("active", "deferred"));
  assert.ok(canTransitionTopic("deferred", "queued"), "the deferred retry re-queues");
  assert.equal(canTransitionTopic("understood", "queued"), false, "an understood topic never reopens");
  assert.equal(canTransitionTopic("queued", "understood"), false);
});

test("the harness policy constants are the decided numbers", () => {
  assert.equal(POLICY.MAX_TOPICS, 12);
  assert.equal(POLICY.DEFAULT_MAX_ATTEMPTS, 3);
  assert.equal(POLICY.CRAM_MAX_ATTEMPTS, 1);
  assert.equal(POLICY.PASS_THRESHOLD, 0.7);
  assert.equal(POLICY.MAX_ITERATIONS_PER_STEP, 10);
  assert.equal(POLICY.SESSION_TOOL_CALL_CAP, 40);
  assert.equal(POLICY.DEFERRED_RETRIES_PER_SESSION, 1);
  assert.equal(POLICY.INTENT_MAX_CHARS, 240);
  assert.deepEqual(POLICY.STRATEGY_LIBRARY, ["teach_back", "different_analogy", "interleave", "space_out", "escalate_human"]);
});

test("hard plan validation: membership, duplicates, size cap, prerequisite order", () => {
  assert.deepEqual(validatePlan({ proposedTopics: ["matter", "water-cycle", "photosynthesis"], syllabusTopics: SYLLABUS, prerequisites: PREREQS }), { ok: true });
  assert.equal(validatePlan({ proposedTopics: ["photosynthesis", "water-cycle"], syllabusTopics: SYLLABUS, prerequisites: PREREQS }).code, "prerequisite_violation");
  assert.equal(validatePlan({ proposedTopics: ["quantum"], syllabusTopics: SYLLABUS, prerequisites: PREREQS }).code, "topic_not_in_syllabus");
  assert.equal(validatePlan({ proposedTopics: ["matter", "matter"], syllabusTopics: SYLLABUS, prerequisites: PREREQS }).code, "duplicate_topic");
  assert.equal(validatePlan({ proposedTopics: SYLLABUS.concat(Array.from({ length: 9 }, (_, i) => ({ id: `t${i}` }))).map((t) => t.id), syllabusTopics: SYLLABUS.concat(Array.from({ length: 9 }, (_, i) => ({ id: `t${i}` }))), prerequisites: [] }).code, "plan_too_large");
  // soft ordering is the agent's call: no prereq edge → any order passes
  assert.equal(validatePlan({ proposedTopics: ["energy", "matter"], syllabusTopics: SYLLABUS, prerequisites: PREREQS }).ok, true);
});

test("the gates: attempt caps and the teach-back confirmation", () => {
  assert.equal(attemptCapGate({ attemptsUsed: 2, maxAttempts: 3 }).ok, true);
  assert.equal(attemptCapGate({ attemptsUsed: 3, maxAttempts: 3 }).code, "attempt_cap_exceeded");
  assert.equal(attemptCapGate({ attemptsUsed: 1, maxAttempts: 1 }).code, "attempt_cap_exceeded", "cram caps on the first attempt");
  assert.equal(teachBackGate({ mode: "retest", learnerConfirmedReady: false }).code, "teach_back_gate");
  assert.equal(teachBackGate({ mode: "retest", learnerConfirmedReady: true }).ok, true);
  assert.equal(teachBackGate({ mode: "diagnostic", learnerConfirmedReady: false }).ok, true, "diagnostics are never gated");
});

test("every rejection code is stable and documented", () => {
  for (const code of ["insufficient_balance", "attempt_cap_exceeded", "prerequisite_violation", "tool_not_permitted", "strategy_not_permitted", "teach_back_gate", "agent_loop_cap"]) {
    assert.ok(REJECTION_CODES.includes(code), `${code} is a known rejection`);
  }
  assert.equal(ACTIVE_SESSION_STATES.includes("completed"), false);
});
