import assert from "node:assert/strict";
import test from "node:test";

/**
 * Phase 5 exit (Grand Plan §17): a full Study Prep session runs to the end
 * WITHOUT Teaching (the inline strategy path), and the plan-rejection,
 * budget-ceiling and cap-out paths hold — plus the submit-status guard.
 * In-memory store, stubbed exam-prep run with a real exam-prep-like status
 * guard, no db, no LLM, no clock. The gate twins of these run on the sandbox
 * (verify/scenarios/studyPrepExit.js).
 */

import { createHarness } from "./harness.js";
import { estimateSessionCost } from "./education-engine.js";
import { memorySubmitAttempt } from "./submit-attempt.testkit.mjs";

class MemoryStore {
  constructor() {
    Object.assign(this, { sessions: new Map(), topics: new Map(), events: [], seq: 0, charges: [], refunds: [], evidence: [], spentOverride: null });
  }
  async findActiveSession(learnerId) {
    return [...this.sessions.values()].find((r) => r.learner_id === learnerId && !["completed", "abandoned", "cancelled"].includes(r.status)) || null;
  }
  async createSession(row) {
    const created = { id: `session-${this.sessions.size + 1}`, created_at: "t", updated_at: "t", ...row };
    this.sessions.set(created.id, created);
    return created;
  }
  async getSession(id) { return this.sessions.get(id) || null; }
  async getTopicById(id) { return this.topics.get(id) || null; }
  async updateSessionConditional(id, expected, patch) {
    const row = this.sessions.get(id);
    if (!row || row.status !== expected) return null;
    const next = { ...row, ...patch };
    this.sessions.set(id, next);
    return next;
  }
  async getTopics(sessionId) { return [...this.topics.values()].filter((r) => r.session_id === sessionId).sort((a, b) => a.position - b.position); }
  async createTopics(sessionId, plan) {
    const rows = plan.map((t, i) => ({ id: `${sessionId}-topic-${i + 1}`, session_id: sessionId, syllabus_topic_id: t.syllabusTopicId, position: i + 1,
      label: t.label, status: i === 0 ? "active" : "queued", attempts_used: 0, deferred_retry_used: false, learner_confirmed_ready: false,
      exam_prep_run_id: null, updated_at: "t" }));
    for (const r of rows) this.topics.set(r.id, r);
    return rows;
  }
  async updateTopicConditional(id, expected, patch) {
    const row = this.topics.get(id);
    if (!row || row.status !== expected) return null;
    const next = { ...row, ...patch };
    this.topics.set(id, next);
    return next;
  }
  async appendEvents(sessionId, rows) {
    return rows.map((r) => { this.seq += 1; const e = { ...r, session_id: sessionId, sequence: this.seq }; this.events.push(e); return e; });
  }
  async listEvents(sessionId, { limit = 200 } = {}) { return this.events.filter((e) => e.session_id === sessionId).slice(-limit); }
  async chargeCoins({ coins }) { this.charges.push(coins); return { charged: coins, applied: [{ took: coins }] }; }
  async refundCoins({ charge }) { this.refunds.push(charge); return 0; }
  async recordMasteryEvidence(entry) { this.evidence.push(entry); return null; }
}

const SYLLABUS = [{ id: "water-cycle", label: "Water Cycle" }, { id: "photosynthesis", label: "Photosynthesis" }, { id: "matter", label: "Matter" }];
const PREREQS = [{ before: "water-cycle", after: "photosynthesis", beforeLabel: "Water Cycle", afterLabel: "Photosynthesis" }];
const KEY = { q1: 1, q2: 0, q3: 2, q4: 1, q5: 0 };
const RIGHT = Object.entries(KEY).map(([questionId, answerIndex]) => ({ questionId, answerIndex }));
const WRONG = Object.entries(KEY).map(([questionId, answerIndex]) => ({ questionId, answerIndex: (answerIndex + 1) % 4 }));
const LEARNER = "learner-1";

/** Exam-prep runs with the real service's guards: a run takes answers only while *_ready. */
function examPrep({ maxAttempts = 3 } = {}) {
  const runs = new Map();
  const { conflict } = { conflict: (message, code) => Object.assign(new Error(message), { code }) };
  return {
    runs,
    policyFor: async () => ({ pass_threshold: 0.7, max_attempts: maxAttempts, policy_version: "exam-confidence-v1" }),
    startRun: async ({ learnerId, studyPrepTopicId }) => {
      const run = { id: `run-${runs.size + 1}`, learner_id: learnerId, study_prep_topic_id: studyPrepTopicId, status: "diagnostic_ready", current_attempt: 1, max_attempts: maxAttempts };
      runs.set(run.id, run);
      return { run, attempt: { attempt_number: 1 } };
    },
    submit: async ({ runId, answers }) => {
      const run = runs.get(runId);
      if (!run) return { notFound: true };
      if (!["diagnostic_ready", "retest_ready"].includes(run.status)) throw conflict("not ready", "attempt_not_ready");
      const correct = answers.filter((a) => KEY[a.questionId] === a.answerIndex).length;
      const score = correct / 5;
      run.status = score >= 0.7 ? "passed" : run.current_attempt >= run.max_attempts ? "change_approach" : "teach_back_required";
      return { run, score, correct, total: 5, passed: score >= 0.7 };
    },
    retest: async ({ runId }) => {
      const run = runs.get(runId);
      if (run.status !== "teach_back_required") throw conflict("no retest", "retest_not_available");
      run.current_attempt += 1;
      run.status = "retest_ready";
      return { run, attempt: { attempt_number: run.current_attempt } };
    },
    publicRun: (run) => ({ id: run.id, status: run.status }),
  };
}

function build(opts = {}) {
  const store = new MemoryStore();
  const topicWorkflow = examPrep(opts);
  // The single-transaction submit (edu.study_prep_submit_attempt), in memory.
  topicWorkflow.submitAttempt = memorySubmitAttempt({ store, runs: topicWorkflow.runs, key: KEY });
  const harness = createHarness({ store, topicWorkflow, syllabus: { resolveTopics: async () => SYLLABUS, prerequisiteEdges: async () => PREREQS }, now: () => "t" });
  return { store, topicWorkflow, harness };
}
const nodes = (store) => store.events.map((e) => e.decision_node || e.decisionNode).filter(Boolean);
const rejections = (store) => store.events.filter((e) => (e.decision_node || e.decisionNode) === "harness_rejection").map((e) => e.facts?.code);

async function confirmed(harness, topicIds) {
  const session = await harness.createSession({ learnerId: LEARNER, goal: "Revise", subject: "Basic Science" });
  await harness.proposePlan({ sessionId: session.id, learnerId: LEARNER, topicIds });
  const { topics } = await harness.confirmPlan({ sessionId: session.id, learnerId: LEARNER });
  return { s: { sessionId: session.id, learnerId: LEARNER }, topics };
}

test("full Study Prep without Teaching: plan → fail → inline strategy → teach-back → retest pass → next topic → completed", async () => {
  const { store, harness } = build();
  const { s, topics } = await confirmed(harness, ["water-cycle", "matter"]);
  const [first, second] = topics;

  await harness.startTopicPractice({ ...s, topicId: first.id, mode: "diagnostic" });
  const missed = await harness.submitPractice({ ...s, topicId: first.id, answers: WRONG });
  assert.equal(missed.outcome, "retest_offered");
  assert.equal(missed.topic.status, "active", "below the mark with tries left: the card still shows the topic active");
  assert.equal(missed.topic.state, "intervention_required", "§8.3: it needs an intervention");

  // Inline: the agent offers a strategy from the library; no Teaching workflow, no child.
  const offered = await harness.offerStrategy({ ...s, topicId: first.id, strategy: "different_analogy", intent: "Try a market example." });
  assert.equal(offered.strategy, "different_analogy");
  // The retest is gated on the learner's own teach-back.
  await assert.rejects(() => harness.startTopicPractice({ ...s, topicId: first.id, mode: "retest" }), (e) => e.code === "teach_back_gate");
  await harness.confirmTeachBack({ ...s, topicId: first.id });
  await harness.startTopicPractice({ ...s, topicId: first.id, mode: "retest" });
  const passed = await harness.submitPractice({ ...s, topicId: first.id, answers: RIGHT });
  assert.equal(passed.outcome, "understood");

  const next = await harness.advanceTopic({ ...s, intent: "On to Matter." });
  assert.equal(next.topic.id, second.id);
  await harness.startTopicPractice({ ...s, topicId: second.id, mode: "diagnostic" });
  assert.equal((await harness.submitPractice({ ...s, topicId: second.id, answers: RIGHT })).outcome, "understood");

  const done = await harness.concludeSession({ ...s, intent: "All settled." });
  assert.equal(done.session.status, "completed");
  assert.deepEqual(done.summary, { understood: 2, topics: 2 });
  assert.equal(store.charges.length, 3, "three practices charged, once each");
  assert.equal(store.evidence.length, 3, "one evidence row per scored attempt");
  for (const node of ["plan_validated", "plan_confirmed", "practice_generated", "strategy_offered", "teach_back_confirmed", "topic_started", "session_concluded"]) {
    assert.ok(nodes(store).includes(node), `${node} narrated`);
  }
  assert.ok(!store.events.some((e) => /teaching_handoff|handoff/.test(JSON.stringify(e))), "no Teaching handoff anywhere");
});

test("plan rejection: each hard rule is a recorded rejection; the valid plan then goes to the card", async () => {
  const { store, harness } = build();
  const session = await harness.createSession({ learnerId: LEARNER, goal: "Revise", subject: "Basic Science" });
  const s = { sessionId: session.id, learnerId: LEARNER };
  const cases = [
    [["photosynthesis", "water-cycle"], "prerequisite_violation"],
    [["water-cycle", "not-a-topic"], "topic_not_in_syllabus"],
    [["matter", "matter"], "duplicate_topic"],
    [[], "tool_schema_invalid"],
    [Array.from({ length: 13 }, (_, i) => `t${i}`), "plan_too_large"],
  ];
  for (const [topicIds, code] of cases) {
    await assert.rejects(() => harness.proposePlan({ ...s, topicIds }), (e) => e.code === code, code);
  }
  assert.equal((await store.getSession(session.id)).status, "planning", "a rejected plan changes nothing");
  assert.deepEqual(rejections(store), cases.map(([, code]) => code), "every rejection is on the stream (red verification rows)");
  const ok = await harness.proposePlan({ ...s, topicIds: ["water-cycle", "photosynthesis"] });
  assert.equal(ok.session.status, "awaiting_confirmation");
});

test("budget ceiling: the agent stops at the approved coins; 'Approve more' lets it go on", async () => {
  const { store, harness } = build();
  const { s, topics } = await confirmed(harness, ["water-cycle"]);
  const approved = estimateSessionCost({ topicCount: 1 }).totalCoins;
  store.sessionCoinsSpent = async () => approved;   // the wakes and checks spent it all
  await assert.rejects(() => harness.startTopicPractice({ ...s, topicId: topics[0].id, mode: "diagnostic", withinEstimateOnly: true }), (e) => e.code === "over_estimate");
  assert.equal(store.charges.length, 0, "nothing charged past the ceiling");
  const budget = await harness.budgetFor(await store.getSession(s.sessionId));
  assert.equal(budget.withinEstimate, false);
  assert.equal(budget.wakeDecisions, 0, "the agent's wake asks first");
  const more = await harness.approveMoreCoins(s);
  assert.equal(more.coins.withinEstimate, true);
  const started = await harness.startTopicPractice({ ...s, topicId: topics[0].id, mode: "diagnostic", withinEstimateOnly: true });
  assert.ok(started.run, "inside the newly approved coins the check runs");
  assert.ok(nodes(store).includes("coins_approved"));
});

test("cap-out: the last miss caps the topic; no more practice; one deferred retry per session", async () => {
  const { store, harness } = build({ maxAttempts: 2 });
  const { s, topics } = await confirmed(harness, ["water-cycle", "matter"]);
  const t = topics[0].id;
  await harness.startTopicPractice({ ...s, topicId: t, mode: "diagnostic" });
  await harness.submitPractice({ ...s, topicId: t, answers: WRONG });
  await harness.confirmTeachBack({ ...s, topicId: t });
  await harness.startTopicPractice({ ...s, topicId: t, mode: "retest" });
  const last = await harness.submitPractice({ ...s, topicId: t, answers: WRONG });
  assert.equal(last.outcome, "capped_out");
  assert.equal(last.topic.status, "capped_out");
  await assert.rejects(() => harness.startTopicPractice({ ...s, topicId: t, mode: "retest" }), (e) => e.code === "invalid_state_transition");
  await harness.deferTopic({ ...s, topicId: t, reasonCode: "attempt_cap_reached" });
  const retried = await harness.retryDeferredTopic({ ...s, topicId: t });
  assert.equal(retried.topic.attemptsUsed, 0);
  await assert.rejects(() => harness.deferTopic({ ...s, topicId: t }), (e) => e.code === "deferred_retry_used");
  // the session moves on past the capped topic
  const next = await harness.advanceTopic(s);
  assert.equal(next.topic.status, "active");
  assert.ok(rejections(store).includes("deferred_retry_used"));
});

test("submit-status guard: a second submit, a stopped session and a missing run are recorded rejections", async () => {
  const { store, topicWorkflow, harness } = build();
  const { s, topics } = await confirmed(harness, ["water-cycle", "matter"]);
  const t = topics[0].id;
  await harness.startTopicPractice({ ...s, topicId: t, mode: "diagnostic" });
  await harness.submitPractice({ ...s, topicId: t, answers: WRONG });
  // same open practice, submitted again (two tabs): refused, scored once
  await assert.rejects(() => harness.submitPractice({ ...s, topicId: t, answers: RIGHT }), (e) => e.code === "invalid_state_transition" && e.httpStatus === 409);
  assert.equal(store.evidence.length, 1, "scored once");
  assert.equal(store.events.filter((e) => (e.event_type || e.eventType) === "engine_result").length, 1);

  // a run that vanished
  const topic = store.topics.get(t);
  store.topics.set(t, { ...topic, exam_prep_run_id: "run-missing" });
  await assert.rejects(() => harness.submitPractice({ ...s, topicId: t, answers: RIGHT }), (e) => e.code === "invalid_state_transition");
  store.topics.set(t, topic);

  // a cancelled session takes no answers, even with a practice open
  await harness.confirmTeachBack({ ...s, topicId: t });
  await harness.startTopicPractice({ ...s, topicId: t, mode: "retest" });
  await harness.cancelSession(s);
  const before = [...topicWorkflow.runs.values()].map((r) => r.status).join();
  await assert.rejects(() => harness.submitPractice({ ...s, topicId: t, answers: RIGHT }), (e) => e.code === "invalid_state_transition");
  assert.equal([...topicWorkflow.runs.values()].map((r) => r.status).join(), before, "the run is untouched");
  assert.equal(store.topics.get(t).status, "retest", "the retest stays out, unscored");
});

test("a passing score settles the topic before the evidence is written", async () => {
  const { store, harness } = build();
  const { s, topics } = await confirmed(harness, ["water-cycle"]);
  await harness.startTopicPractice({ ...s, topicId: topics[0].id, mode: "diagnostic" });
  let statusAtEvidence = null;
  store.recordMasteryEvidence = async () => { statusAtEvidence = store.topics.get(topics[0].id).status; throw new Error("evidence store down"); };
  await assert.rejects(() => harness.submitPractice({ ...s, topicId: topics[0].id, answers: RIGHT }), /evidence store down/);
  assert.equal(statusAtEvidence, "understood");
  assert.equal(store.topics.get(topics[0].id).status, "understood", "the score's outcome stands even when the evidence write fails");
});
