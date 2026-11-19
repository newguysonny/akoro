import assert from "node:assert/strict";
import test from "node:test";

/**
 * Session & topic state machines + policy constants (Master Plan §1.3, §4.12).
 * Pure — mirrors the transitions the migration CHECK constraints enforce.
 */

import {
  ACTIVE_SESSION_STATES, POLICY, REJECTION_CODES, attemptCapGate, canTransitionSession, canTransitionTopic,
  teachBackGate, validatePlan, TOPIC_STATES, TOPIC_TRANSITIONS, TOPIC_IN_PROGRESS_STATES, publicTopicStatus,
  practiceStart, topicStateAfterScore, runStatusAfterScore,
} from "./state-machine.js";
import { canTransitionRun, examPrepRunWorkflow, runStepEvent, studyPrepWorkflow } from "./workflow.js";
import { canTransition } from "../../workflows/index.js";

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

// Grand Plan §8.3: the complete edge table. Every pair of states is checked —
// the listed edges are allowed, every other pair is forbidden.
const ALLOWED = {
  queued: ["active", "deferred"],
  active: ["diagnostic_ready", "intervention_required", "deferred", "flagged_gap", "queued"],
  diagnostic_ready: ["diagnostic", "intervention_required", "deferred", "flagged_gap"],
  diagnostic: ["understood", "intervention_required", "capped_out", "diagnostic_ready"],
  intervention_required: ["awaiting_teaching", "retest_ready", "diagnostic_ready", "deferred", "flagged_gap"],
  awaiting_teaching: ["retest_ready", "intervention_required", "deferred", "flagged_gap"],
  retest_ready: ["retest", "deferred", "flagged_gap"],
  retest: ["understood", "intervention_required", "capped_out", "retest_ready"],
  understood: [],
  flagged_gap: ["queued"],
  capped_out: ["deferred", "flagged_gap", "queued"],
  deferred: ["queued"],
};

test("topic states are exactly §8.3's", () => {
  assert.deepEqual([...TOPIC_STATES].sort(), ["active", "awaiting_teaching", "capped_out", "deferred", "diagnostic", "diagnostic_ready",
    "flagged_gap", "intervention_required", "queued", "retest", "retest_ready", "understood"]);
  assert.deepEqual(Object.keys(TOPIC_TRANSITIONS).sort(), [...TOPIC_STATES].sort());
});

test("topic transitions: every allowed edge is allowed, every other edge is forbidden", () => {
  let allowed = 0; let forbidden = 0;
  for (const from of TOPIC_STATES) {
    for (const to of TOPIC_STATES) {
      const want = ALLOWED[from].includes(to);
      assert.equal(canTransitionTopic(from, to), want, `${from} → ${to} should be ${want ? "allowed" : "forbidden"}`);
      // The workflow definition (the guarded store's rule) says the same.
      assert.equal(canTransition(studyPrepWorkflow, from, to, "topic"), want, `definition: ${from} → ${to}`);
      if (want) allowed += 1; else forbidden += 1;
    }
  }
  assert.equal(allowed, 36);
  assert.equal(forbidden, 12 * 12 - 36);
  assert.equal(canTransitionTopic("nonsense", "active"), false);
});

test("§8.3 paths: missed → intervention → teaching → retest → understood; inline fallback; cap-out", () => {
  const walk = (path) => path.every((s, i) => i === 0 || canTransitionTopic(path[i - 1], s));
  assert.ok(walk(["queued", "active", "diagnostic_ready", "diagnostic", "intervention_required", "awaiting_teaching", "retest_ready", "retest", "understood"]), "D15 path");
  assert.ok(walk(["active", "diagnostic_ready", "diagnostic", "intervention_required", "retest_ready", "retest", "understood"]), "inline path (Teaching off)");
  assert.ok(walk(["active", "intervention_required", "awaiting_teaching", "retest_ready"]), "no notes → teaching first");
  assert.ok(walk(["retest", "capped_out", "deferred", "queued"]), "cap-out → one deferred retry");
  assert.ok(walk(["capped_out", "flagged_gap", "queued"]), "cap-out → flagged gap → replan");
  assert.ok(!walk(["active", "understood"]), "no topic is understood without a check");
  assert.ok(!walk(["intervention_required", "retest"]), "no retest before the teach-back / teaching");
  assert.ok(!walk(["awaiting_teaching", "retest"]), "no retest while teaching waits");
});

test("the card's coarse status: every in-progress state reads active", () => {
  for (const s of TOPIC_IN_PROGRESS_STATES) assert.equal(publicTopicStatus(s), "active", s);
  for (const s of ["queued", "understood", "flagged_gap", "capped_out", "deferred"]) assert.equal(publicTopicStatus(s), s);
});

test("practiceStart: a retest only from retest_ready; a first check only before any score", () => {
  assert.deepEqual(practiceStart({ state: "active" }, "diagnostic"), { ok: true, mode: "diagnostic", ready: "diagnostic_ready", running: "diagnostic" });
  assert.equal(practiceStart({ state: "diagnostic_ready" }).ok, true);
  assert.equal(practiceStart({ state: "intervention_required", attemptsUsed: 0 }).ok, true, "no notes before: the first check once taught");
  assert.equal(practiceStart({ state: "intervention_required", attemptsUsed: 1 }).code, "teach_back_gate");
  assert.equal(practiceStart({ state: "intervention_required", attemptsUsed: 1 }, "retest").code, "teach_back_gate");
  assert.equal(practiceStart({ state: "awaiting_teaching", attemptsUsed: 1 }, "retest").code, "teach_back_gate");
  assert.deepEqual(practiceStart({ state: "retest_ready" }, "diagnostic"), { ok: true, mode: "retest", ready: "retest_ready", running: "retest" });
  for (const s of ["diagnostic", "retest", "understood", "capped_out", "queued", "deferred"]) {
    assert.equal(practiceStart({ state: s }, "retest").ok, false, s);
    assert.equal(practiceStart({ state: s }, "diagnostic").ok, false, s);
  }
});

test("a score routes the topic (§8.3) and the run record separately", () => {
  assert.equal(topicStateAfterScore({ passed: true, capped: false }), "understood");
  assert.equal(topicStateAfterScore({ passed: false, capped: true }), "capped_out");
  assert.equal(topicStateAfterScore({ passed: false, capped: false }), "intervention_required");
  assert.equal(runStatusAfterScore({ passed: true, currentAttempt: 3, maxAttempts: 3 }), "passed");
  assert.equal(runStatusAfterScore({ passed: false, currentAttempt: 1, maxAttempts: 3 }), "teach_back_required");
  assert.equal(runStatusAfterScore({ passed: false, currentAttempt: 3, maxAttempts: 3 }), "change_approach");
});

// The exam-prep run's own machine (was workflow-state.js): one definition now.
test("the run record's transitions are explicit and terminal", () => {
  assert.equal(examPrepRunWorkflow.type, "exam_prep");
  assert.equal(canTransitionRun("diagnostic_ready", "teach_back_required"), true);
  assert.equal(canTransitionRun("teach_back_required", "retest_ready"), true);
  assert.equal(canTransitionRun("retest_ready", "retest_ready"), true, "a repeated write is not a move");
  assert.equal(canTransitionRun("passed", "retest_ready"), false);
  assert.equal(canTransitionRun("diagnostic_ready", "researching"), false);
  assert.equal(canTransitionRun("hidden", "passed"), false);
});

test("run step events contain only bounded public state", () => {
  assert.deepEqual(runStepEvent({ state: "passed", attempt: 2, score: 0.8 }), { state: "passed", label: "Assessment result recorded", attempt: 2, score: 0.8 });
  assert.equal(runStepEvent({ state: "teach_back_required", score: 8 }).score, 1);
  assert.equal(runStepEvent({ state: "retest_ready", score: null }).score, undefined, "no score is no score");
  assert.throws(() => runStepEvent({ state: "hidden_thought" }));
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
  assert.deepEqual(POLICY.STRATEGY_LIBRARY, ["teach_back", "different_analogy", "interleave", "space_out", "escalate_human", "peer_help", "contrast_pairs", "prerequisite_review", "vocabulary_focus", "worked_examples", "varied_formats", "easy_wins_first", "chunk_plan", "make_concrete", "schedule_plan", "offline_pack", "format_practice", "self_check", "goal_clarify"]);
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
