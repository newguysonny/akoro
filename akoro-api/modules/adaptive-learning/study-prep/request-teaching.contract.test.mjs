import assert from "node:assert/strict";
import test from "node:test";

/**
 * Phase 5 / D15 (Grand Plan §8.3, §8.4): every intervention is a Teaching
 * Workflow. The harness moves a missed topic intervention_required →
 * awaiting_teaching (request_teaching) → retest_ready (TEACHING_COMPLETED) →
 * retest → understood; without Teaching the inline teach-back stays the
 * fallback. In-memory store, a stubbed teaching port, no db, no LLM.
 */

import { createHarness } from "./harness.js";
import { memorySubmitAttempt } from "./submit-attempt.testkit.mjs";
import { guardStudyPrepStore } from "./workflow.js";
import { buildRegistry } from "../tools/registry.js";

class MemoryStore {
  constructor() { Object.assign(this, { sessions: new Map(), topics: new Map(), events: [], seq: 0, charges: [], evidence: [] }); }
  async findActiveSession(l) { return [...this.sessions.values()].find((r) => r.learner_id === l && !["completed", "abandoned", "cancelled"].includes(r.status)) || null; }
  async createSession(row) { const c = { id: `session-${this.sessions.size + 1}`, workflow_id: "wf-parent", ...row }; this.sessions.set(c.id, c); return c; }
  async getSession(id) { return this.sessions.get(id) || null; }
  async getTopicById(id) { return this.topics.get(id) || null; }
  async updateSessionConditional(id, expected, patch) { const r = this.sessions.get(id); if (!r || r.status !== expected) return null; const n = { ...r, ...patch }; this.sessions.set(id, n); return n; }
  async getTopics(sid) { return [...this.topics.values()].filter((r) => r.session_id === sid).sort((a, b) => a.position - b.position); }
  async createTopics(sid, plan) {
    const rows = plan.map((t, i) => ({ id: `${sid}-t${i + 1}`, session_id: sid, syllabus_topic_id: t.syllabusTopicId, position: i + 1, label: t.label,
      status: i === 0 ? "active" : "queued", attempts_used: 0, deferred_retry_used: false, learner_confirmed_ready: false, exam_prep_run_id: null, updated_at: "t" }));
    for (const r of rows) this.topics.set(r.id, r);
    return rows;
  }
  async updateTopicConditional(id, expected, patch) { const r = this.topics.get(id); if (!r || r.status !== expected) return null; const n = { ...r, ...patch }; this.topics.set(id, n); return n; }
  async appendEvents(sid, rows) { return rows.map((r) => { this.seq += 1; const e = { ...r, session_id: sid, sequence: this.seq }; this.events.push(e); return e; }); }
  async listEvents(sid, { limit = 200 } = {}) { return this.events.filter((e) => e.session_id === sid).slice(-limit); }
  async chargeCoins({ coins }) { this.charges.push(coins); return { charged: coins, applied: [{ took: coins }] }; }
  async refundCoins() { return 0; }
  async recordMasteryEvidence(e) { this.evidence.push(e); return null; }
}

const SYLLABUS = [{ id: "water-cycle", label: "Water Cycle" }, { id: "matter", label: "Matter" }];
const KEY = { q1: 1, q2: 0, q3: 2, q4: 1, q5: 0 };
const RIGHT = Object.entries(KEY).map(([questionId, answerIndex]) => ({ questionId, answerIndex }));
const WRONG = RIGHT.map((a) => ({ ...a, answerIndex: (a.answerIndex + 1) % 4 }));
const L = "learner-1";

function examPrep() {
  const runs = new Map();
  return {
    runs,
    policyFor: async () => ({ pass_threshold: 0.7, max_attempts: 3 }),
    startRun: async ({ learnerId, studyPrepTopicId }) => { const run = { id: `run-${runs.size + 1}`, learner_id: learnerId, study_prep_topic_id: studyPrepTopicId, status: "diagnostic_ready", current_attempt: 1, max_attempts: 3, pass_threshold: 0.7 }; runs.set(run.id, run); return { run, attempt: { attempt_number: 1 } }; },
    retest: async ({ runId }) => { const run = runs.get(runId); assert.equal(run.status, "teach_back_required"); run.current_attempt += 1; run.status = "retest_ready"; return { run, attempt: { attempt_number: run.current_attempt } }; },
    publicRun: (run) => ({ id: run.id, status: run.status }),
  };
}

function teachingStub() {
  const requests = [];
  let n = 0;
  return {
    requests,
    request: async (args) => { requests.push(args); const open = requests.length > 1 && requests[0].topic.id === args.topic.id; if (!open) n += 1; return { workflowId: `wf-teach-${n}`, state: "proposed", strategy: args.strategy }; },
  };
}

function build({ teaching = teachingStub(), mirror = null } = {}) {
  const store = new MemoryStore();
  const topicWorkflow = examPrep();
  topicWorkflow.submitAttempt = memorySubmitAttempt({ store, runs: topicWorkflow.runs, key: KEY });
  const harness = createHarness({ store, topicWorkflow, syllabus: { resolveTopics: async () => SYLLABUS, prerequisiteEdges: async () => [] }, teaching, workflowMirror: mirror, now: () => "t" });
  return { store, harness, teaching, topicWorkflow };
}
const nodes = (store) => store.events.map((e) => e.decision_node || e.decisionNode).filter(Boolean);

async function missed(harness) {
  const session = await harness.createSession({ learnerId: L, goal: "Revise", subject: "Basic Science" });
  await harness.proposePlan({ sessionId: session.id, learnerId: L, topicIds: ["water-cycle", "matter"] });
  const { topics } = await harness.confirmPlan({ sessionId: session.id, learnerId: L });
  const s = { sessionId: session.id, learnerId: L };
  await harness.startTopicPractice({ ...s, topicId: topics[0].id, mode: "diagnostic" });
  const miss = await harness.submitPractice({ ...s, topicId: topics[0].id, answers: WRONG });
  return { s, topic: topics[0], miss };
}

test("D15 path: missed → intervention_required → awaiting_teaching → retest_ready → retest → understood", async () => {
  const { store, harness, teaching } = build();
  const { s, topic, miss } = await missed(harness);
  assert.equal(miss.topic.state, "intervention_required");
  assert.equal(miss.topic.status, "active", "the card still reads it as the active topic");

  const asked = await harness.requestTeaching({ ...s, topicId: topic.id, strategy: "different_analogy", focusGaps: ["evaporation"], intent: "An everyday analogy fits this gap." });
  assert.equal(asked.topic.state, "awaiting_teaching");
  assert.equal(asked.topic.teachingWorkflowId, "wf-teach-1");
  assert.equal(teaching.requests[0].strategy, "different_analogy");
  assert.deepEqual(teaching.requests[0].gaps, ["evaporation"]);
  assert.equal(teaching.requests[0].session.workflow_id, "wf-parent");
  // no retest while teaching waits
  await assert.rejects(() => harness.startTopicPractice({ ...s, topicId: topic.id, mode: "retest" }), (e) => e.code === "teach_back_gate");

  const done = await harness.completeTeaching({ ...s, topicId: topic.id, workflowId: "wf-teach-1", objectiveMet: true });
  assert.equal(done.topic.state, "retest_ready");
  assert.equal(done.topic.learnerConfirmedReady, true, "the card's retest button and the auto-start read this");
  assert.equal((await harness.completeTeaching({ ...s, topicId: topic.id })).already, true, "idempotent");

  const retest = await harness.startTopicPractice({ ...s, topicId: topic.id, mode: "retest" });
  assert.equal(retest.topic.state, "retest");
  const passed = await harness.submitPractice({ ...s, topicId: topic.id, answers: RIGHT });
  assert.equal(passed.outcome, "understood");
  assert.equal(store.topics.get(topic.id).status, "understood");
  for (const node of ["teaching_requested", "teaching_completed"]) assert.ok(nodes(store).includes(node), node);
  assert.ok(store.events.some((e) => e.action === "request_teaching" && e.origin === "agent_stated_intent"));
});

test("request_teaching is idempotent while the topic waits; a new strategy is recorded", async () => {
  const { harness, teaching } = build();
  const { s, topic } = await missed(harness);
  const first = await harness.requestTeaching({ ...s, topicId: topic.id, strategy: "teach_back" });
  const again = await harness.requestTeaching({ ...s, topicId: topic.id, strategy: "worked_examples" });
  assert.equal(again.reused, true);
  assert.equal(again.teaching.workflowId, first.teaching.workflowId);
  assert.equal(again.topic.state, "awaiting_teaching");
  assert.equal(teaching.requests[1].strategy, "worked_examples");
  assert.deepEqual(teaching.requests[1].gaps, [], "no check gaps on a human-answered practice");
});

test("request_teaching is checked: library strategy, a topic that needs an intervention, a running plan", async () => {
  const { harness } = build();
  const session = await harness.createSession({ learnerId: L, goal: "Revise", subject: "Basic Science" });
  const s = { sessionId: session.id, learnerId: L };
  await assert.rejects(() => harness.requestTeaching({ ...s, strategy: "teach_back" }), (e) => e.code === "invalid_state_transition", "not while planning");
  await harness.proposePlan({ ...s, topicIds: ["water-cycle"] });
  const { topics } = await harness.confirmPlan(s);
  await assert.rejects(() => harness.requestTeaching({ ...s, topicId: topics[0].id, strategy: "drop_it" }), (e) => e.code === "strategy_not_permitted");
  await assert.rejects(() => harness.requestTeaching({ ...s, topicId: topics[0].id, strategy: "teach_back" }), (e) => e.code === "invalid_state_transition", "an unchecked active topic needs no intervention");
});

test("Teaching off: request_teaching → teaching_unavailable, and the inline path still works", async () => {
  const { store, harness } = build({ teaching: null });
  const { s, topic } = await missed(harness);
  await assert.rejects(() => harness.requestTeaching({ ...s, topicId: topic.id, strategy: "teach_back" }), (e) => e.code === "teaching_unavailable" && e.httpStatus === 409);
  assert.equal(store.topics.get(topic.id).status, "intervention_required", "nothing moved");
  await harness.offerStrategy({ ...s, topicId: topic.id, strategy: "different_analogy" });
  const confirmed = await harness.confirmTeachBack({ ...s, topicId: topic.id });
  assert.equal(confirmed.topic.state, "retest_ready");
  await assert.rejects(() => harness.confirmTeachBack({ ...s, topicId: topic.id }), (e) => e.code === "invalid_state_transition");
});

test("a teaching session that can't be made is teaching_unavailable, the topic unchanged", async () => {
  const { store, harness } = build({ teaching: { request: async () => null } });
  const { s, topic } = await missed(harness);
  await assert.rejects(() => harness.requestTeaching({ ...s, topicId: topic.id, strategy: "teach_back" }), (e) => e.code === "teaching_unavailable");
  assert.equal(store.topics.get(topic.id).status, "intervention_required");
});

test("teaching abandoned: offered again → keeps waiting on the new session; otherwise back to intervention_required", async () => {
  const { store, harness } = build();
  const { s, topic } = await missed(harness);
  await harness.requestTeaching({ ...s, topicId: topic.id, strategy: "teach_back" });
  await harness.teachingAbandoned({ ...s, topicId: topic.id, reofferedWorkflowId: "wf-teach-2" });
  assert.equal(store.topics.get(topic.id).status, "awaiting_teaching");
  assert.equal(store.topics.get(topic.id).teaching_workflow_id, "wf-teach-2");
  await harness.teachingAbandoned({ ...s, topicId: topic.id });
  assert.equal(store.topics.get(topic.id).status, "intervention_required");
});

test("a teaching session handed over before the topic states (topic still active) completes along the legal path", async () => {
  const { store, harness } = build();
  const session = await harness.createSession({ learnerId: L, goal: "Revise", subject: "Basic Science" });
  const s = { sessionId: session.id, learnerId: L };
  await harness.proposePlan({ ...s, topicIds: ["water-cycle"] });
  const { topics } = await harness.confirmPlan(s);
  const done = await harness.completeTeaching({ ...s, topicId: topics[0].id, workflowId: "wf-old" });
  assert.equal(done.topic.state, "retest_ready");
  assert.equal(store.topics.get(topics[0].id).teaching_workflow_id, "wf-old");
});

test("the teaching session closes only when the topic leaves work, not on intervention → teaching → retest_ready", async () => {
  const left = [];
  const mirror = { sessionCreated: async () => {}, sessionMoved: async () => {}, eventsWritten: async () => {}, topicLeft: async (topic) => left.push(topic.status) };
  const { harness } = build({ mirror });
  const { s, topic } = await missed(harness);
  await harness.requestTeaching({ ...s, topicId: topic.id, strategy: "teach_back" });
  await harness.completeTeaching({ ...s, topicId: topic.id });
  assert.deepEqual(left, []);
  await harness.deferTopic({ ...s, topicId: topic.id, reasonCode: "learner_asked" });
  assert.deepEqual(left, ["deferred"]);
});

test("the guarded store refuses a retest straight from intervention_required", async () => {
  const store = guardStudyPrepStore(new MemoryStore());
  const session = await store.createSession({ learner_id: L, status: "planning", goal: "g", subject: "s" });
  const [t] = await store.createTopics(session.id, [{ syllabusTopicId: "a", label: "A" }]);
  store.topics.set(t.id, { ...t, status: "intervention_required" });
  await assert.rejects(() => store.updateTopicConditional(t.id, "intervention_required", { status: "retest" }), (e) => e.code === "invalid_state_transition");
});

test("the agent's request_teaching tool reaches the harness with its strategy and gaps", async () => {
  const calls = [];
  const registry = buildRegistry({ readTools: {}, harness: { requestTeaching: async (a) => { calls.push(a); return { teaching: { workflowId: "w" } }; } }, learnerId: "L", sessionId: "S" });
  assert.ok(registry.catalogue.some((t) => (t.name || t.function?.name || "").includes("request_teaching") || JSON.stringify(t).includes("request_teaching")));
  await registry.execute("request_teaching", { topicId: "t1", strategy: "teach_back", focusGaps: ["osmosis"] }, "Teach-back fits a near miss.");
  assert.deepEqual(calls[0], { sessionId: "S", learnerId: "L", topicId: "t1", strategy: "teach_back", focusGaps: ["osmosis"], peerExplanations: undefined, intent: "Teach-back fits a near miss." });
});
