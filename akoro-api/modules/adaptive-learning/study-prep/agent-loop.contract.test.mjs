import assert from "node:assert/strict";
import test from "node:test";

/**
 * Agent-loop contract tests (Master Plan §4.13): stub agents only — no LLM
 * in the test path. Loop cap, terminal actions, 402 pause, observation
 * shaping, and the S5 acceptance list.
 */

import { runAgentStep, TERMINAL_ACTIONS, observationFor } from "./agent-loop.js";
import { POLICY } from "./state-machine.js";
import { createHarness } from "./harness.js";
import { makeEvent } from "./events.js";

// ── tiny in-memory store (same semantics as the harness contract test) ─────

class MemoryStore {
  constructor() { this.sessions = new Map(); this.topics = new Map(); this.events = []; this.sequence = 0; this.balance = 100; }
  async findActiveSession(learnerId) { return [...this.sessions.values()].find((r) => r.learner_id === learnerId && !["completed", "abandoned", "cancelled"].includes(r.status)) || null; }
  async createSession(row) { this.n = (this.n || 0) + 1; const created = { id: `s${this.n}`, tool_calls_used: 0, ...row }; this.sessions.set(created.id, created); return created; }
  async getSession(id) { return this.sessions.get(id) || null; }
  async updateSessionConditional(id, expected, patch) { const row = this.sessions.get(id); if (!row || row.status !== expected) return null; const updated = { ...row, ...patch }; this.sessions.set(id, updated); return updated; }
  async getTopics(sessionId) { return [...this.topics.values()].filter((r) => r.session_id === sessionId).sort((a, b) => a.position - b.position); }
  async createTopics(sessionId, plan) { const rows = (plan || []).map((t, i) => ({ id: `t-${sessionId}-${i + 1}`, session_id: sessionId, syllabus_topic_id: t.syllabusTopicId, position: t.position ?? i + 1, label: t.label, status: "queued", attempts_used: 0, deferred_retry_used: false, learner_confirmed_ready: false, exam_prep_run_id: null })); rows.forEach((r) => this.topics.set(r.id, r)); if (rows[0]) rows[0].status = "active"; return rows; }
  async updateTopicConditional(id, expected, patch) { const row = this.topics.get(id); if (!row || row.status !== expected) return null; const updated = { ...row, ...patch }; this.topics.set(id, updated); return updated; }
  async appendEvents(sessionId, rows) { return rows.map((row) => { this.sequence += 1; const placed = { created_at: "2026-01-01T00:00:00Z", ...row, session_id: sessionId, sequence: this.sequence }; this.events.push(placed); return placed; }); }
  async listEvents(sessionId, { limit = 200 } = {}) { return this.events.filter((r) => r.session_id === sessionId).slice(-limit); }
  async chargeCoins({ coins }) { this.balance -= coins; return { charged: coins, applied: [{ took: coins }] }; }
  async refundCoins({ charge }) { this.balance += charge?.charged || 0; return 0; }
  async recordMasteryEvidence() { return "c1"; }
}

const SYLLABUS = [{ id: "water-cycle", label: "Water Cycle" }, { id: "photosynthesis", label: "Photosynthesis" }];
const syllabus = {
  resolveTopics: async () => SYLLABUS,
  prerequisiteEdges: async () => [{ before: "water-cycle", after: "photosynthesis", beforeLabel: "Water Cycle", afterLabel: "Photosynthesis" }],
};
const topicWorkflow = {
  policyFor: async () => ({ pass_threshold: 0.7, max_attempts: 3, policy_version: "v1" }),
};
const LEARNER = "learner-1";

function stubAgent(script) {
  let index = 0;
  return { next: async () => script[Math.min(index++, script.length - 1)] };
}

// ── tests ──────────────────────────────────────────────────────────────────

test("a stub agent that inspects then proposes ends on the propose_plan terminal action", async () => {
  const store = new MemoryStore();
  const harness = createHarness({ store, topicWorkflow, syllabus, now: () => "2026-01-01T00:00:00Z" });
  const session = await harness.createSession({ learnerId: LEARNER, goal: "Prepare", subject: "Basic Science" });

  const calls = [];
  const registry = {
    catalogue: [{ name: "syllabus.resolve" }, { name: "propose_plan" }],
    execute: async (name, args, intent) => {
      calls.push(name);
      if (name === "syllabus.resolve") return { topics: SYLLABUS };
      return harness.proposePlan({ sessionId: session.id, learnerId: LEARNER, topicIds: args.topics, intent });
    },
  };
  const agent = stubAgent([
    { tool: "syllabus.resolve", args: {}, intent: "I need the syllabus first." },
    { tool: "propose_plan", args: { topics: ["water-cycle", "photosynthesis"] }, intent: "Weak topics first, prerequisites respected." },
    { tool: "syllabus.resolve", args: {}, intent: "should never be reached" },
  ]);
  const result = await runAgentStep({ sessionId: session.id, goal: session.goal, agent, registry, store, harness });
  assert.equal(result.ended, "terminal");
  assert.equal(result.terminal, "propose_plan");
  assert.equal(result.iterations, 2);
  assert.deepEqual(calls, ["syllabus.resolve", "propose_plan"]);
  // observation-driven: the agent's second call came after seeing the syllabus
  const toolCalls = store.events.filter((event) => event.event_type === "agent_tool_call");
  assert.equal(toolCalls.length, 2);
  assert.equal(toolCalls[0].agent_intent, "I need the syllabus first.");
  // the plan landed
  const after = await store.getSession(session.id);
  assert.equal(after.status, "awaiting_confirmation");
});

test("a looping stub agent pauses the session with agent_loop_cap and no partial state", async () => {
  const store = new MemoryStore();
  const harness = createHarness({ store, topicWorkflow, syllabus, now: () => "2026-01-01T00:00:00Z" });
  const session = await harness.createSession({ learnerId: LEARNER, goal: "Prepare", subject: "Basic Science" });
  const registry = {
    catalogue: [],
    execute: async () => ({ ok: true, note: "no-op read" }),
  };
  const agent = { next: async () => ({ tool: "syllabus.resolve", args: {}, intent: "Looping forever." }) };
  const result = await runAgentStep({ sessionId: session.id, goal: session.goal, agent, registry, store, harness });
  assert.equal(result.ended, "agent_loop_cap");
  assert.equal(result.iterations, POLICY.MAX_ITERATIONS_PER_STEP);
  const after = await store.getSession(session.id);
  assert.equal(after.status, "paused");
  assert.equal(after.paused_reason, "agent_loop_cap");
  // no partial state: the session never left planning
  assert.equal(store.events.filter((event) => event.event_type === "agent_tool_call").length, POLICY.MAX_ITERATIONS_PER_STEP);
  const pauseEvent = store.events.find((event) => event.decision_node === "session_paused");
  assert.ok(pauseEvent, "the pause is narrated on the activity log");
  assert.match(pauseEvent.narrative, /I got stuck/);
});

test("an insufficient-balance rejection ends the step with a resumable pause observation", async () => {
  const store = new MemoryStore();
  store.balance = 0;
  const harness = createHarness({ store, topicWorkflow, syllabus, now: () => "2026-01-01T00:00:00Z" });
  const session = await harness.createSession({ learnerId: LEARNER, goal: "Prepare", subject: "Basic Science" });
  const error = new Error("Insufficient coins");
  error.code = "insufficient_balance";
  const registry = {
    catalogue: [],
    execute: async () => { throw error; },
  };
  const agent = { next: async () => ({ tool: "practice.generate", args: { topicId: "t1", mode: "diagnostic" }, intent: "Practice now." }) };
  const result = await runAgentStep({ sessionId: session.id, goal: session.goal, agent, registry, store, harness });
  assert.equal(result.ended, "insufficient_balance");
  const after = await store.getSession(session.id);
  assert.equal(after.status, "planning", "the harness pause for a 402 happens inside the practice op; the loop surfaces the observation");
  assert.ok(result.observations.some((observation) => observation.ok === false && observation.code === "insufficient_balance"));
});

test("observations are bounded: rejections carry the stable code, results are size-capped", () => {
  const rejection = observationFor({ ok: false, error: { code: "attempt_cap_exceeded", message: "x".repeat(500) } });
  assert.equal(rejection.ok, false);
  assert.equal(rejection.code, "attempt_cap_exceeded");
  assert.ok(rejection.message.length <= 300);

  const result = observationFor({ ok: true, result: { long: "y".repeat(5000) } });
  assert.ok(result.result.long.length <= 300);
  // huge nested objects survive as bounded JSON
  const nested = observationFor({ ok: true, result: { list: Array.from({ length: 50 }, (_, i) => i) } });
  assert.equal(nested.result.list.length, 12);
});

test("terminal actions are exactly the S5 set", () => {
  assert.deepEqual(TERMINAL_ACTIONS, ["propose_plan", "advance_topic", "defer_topic", "conclude_session"]);
});

test("malformed agent iterations are recorded and never crash the loop", async () => {
  const store = new MemoryStore();
  const harness = createHarness({ store, topicWorkflow, syllabus, now: () => "2026-01-01T00:00:00Z" });
  const session = await harness.createSession({ learnerId: LEARNER, goal: "Prepare", subject: "Basic Science" });
  const registry = { catalogue: [], execute: async () => ({}) };
  const agent = stubAgent([{}, { tool: null, action: null }, { tool: "propose_plan", args: { topics: ["water-cycle"] }, intent: "Finally." }]);
  // registry.execute for propose_plan needs a real harness call — wire it:
  const registry2 = {
    catalogue: [],
    execute: async (name, args, intent) => harness.proposePlan({ sessionId: session.id, learnerId: LEARNER, topicIds: args.topics, intent }),
  };
  const result = await runAgentStep({ sessionId: session.id, goal: session.goal, agent, registry: registry2, store, harness });
  assert.equal(result.ended, "terminal");
  const malformed = store.events.filter((event) => event.action === "malformed");
  assert.equal(malformed.length, 2, "both empty iterations are on the log");
});

test("the step cap after the plan is already waiting leaves it waiting — no 409, no pause", async () => {
  const store = new MemoryStore();
  const harness = createHarness({ store, topicWorkflow, syllabus, now: () => "2026-01-01T00:00:00Z" });
  const session = await harness.createSession({ learnerId: LEARNER, goal: "Prepare", subject: "Basic Science" });
  let proposed = false;
  const registry = {
    catalogue: [],
    // The plan lands on the first call, but the agent never takes a terminal action.
    execute: async () => {
      if (!proposed) { proposed = true; await harness.proposePlan({ sessionId: session.id, learnerId: LEARNER, topicIds: ["water-cycle"] }); }
      return { ok: true };
    },
  };
  const agent = { next: async () => ({ tool: "syllabus.resolve", args: {}, intent: "Looping." }) };
  const result = await runAgentStep({ sessionId: session.id, goal: session.goal, agent, registry, store, harness });
  assert.equal(result.ended, "agent_loop_cap");
  const after = await store.getSession(session.id);
  assert.equal(after.status, "awaiting_confirmation", "the plan card still waits for the learner");
  assert.equal(store.events.filter((event) => event.decision_node === "session_paused").length, 0);
});

test("deep research: proposing before the required reads is refused as an observation; after them it goes through", async () => {
  const store = new MemoryStore();
  const harness = createHarness({ store, topicWorkflow, syllabus, now: () => "2026-01-01T00:00:00Z" });
  const session = await harness.createSession({ learnerId: LEARNER, goal: "Prepare", subject: "Basic Science" });
  const calls = [];
  const registry = {
    catalogue: [],
    execute: async (name, args) => {
      calls.push(name);
      if (name === "syllabus.resolve") return { topics: SYLLABUS };
      if (name === "propose_plan") return harness.proposePlan({ sessionId: session.id, learnerId: LEARNER, topicIds: args.topics });
      return { ok: true };
    },
  };
  const agent = stubAgent([
    { tool: "syllabus.resolve", args: {}, intent: "Syllabus first." },
    { tool: "propose_plan", args: { topics: ["water-cycle"] }, intent: "Too early." },
    { tool: "learner.get_state", args: {}, intent: "Their state." },
    { tool: "propose_plan", args: { topics: ["water-cycle"] }, intent: "Now." },
  ]);
  const result = await runAgentStep({ sessionId: session.id, goal: session.goal, agent, registry, store, harness, requireReads: ["syllabus.resolve", "learner.get_state"] });
  assert.equal(result.ended, "terminal");
  assert.deepEqual(calls, ["syllabus.resolve", "learner.get_state", "propose_plan"], "the early propose never ran");
  assert.ok(result.observations.some((o) => o.code === "research_incomplete" && /learner\.get_state/.test(o.message)));
  assert.equal((await store.getSession(session.id)).status, "awaiting_confirmation");
  // What each read found is kept as a learner-safe line on its observation.
  assert.ok(store.events.some((e) => e.event_type === "observation" && e.tool === "syllabus.resolve" && /topics? found/.test(e.facts?.summary || "")));
});
