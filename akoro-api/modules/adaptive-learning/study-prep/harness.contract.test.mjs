import assert from "node:assert/strict";
import test from "node:test";

/**
 * Study-prep harness contract tests (Master Plan §4.13). Everything runs on
 * an IN-MEMORY store with a stubbed topic workflow — no db, no LLM, no
 * clock. The races the plan demands are simulated directly against the
 * store's conditional-update semantics.
 */

import { createHarness, HarnessRejection, InsufficientBalanceError } from "./harness.js";
import { POLICY } from "./state-machine.js";
import { makeEvent } from "./events.js";
import { guardStudyPrepStore, makeWorkflowMirror, studyPrepWorkflow } from "./workflow.js";
import { createWorkflowEngine } from "../../workflows/index.js";
import { memoryWorkflowStore } from "../../workflows/index.js";
import { memorySubmitAttempt } from "./submit-attempt.testkit.mjs";

// ── in-memory store double ─────────────────────────────────────────────────

class Insufficient extends InsufficientBalanceError {}
class MemoryStore {
  constructor({ balance = 100 } = {}) {
    this.sessions = new Map();
    this.topics = new Map();
    this.events = [];
    this.sequence = 0;
    this.balance = balance;
    this.charges = [];
    this.refunds = [];
    this.evidence = [];
    this.raceConfirm = false; // when true, one concurrent confirm "wins" first
  }
  async findActiveSession(learnerId) {
    return [...this.sessions.values()].find((row) => row.learner_id === learnerId
      && !["completed", "abandoned", "cancelled"].includes(row.status)) || null;
  }
  async createSession(row) {
    this.sessionCounter = (this.sessionCounter || 0) + 1;
    const created = { id: `session-${this.sessionCounter}`, tool_calls_used: 0, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...row };
    this.sessions.set(created.id, created);
    return created;
  }
  async getSession(id) { return this.sessions.get(id) || null; }
  async updateSessionConditional(id, expectedStatus, patch) {
    const row = this.sessions.get(id);
    if (!row || row.status !== expectedStatus) return null;
    const updated = { ...row, ...patch };
    this.sessions.set(id, updated);
    return updated;
  }
  async getTopics(sessionId) {
    return [...this.topics.values()].filter((row) => row.session_id === sessionId)
      .sort((a, b) => a.position - b.position);
  }
  async createTopics(sessionId, plan) {
    const rows = (plan || []).map((topic, index) => ({
      id: `topic-${sessionId.slice(0, 4)}-${index + 1}`, session_id: sessionId,
      syllabus_topic_id: topic.syllabusTopicId, position: topic.position ?? index + 1,
      label: topic.label, status: "queued", attempts_used: 0, deferred_retry_used: false,
      learner_confirmed_ready: false, exam_prep_run_id: null, updated_at: "2026-01-01T00:00:00Z",
    }));
    for (const row of rows) this.topics.set(row.id, row);
    if (rows[0]) rows[0].status = "active";
    return rows;
  }
  async updateTopicConditional(id, expectedStatus, patch) {
    const row = this.topics.get(id);
    if (!row || row.status !== expectedStatus) return null;
    const updated = { ...row, ...patch };
    this.topics.set(id, updated);
    return updated;
  }
  async appendEvents(sessionId, rows) {
    const written = rows.map((row) => {
      this.sequence += 1;
      const placed = { id: `event-${this.sequence}`, created_at: "2026-01-01T00:00:00Z", ...row, session_id: sessionId, sequence: this.sequence };
      this.events.push(placed);
      return placed;
    });
    return written;
  }
  async listEvents(sessionId, { limit = 200 } = {}) {
    return this.events.filter((row) => row.session_id === sessionId).slice(-limit);
  }
  async chargeCoins({ learnerId, coins }) {
    if (this.balance < coins) { const error = new Insufficient(coins, this.balance); throw error; }
    this.balance -= coins;
    const charge = { charged: coins, applied: [{ account: "wallet", took: coins }] };
    this.charges.push({ learnerId, coins });
    return charge;
  }
  async refundCoins({ charge }) {
    this.balance += charge?.charged || 0;
    this.refunds.push(charge);
    return 0;
  }
  async recordMasteryEvidence(entry) { this.evidence.push(entry); return "concept-1"; }
}

// ── stubbed topic workflow + syllabus ──────────────────────────────────────

const SYLLABUS = [
  { id: "water-cycle", label: "Water Cycle" },
  { id: "photosynthesis", label: "Photosynthesis" },
  { id: "matter", label: "Matter" },
  { id: "energy", label: "Energy" },
  { id: "force-motion", label: "Force and Motion" },
  { id: "human-body", label: "Human Body Systems" },
];
const PREREQS = [{ before: "water-cycle", after: "photosynthesis", beforeLabel: "Water Cycle", afterLabel: "Photosynthesis" }];

const KEY5 = { q1: 1, q2: 0, q3: 2, q4: 1, q5: 0 };
function makeTopicWorkflow({ passThreshold = 0.7, maxAttempts = 3 } = {}) {
  let runCounter = 0;
  const runs = new Map();
  return {
    runs,
    policyFor: async () => ({ pass_threshold: passThreshold, max_attempts: maxAttempts, policy_version: "exam-confidence-v1" }),
    startRun: async ({ learnerId, studyPrepTopicId, request }) => {
      runCounter += 1;
      const run = { id: `run-${runCounter}`, learner_id: learnerId, study_prep_topic_id: studyPrepTopicId,
        topic: request.topic, status: "diagnostic_ready", current_attempt: 1, max_attempts: maxAttempts,
        pass_threshold: passThreshold, last_score: null };
      runs.set(run.id, run);
      return { run, attempt: { attempt_number: 1, kind: "diagnostic" }, workflow: null };
    },
    submit: async ({ learnerId, runId, answers }) => {
      const run = runs.get(runId);
      if (!run) throw new HarnessRejection("session_not_found", "run not found", 404);
      const key = { q1: 1, q2: 0, q3: 2, q4: 1, q5: 0 };
      const { scoreAttempt } = await import("./education-engine.js");
      const scored = scoreAttempt(key, answers);
      const status = scored.score >= run.pass_threshold ? "passed" : (run.current_attempt >= run.max_attempts ? "change_approach" : "teach_back_required");
      Object.assign(run, { status, last_score: scored.score });
      return { run, workflow: null, score: scored.score, correct: scored.correct, total: scored.total, passed: status === "passed" };
    },
    retest: async ({ learnerId, runId }) => {
      const run = runs.get(runId);
      run.current_attempt += 1;
      run.status = "retest_ready";
      return { run, attempt: { attempt_number: run.current_attempt, kind: "retest" }, workflow: null };
    },
    publicRun: (run) => ({ id: run.id, status: run.status, topic: run.topic }),
    publicAttempt: (attempt) => attempt,
  };
}

const syllabus = {
  resolveTopics: async () => SYLLABUS,
  prerequisiteEdges: async () => PREREQS,
};

function build({ balance = 100, workflow } = {}) {
  const store = new MemoryStore({ balance });
  const topicWorkflow = workflow || makeTopicWorkflow();
  // The single-transaction submit (edu.study_prep_submit_attempt), in memory.
  topicWorkflow.submitAttempt = memorySubmitAttempt({ store, runs: topicWorkflow.runs, key: KEY5 });
  const harness = createHarness({ store, topicWorkflow, syllabus, now: () => "2026-01-01T00:00:00Z" });
  return { store, topicWorkflow, harness };
}

const LEARNER = "learner-1";
async function plannedSession(harness, { topicIds = ["water-cycle", "photosynthesis", "matter"] } = {}) {
  const session = await harness.createSession({ learnerId: LEARNER, goal: "Prepare for my whole-term exam", subject: "Basic Science" });
  await harness.proposePlan({ sessionId: session.id, learnerId: LEARNER, topicIds, intent: "Weak topics first, respecting prerequisites." });
  return session;
}

// ── tests ──────────────────────────────────────────────────────────────────

test("a plan with a prerequisite violation is rejected, then a valid re-proposal is accepted", async () => {
  const { harness } = build();
  const session = await harness.createSession({ learnerId: LEARNER, goal: "Prepare", subject: "Basic Science" });
  // photosynthesis BEFORE water-cycle violates the edge
  await assert.rejects(
    () => harness.proposePlan({ sessionId: session.id, learnerId: LEARNER, topicIds: ["photosynthesis", "water-cycle"], intent: "test" }),
    (error) => error.code === "prerequisite_violation",
  );
  // the agent observes the rejection and re-proposes a valid order
  const valid = await harness.proposePlan({ sessionId: session.id, learnerId: LEARNER, topicIds: ["water-cycle", "photosynthesis"], intent: "Fixing the order." });
  assert.equal(valid.session.status, "awaiting_confirmation");
  assert.equal(valid.plan.length, 2);
  // both decisions are on the activity log (rejection + validation)
  const view = await harness.getSessionView({ sessionId: session.id, learnerId: LEARNER });
  const decisions = view.events.filter((event) => event.event_type === "harness_decision");
  assert.ok(decisions.some((event) => event.decision_node === "harness_rejection"));
  assert.ok(decisions.some((event) => event.decision_node === "plan_validated"));
});

test("confirm creates topics, activates the first, and charges NOTHING (zero coins before confirm)", async () => {
  const { store, harness } = build();
  const session = await plannedSession(harness);
  const result = await harness.confirmPlan({ sessionId: session.id, learnerId: LEARNER });
  assert.equal(result.session.status, "topic_active");
  assert.equal(result.topics.length, 3);
  assert.equal(result.topics[0].status, "active");
  assert.equal(result.topics[1].status, "queued");
  assert.equal(store.charges.length, 0, "no coins are spent before/at confirmation");
  const gate = (await harness.getSessionView({ sessionId: session.id, learnerId: LEARNER }))
    .events.find((event) => event.event_type === "human_gate");
  assert.equal(gate.decision_node, "plan_confirmed");
});

test("concurrent confirm produces exactly ONE winner — the loser gets a stable code", async () => {
  const { harness } = build();
  const session = await plannedSession(harness);
  const [first, second] = await Promise.allSettled([
    harness.confirmPlan({ sessionId: session.id, learnerId: LEARNER }),
    harness.confirmPlan({ sessionId: session.id, learnerId: LEARNER }),
  ]);
  const winners = [first, second].filter((result) => result.status === "fulfilled");
  const losers = [first, second].filter((result) => result.status === "rejected" && result.reason.code === "invalid_state_transition");
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
});

test("practice generation past the attempt cap is rejected attempt_cap_exceeded — no charge, no generation", async () => {
  const workflow = makeTopicWorkflow({ maxAttempts: 1 });
  const { store, harness } = build({ workflow });
  const session = await plannedSession(harness, { topicIds: ["water-cycle"] });
  await harness.confirmPlan({ sessionId: session.id, learnerId: LEARNER });
  const topics = await store.getTopics(session.id);
  const topic = topics[0];
  // attempt 1 (diagnostic)
  await harness.startTopicPractice({ sessionId: session.id, learnerId: LEARNER, topicId: topic.id, mode: "diagnostic" });
  // cram-style cap of 1: a retest request is rejected, nothing charged
  const before = store.balance;
  await assert.rejects(
    () => harness.startTopicPractice({ sessionId: session.id, learnerId: LEARNER, topicId: topic.id, mode: "retest" }),
    (error) => error.code === "attempt_cap_exceeded",
  );
  assert.equal(store.balance, before, "no coins charged on a rejected generation");
});

test("a retest without the learner's teach-back confirmation is rejected (hard gate)", async () => {
  const { store, harness } = build();
  const session = await plannedSession(harness, { topicIds: ["water-cycle"] });
  await harness.confirmPlan({ sessionId: session.id, learnerId: LEARNER });
  const topic = (await store.getTopics(session.id))[0];
  await harness.startTopicPractice({ sessionId: session.id, learnerId: LEARNER, topicId: topic.id, mode: "diagnostic" });
  // While the diagnostic is out there is no retest to start at all.
  await assert.rejects(
    () => harness.startTopicPractice({ sessionId: session.id, learnerId: LEARNER, topicId: topic.id, mode: "retest" }),
    (error) => error.code === "invalid_state_transition",
  );
  // Missed (§8.3: intervention_required) — still no retest before the teach-back.
  await harness.submitPractice({ sessionId: session.id, learnerId: LEARNER, topicId: topic.id, answers: [{ questionId: "q1", answerIndex: 0 }] });
  await assert.rejects(
    () => harness.startTopicPractice({ sessionId: session.id, learnerId: LEARNER, topicId: topic.id, mode: "retest" }),
    (error) => error.code === "teach_back_gate",
  );
  // the learner confirms the teach-back — the gate opens
  await harness.confirmTeachBack({ sessionId: session.id, learnerId: LEARNER, topicId: topic.id });
  const retest = await harness.startTopicPractice({ sessionId: session.id, learnerId: LEARNER, topicId: topic.id, mode: "retest" });
  assert.equal(retest.topic.attemptsUsed, 2);
});

test("a failing wallet pauses the session resumable with a 402 code — no lost topic", async () => {
  const { store, harness } = build({ balance: 1 }); // enough for nothing
  const session = await plannedSession(harness, { topicIds: ["water-cycle"] });
  await harness.confirmPlan({ sessionId: session.id, learnerId: LEARNER });
  const topic = (await store.getTopics(session.id))[0];
  await assert.rejects(
    () => harness.startTopicPractice({ sessionId: session.id, learnerId: LEARNER, topicId: topic.id, mode: "diagnostic" }),
    (error) => error.code === "insufficient_balance" && error.httpStatus === 402,
  );
  const paused = await store.getSession(session.id);
  assert.equal(paused.status, "paused");
  assert.equal(paused.paused_reason, "insufficient_balance");
  assert.equal((await store.getTopics(session.id))[0].status, "diagnostic_ready", "the topic is not lost — ready for its check, nothing out");
  // after a top-up the session resumes into topic_active with the topic intact
  store.balance = 50;
  const resumed = await harness.resumeSession({ sessionId: session.id, learnerId: LEARNER });
  assert.equal(resumed.session.status, "topic_active");
});

test("scoring routes the topic state machine deterministically and writes mastery evidence", async () => {
  const { store, harness } = build();
  const session = await plannedSession(harness, { topicIds: ["water-cycle", "matter"] });
  await harness.confirmPlan({ sessionId: session.id, learnerId: LEARNER });
  const topic = (await store.getTopics(session.id))[0];
  await harness.startTopicPractice({ sessionId: session.id, learnerId: LEARNER, topicId: topic.id, mode: "diagnostic" });
  // 5/5 → passed → topic understood
  const result = await harness.submitPractice({
    sessionId: session.id, learnerId: LEARNER, topicId: topic.id,
    answers: [{ questionId: "q1", answerIndex: 1 }, { questionId: "q2", answerIndex: 0 }, { questionId: "q3", answerIndex: 2 }, { questionId: "q4", answerIndex: 1 }, { questionId: "q5", answerIndex: 0 }],
  });
  assert.equal(result.outcome, "understood");
  assert.equal((await store.getTopics(session.id))[0].status, "understood");
  assert.equal(store.evidence.length, 1, "mastery evidence recorded");
  const engineEvent = store.events.find((event) => event.event_type === "engine_result");
  assert.ok(engineEvent, "the engine result is on the activity log");
  assert.equal(engineEvent.origin, "engine");
});

test("advance_topic moves to the next queued topic; conclude ends the session with a summary", async () => {
  const { store, harness } = build();
  const session = await plannedSession(harness, { topicIds: ["water-cycle", "matter"] });
  await harness.confirmPlan({ sessionId: session.id, learnerId: LEARNER });
  const topics = await store.getTopics(session.id);
  await harness.startTopicPractice({ sessionId: session.id, learnerId: LEARNER, topicId: topics[0].id, mode: "diagnostic" });
  await harness.submitPractice({
    sessionId: session.id, learnerId: LEARNER, topicId: topics[0].id,
    answers: [{ questionId: "q1", answerIndex: 1 }, { questionId: "q2", answerIndex: 0 }, { questionId: "q3", answerIndex: 2 }, { questionId: "q4", answerIndex: 1 }, { questionId: "q5", answerIndex: 0 }],
  });
  const advanced = await harness.advanceTopic({ sessionId: session.id, learnerId: LEARNER, intent: "Water Cycle settled — on to Matter." });
  assert.equal(advanced.topic.label, "Matter");
  assert.equal(advanced.topic.status, "active");
  // settle the last topic then conclude
  const after = await store.getTopics(session.id);
  await harness.startTopicPractice({ sessionId: session.id, learnerId: LEARNER, topicId: after[1].id, mode: "diagnostic" });
  await harness.submitPractice({
    sessionId: session.id, learnerId: LEARNER, topicId: after[1].id,
    answers: [{ questionId: "q1", answerIndex: 1 }, { questionId: "q2", answerIndex: 0 }, { questionId: "q3", answerIndex: 2 }, { questionId: "q4", answerIndex: 1 }, { questionId: "q5", answerIndex: 0 }],
  });
  const concluded = await harness.concludeSession({ sessionId: session.id, learnerId: LEARNER, intent: "All topics settled." });
  assert.equal(concluded.session.status, "completed");
  assert.equal(concluded.summary.understood, 2);
});

test("defer is allowed once per session; the retry resets attempts; a second defer is rejected", async () => {
  const workflow = makeTopicWorkflow({ maxAttempts: 1 });
  const { store, harness } = build({ workflow });
  const session = await plannedSession(harness, { topicIds: ["water-cycle", "matter", "energy"] });
  await harness.confirmPlan({ sessionId: session.id, learnerId: LEARNER });
  const topics = await store.getTopics(session.id);
  // cap out the first topic (maxAttempts 1, fail the diagnostic)
  await harness.startTopicPractice({ sessionId: session.id, learnerId: LEARNER, topicId: topics[0].id, mode: "diagnostic" });
  await harness.submitPractice({
    sessionId: session.id, learnerId: LEARNER, topicId: topics[0].id,
    answers: [{ questionId: "q1", answerIndex: 0 }],
  });
  assert.equal((await store.getTopics(session.id))[0].status, "capped_out");
  // agent defers it with a reason code
  const deferred = await harness.deferTopic({ sessionId: session.id, learnerId: LEARNER, topicId: topics[0].id, reasonCode: "attempt_cap_reached", intent: "Capped out — deferring." });
  assert.equal(deferred.topic.status, "deferred");
  // retry the deferred topic once: attempts reset
  const retried = await harness.retryDeferredTopic({ sessionId: session.id, learnerId: LEARNER, topicId: topics[0].id });
  assert.equal(retried.topic.status, "queued");
  assert.equal(retried.topic.attemptsUsed, 0);
  assert.equal(retried.topic.deferredRetryUsed, true);
  // a second deferral anywhere in the session is rejected
  await assert.rejects(
    () => harness.deferTopic({ sessionId: session.id, learnerId: LEARNER, topicId: topics[0].id, reasonCode: "attempt_cap_reached" }),
    (error) => error.code === "deferred_retry_used",
  );
});

test("offer_strategy rejects anything outside the curated library", async () => {
  const { harness } = build();
  const session = await plannedSession(harness);
  await harness.confirmPlan({ sessionId: session.id, learnerId: LEARNER });
  await assert.rejects(
    () => harness.offerStrategy({ sessionId: session.id, learnerId: LEARNER, topicId: null, strategy: "drop_the_topic" }),
    (error) => error.code === "strategy_not_permitted",
  );
  const offered = await harness.offerStrategy({ sessionId: session.id, learnerId: LEARNER, topicId: null, strategy: "teach_back", intent: "Near miss — teach-back fits." });
  assert.equal(offered.strategy, "teach_back");
  assert.deepEqual(offered.library, POLICY.STRATEGY_LIBRARY);
});

test("plans are capped at 12 topics and duplicates are rejected", async () => {
  const { harness } = build();
  const session = await harness.createSession({ learnerId: LEARNER, goal: "Prepare", subject: "Basic Science" });
  const thirteen = Array.from({ length: 13 }, (_, index) => SYLLABUS[index % SYLLABUS.length].id);
  await assert.rejects(
    () => harness.proposePlan({ sessionId: session.id, learnerId: LEARNER, topicIds: thirteen }),
    (error) => error.code === "plan_too_large",
  );
  await assert.rejects(
    () => harness.proposePlan({ sessionId: session.id, learnerId: LEARNER, topicIds: ["water-cycle", "water-cycle"] }),
    (error) => error.code === "duplicate_topic",
  );
  await assert.rejects(
    () => harness.proposePlan({ sessionId: session.id, learnerId: LEARNER, topicIds: ["quantum-chemistry"] }),
    (error) => error.code === "topic_not_in_syllabus",
  );
});

test("one active session per learner — a second create is rejected", async () => {
  const { harness } = build();
  await harness.createSession({ learnerId: LEARNER, goal: "Prepare", subject: "Basic Science" });
  await assert.rejects(
    () => harness.createSession({ learnerId: LEARNER, goal: "Another", subject: "Basic Science" }),
    (error) => error.code === "invalid_state_transition",
  );
});

test("sessionNext derives the step deterministically from recorded state", async () => {
  const { harness } = build();
  const session = await plannedSession(harness);
  let next = await harness.sessionNext({ sessionId: session.id, learnerId: LEARNER });
  assert.equal(next.step, "plan_card");
  await harness.confirmPlan({ sessionId: session.id, learnerId: LEARNER });
  next = await harness.sessionNext({ sessionId: session.id, learnerId: LEARNER });
  assert.equal(next.step, "start_practice");
  assert.equal(next.activeTopic.label, "Water Cycle");
});

test("adjustPlan drops topics before confirmation and re-estimates", async () => {
  const { harness } = build();
  const session = await plannedSession(harness, { topicIds: ["water-cycle", "photosynthesis", "matter"] });
  const adjusted = await harness.adjustPlan({ sessionId: session.id, learnerId: LEARNER, dropTopicIds: ["matter"] });
  assert.equal(adjusted.plan.length, 2);
  assert.ok(adjusted.estimate.totalCoins > 0);
  await assert.rejects(
    () => harness.adjustPlan({ sessionId: session.id, learnerId: LEARNER, dropTopicIds: ["water-cycle", "photosynthesis"] }),
    (error) => error.code === "tool_schema_invalid",
  );
});

test("events never carry answer keys or raw chat in facts, and intent is origin-tagged and capped", async () => {
  const { store, harness } = build();
  const session = await plannedSession(harness);
  const view = await harness.getSessionView({ sessionId: session.id, learnerId: LEARNER });
  for (const event of view.events) {
    const serialised = JSON.stringify(event.facts || {});
    assert.doesNotMatch(serialised, /answer_key|answerIndex/i);
  }
  const agentEvent = view.events.find((event) => event.origin === "agent_stated_intent");
  assert.ok(agentEvent, "the agent intent is origin-tagged");
  assert.ok(agentEvent.agent_intent.length <= POLICY.INTENT_MAX_CHARS);
  // makeEvent refuses a bad origin outright
  assert.throws(() => makeEvent({ sequence: 0, eventType: "observation", origin: "llm_chain_of_thought" }), /invalid origin/);
});

// ── F7: every status write goes through the workflow definition ────────────

test("F7: an unlisted session or topic move is refused before anything is written", async () => {
  const store = guardStudyPrepStore(new MemoryStore());
  const session = await store.createSession({ learner_id: LEARNER, status: "planning", goal: "g", subject: "s" });
  // planning → completed is not a move a session can make.
  await assert.rejects(() => store.updateSessionConditional(session.id, "planning", { status: "completed" }), (e) => e.code === "invalid_state_transition");
  assert.equal((await store.getSession(session.id)).status, "planning", "nothing written");
  // A finished session stays finished.
  await store.updateSessionConditional(session.id, "planning", { status: "cancelled" });
  await assert.rejects(() => store.updateSessionConditional(session.id, "cancelled", { status: "topic_active" }), (e) => e.code === "invalid_state_transition");
  // Topics: understood is final; queued can't jump to understood; an active topic is checked first (§8.3).
  const [topic] = await store.createTopics(session.id, [{ syllabusTopicId: "a", label: "A" }, { syllabusTopicId: "b", label: "B" }]);
  await assert.rejects(() => store.updateTopicConditional(topic.id, "active", { status: "understood" }), (e) => e.code === "invalid_state_transition");
  await store.updateTopicConditional(topic.id, "active", { status: "diagnostic_ready" });
  await store.updateTopicConditional(topic.id, "diagnostic_ready", { status: "diagnostic" });
  await store.updateTopicConditional(topic.id, "diagnostic", { status: "understood" });
  await assert.rejects(() => store.updateTopicConditional(topic.id, "understood", { status: "active" }), (e) => e.code === "invalid_state_transition");
  await assert.rejects(() => store.updateTopicConditional("topic-sess-2", "queued", { status: "understood" }), (e) => e.code === "invalid_state_transition");
  // A patch that doesn't change status is not a transition.
  assert.ok(await store.updateSessionConditional(session.id, "cancelled", { updated_at: "x" }));
});

test("F7: conclude only ends a running session; cancel can't reopen an ended one", async () => {
  const { harness, store } = build();
  const session = await harness.createSession({ learnerId: LEARNER, goal: "Prepare", subject: "Basic Science" });
  await assert.rejects(() => harness.concludeSession({ sessionId: session.id, learnerId: LEARNER }), (e) => e.code === "invalid_state_transition");
  assert.equal((await store.getSession(session.id)).status, "planning");
  await harness.cancelSession({ sessionId: session.id, learnerId: LEARNER });
  await assert.rejects(() => harness.cancelSession({ sessionId: session.id, learnerId: LEARNER }), (e) => e.code === "invalid_state_transition");
  await assert.rejects(() => harness.concludeSession({ sessionId: session.id, learnerId: LEARNER }), (e) => e.code === "invalid_state_transition");
  assert.equal((await store.getSession(session.id)).status, "cancelled");
});

test("F7: the definition is the state machine — every session state has a lifecycle status", () => {
  assert.equal(studyPrepWorkflow.type, "study_prep");
  assert.equal(studyPrepWorkflow.initial, "planning");
  assert.equal(studyPrepWorkflow.statusOf.awaiting_confirmation, "waiting_learner");
  assert.equal(studyPrepWorkflow.statusOf.completed, "completed");
  assert.deepEqual(studyPrepWorkflow.transitions.completed, []);
  assert.ok(studyPrepWorkflow.transitions.planning.includes("paused"), "a planning agent that hits its cap pauses, resumably");
});

// ── Phase 1: the dual-write into the workflow engine ───────────────────────

test("dual-write: the session's run and its events mirror into the engine, step for step", async () => {
  const wfStore = memoryWorkflowStore();
  const engine = createWorkflowEngine({ store: wfStore });
  const store = new MemoryStore();
  const harness = createHarness({ store, topicWorkflow: makeTopicWorkflow(), syllabus, workflowMirror: makeWorkflowMirror(engine), now: () => "2026-01-01T00:00:00Z" });
  const session = await plannedSession(harness);
  const wfId = (await store.getSession(session.id)).workflow_id;
  assert.ok(wfId, "the session points at its workflow instance");
  let instance = await engine.get(wfId, LEARNER);
  assert.equal(instance.workflow_type, "study_prep");
  assert.equal(instance.idempotency_key, `study_prep:${session.id}`);
  assert.equal(instance.state, "awaiting_confirmation");
  assert.equal(instance.status, "waiting_learner");

  await harness.confirmPlan({ sessionId: session.id, learnerId: LEARNER });
  instance = await engine.get(wfId, LEARNER);
  assert.equal(instance.state, "topic_active");
  assert.equal(instance.status, "active");

  // Every Study Prep event is in the workflow's stream, in order.
  const spEvents = store.events.filter((e) => e.session_id === session.id);
  // Phase 3: the workflow also records its own lifecycle (created, each move).
  const all = await engine.events(wfId);
  assert.deepEqual(all.map((e) => e.sequence), all.map((_, i) => i));
  assert.equal(all[0].event_type, "workflow.created");
  assert.ok(all.some((e) => e.event_type === "workflow.state_changed" && e.payload.to === "topic_active"));
  const wfEvents = all.filter((e) => e.payload.studyPrepSequence != null);
  assert.equal(wfEvents.length, spEvents.length);
  assert.deepEqual(wfEvents.map((e) => e.payload.studyPrepSequence), spEvents.map((e) => e.sequence));
  assert.ok(wfEvents.some((e) => e.payload.decisionNode === "plan_confirmed" && e.visibility === "learner"));

  await harness.cancelSession({ sessionId: session.id, learnerId: LEARNER });
  instance = await engine.get(wfId, LEARNER);
  assert.equal(instance.status, "cancelled");
  assert.ok(instance.cancelled_at);
});

test("dual-write is best effort: an engine failure never fails the learner's action", async () => {
  const broken = { create: async () => { throw new Error("db down"); }, transition: async () => { throw new Error("db down"); }, appendEvent: async () => { throw new Error("db down"); } };
  const warnings = [];
  const store = new MemoryStore();
  const harness = createHarness({ store, topicWorkflow: makeTopicWorkflow(), syllabus, workflowMirror: makeWorkflowMirror(broken, { log: { warn: (m) => warnings.push(m) } }), now: () => "2026-01-01T00:00:00Z" });
  const session = await plannedSession(harness);
  await harness.confirmPlan({ sessionId: session.id, learnerId: LEARNER });
  assert.equal((await store.getSession(session.id)).status, "topic_active");
  assert.ok(warnings.some((w) => /workflow mirror: create failed/.test(w)));
});

// Phase 4a: an accepted harness strategy runs (here interleave → a replan
// through the store's conditional writes) and starts its pending outcome; a
// strategy past limits.maxUsesPerTopic is refused.
test("offer_strategy: the learner's acceptance runs the harness strategy; past its limit it is refused", async () => {
  const { runStrategyOffer } = await import("../strategies/executors.js");
  const outcomes = [];
  let uses = 0;
  const strategyRun = (args) => runStrategyOffer({ ...args, deps: {
    store: args.store, now: args.now, prerequisites: async () => PREREQS,
    checkLimit: async () => (uses >= 2 ? { refusal: "strategy_limit_reached", usesOnTopic: uses, limit: 2 } : { refusal: null, usesOnTopic: uses, limit: 2 }),
    recommend: async () => ({ ranked: [{ id: "interleave", reasons: ["targets_struggle"] }], struggleTypes: ["interference"] }),
    recordOutcome: async (o) => { uses += 1; outcomes.push(o); return { recorded: true, id: `o${uses}` }; },
  } });
  const store = new MemoryStore();
  const harness = createHarness({ store, topicWorkflow: makeTopicWorkflow(), syllabus, strategyRun, now: () => "2026-01-01T00:00:00Z" });
  const session = await plannedSession(harness, { topicIds: ["water-cycle", "matter", "photosynthesis"] });
  await harness.confirmPlan({ sessionId: session.id, learnerId: LEARNER });
  const [active] = (await store.getTopics(session.id)).filter((t) => t.status === "active");

  const offered = await harness.offerStrategy({ sessionId: session.id, learnerId: LEARNER, topicId: active.id, strategy: "interleave" });
  assert.deepEqual(offered.recommended, [{ id: "interleave", reasons: ["targets_struggle"] }]);
  assert.equal(offered.accepted, undefined, "the agent's offer runs nothing");
  assert.deepEqual((await store.getTopics(session.id)).map((t) => t.label), ["Water Cycle", "Matter", "Photosynthesis"]);

  const accepted = await harness.offerStrategy({ sessionId: session.id, learnerId: LEARNER, topicId: active.id, strategy: "interleave", accepted: true });
  assert.equal(accepted.execution.executed, true);
  assert.deepEqual((await store.getTopics(session.id)).map((t) => t.label), ["Water Cycle", "Photosynthesis", "Matter"], "the related topic comes next");
  assert.equal(outcomes[0].details.pending, true);
  const event = store.events.filter((e) => e.decision_node === "strategy_offered" || e.decisionNode === "strategy_offered").at(-1);
  assert.ok(event, "the acceptance is logged");

  await harness.offerStrategy({ sessionId: session.id, learnerId: LEARNER, topicId: active.id, strategy: "interleave", accepted: true });
  await assert.rejects(
    () => harness.offerStrategy({ sessionId: session.id, learnerId: LEARNER, topicId: active.id, strategy: "interleave", accepted: true }),
    (error) => error.code === "strategy_not_permitted" && /limit 2/.test(error.message),
  );
});
