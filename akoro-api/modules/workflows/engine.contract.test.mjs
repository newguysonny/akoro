// The generic workflow engine (Grand Plan §7.1, Phase 1): create / resume /
// pause / complete / cancel / abandon, idempotent create, CAS transitions,
// and the definition's rule enforced on every move. In memory: no db.
import assert from "node:assert/strict";
import test from "node:test";
import { assertTransition, canTransition, defineWorkflow, TransitionError } from "./definition.js";
import { createWorkflowEngine } from "./engine.js";
import { memoryWorkflowStore } from "./store.js";

// A small teaching-like workflow, registered only for these tests.
const toy = defineWorkflow({
  type: "teaching", version: "t1", initial: "ready",
  states: ["ready", "in_turn", "waiting", "paused", "done", "dropped", "cancelled"],
  transitions: {
    ready: ["in_turn", "cancelled"], in_turn: ["waiting", "paused", "done", "dropped"],
    waiting: ["in_turn", "paused", "dropped", "cancelled"], paused: ["in_turn", "dropped", "cancelled"],
    done: [], dropped: [], cancelled: [],
  },
  statusOf: { ready: "created", in_turn: "active", waiting: "waiting_learner", paused: "paused", done: "completed", dropped: "abandoned", cancelled: "cancelled" },
});
const L = "learner-1";
const fresh = (extra = {}) => {
  const store = memoryWorkflowStore();
  const engine = createWorkflowEngine({ store, definitionOf: (t) => (t === "teaching" ? toy : null), ...extra });
  return { store, engine };
};

test("defineWorkflow refuses a broken definition", () => {
  const base = { type: "teaching", states: ["a", "b"], initial: "a", transitions: { a: ["b"], b: [] }, statusOf: { a: "active", b: "completed" } };
  assert.ok(defineWorkflow(base));
  assert.throws(() => defineWorkflow({ ...base, initial: "z" }), /initial/);
  assert.throws(() => defineWorkflow({ ...base, transitions: { a: ["z"], b: [] } }), /unknown state/);
  assert.throws(() => defineWorkflow({ ...base, transitions: { a: ["b"] } }), /no transition list/);
  assert.throws(() => defineWorkflow({ ...base, statusOf: { a: "active", b: "finished" } }), /lifecycle status/);
  assert.throws(() => defineWorkflow({ ...base, transitions: { a: ["b"], b: ["a"] } }), /terminal state "b" must lead nowhere/);
});

test("the transition rule: listed moves only, typed errors otherwise", () => {
  assert.equal(canTransition(toy, "ready", "in_turn"), true);
  assert.equal(canTransition(toy, "ready", "done"), false);
  assert.equal(canTransition(toy, "done", "in_turn"), false);
  assert.throws(() => assertTransition(toy, "ready", "done"), (e) => e instanceof TransitionError && e.code === "invalid_state_transition" && e.httpStatus === 409);
});

test("create: initial state and its status; an unregistered type or no learner is refused", async () => {
  const { engine } = fresh();
  const { instance, created } = await engine.create({ workflowType: "teaching", learnerId: L, entryMode: "direct", metadata: { topic: "Cells" } });
  assert.equal(created, true);
  assert.equal(instance.state, "ready");
  assert.equal(instance.status, "created");
  assert.equal(instance.workflow_version, "t1");
  assert.deepEqual(instance.metadata, { topic: "Cells" });
  await assert.rejects(() => engine.create({ workflowType: "decay_review", learnerId: L }), (e) => e.code === "unknown_workflow_type");
  await assert.rejects(() => engine.create({ workflowType: "made_up", learnerId: L }), (e) => e.code === "unknown_workflow_type");
  await assert.rejects(() => engine.create({ workflowType: "teaching" }), (e) => e.code === "learner_required");
});

test("create is idempotent on its key — the same key returns the first run, also after a racing insert", async () => {
  const { engine, store } = fresh();
  const a = await engine.create({ workflowType: "teaching", learnerId: L, idempotencyKey: "k1" });
  const b = await engine.create({ workflowType: "teaching", learnerId: L, idempotencyKey: "k1" });
  assert.equal(b.created, false);
  assert.equal(b.instance.id, a.instance.id);
  assert.equal(store.instances.size, 1);
  // The race: findByKey misses, the insert clashes — the existing one wins.
  const realFind = store.findByKey;
  let calls = 0;
  store.findByKey = async (...args) => (calls++ === 0 ? null : realFind(...args));
  const c = await engine.create({ workflowType: "teaching", learnerId: L, idempotencyKey: "k1" });
  assert.equal(c.created, false);
  assert.equal(c.instance.id, a.instance.id);
  // Another learner's same key is their own run.
  const d = await engine.create({ workflowType: "teaching", learnerId: "learner-2", idempotencyKey: "k1" });
  assert.equal(d.created, true);
});

test("resume never creates, is the owner's only, and refuses a finished run", async () => {
  const { engine } = fresh();
  const { instance } = await engine.create({ workflowType: "teaching", learnerId: L });
  assert.equal((await engine.resume(instance.id, L)).id, instance.id);
  await assert.rejects(() => engine.resume(instance.id, "someone-else"), (e) => e.code === "workflow_not_found");
  await assert.rejects(() => engine.resume("00000000-0000-0000-0000-000000000000", L), (e) => e.code === "workflow_not_found");
  await engine.cancel(instance.id, "learner_left");
  await assert.rejects(() => engine.resume(instance.id, L), (e) => e.code === "workflow_ended");
  assert.equal((await engine.listForLearner(L)).length, 1, "resume made nothing");
});

test("transition is a CAS on the current state: a stale move gets null and changes nothing", async () => {
  const { engine } = fresh();
  const { instance } = await engine.create({ workflowType: "teaching", learnerId: L });
  const moved = await engine.transition(instance.id, { from: "ready", to: "in_turn" });
  assert.equal(moved.state, "in_turn");
  assert.equal(moved.status, "active");
  // Two writers both thought it was "ready": the second loses.
  assert.equal(await engine.transition(instance.id, { from: "ready", to: "in_turn" }), null);
  // An unlisted move is refused outright, whatever the current state.
  await assert.rejects(() => engine.transition(instance.id, { from: "in_turn", to: "ready" }), (e) => e.code === "invalid_state_transition");
  assert.equal((await engine.get(instance.id)).state, "in_turn");
});

test("pause / complete / abandon / cancel go to the reachable state with that status, stamped", async () => {
  const { engine } = fresh();
  const make = async () => (await engine.create({ workflowType: "teaching", learnerId: L })).instance.id;
  const id = await make();
  await engine.transition(id, { from: "ready", to: "in_turn" });
  const paused = await engine.pause(id, "learner_requested");
  assert.equal(paused.state, "paused");
  assert.equal(paused.paused_reason, "learner_requested");
  await engine.transition(id, { from: "paused", to: "in_turn" });
  assert.equal((await engine.get(id)).paused_reason, null, "resuming clears the reason");
  const done = await engine.complete(id, { mastered: true });
  assert.equal(done.status, "completed");
  assert.ok(done.completed_at);
  assert.deepEqual(done.metadata.outcome, { mastered: true });
  // Finished: nothing more.
  await assert.rejects(() => engine.cancel(id), (e) => e.code === "invalid_state_transition");

  const id2 = await make();
  // "ready" can be cancelled but not completed or abandoned.
  await assert.rejects(() => engine.complete(id2), (e) => e.code === "invalid_state_transition");
  await assert.rejects(() => engine.abandon(id2), (e) => e.code === "invalid_state_transition");
  const cancelled = await engine.cancel(id2, "changed my mind");
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.cancelled_at);

  const id3 = await make();
  await engine.transition(id3, { from: "ready", to: "in_turn" });
  const dropped = await engine.abandon(id3, "left");
  assert.equal(dropped.status, "abandoned");
  assert.ok(dropped.abandoned_at);
  assert.equal((await engine.listForLearner(L, { active: true })).length, 0);
  assert.equal((await engine.listForLearner(L)).length, 3);
});

test("events: one ordered stream per run, stamped with the state it happened in", async () => {
  const { engine } = fresh();
  const { instance } = await engine.create({ workflowType: "teaching", learnerId: L });
  await engine.appendEvent(instance.id, { event_type: "observation", actor: "system", payload: { a: 1 } });
  await engine.transition(instance.id, { from: "ready", to: "in_turn" });
  await engine.appendEvent(instance.id, { event_type: "agent_action", actor: "agent", payload: { b: 2 } });
  const events = await engine.events(instance.id);
  assert.deepEqual(events.map((e) => e.sequence), [0, 1]);
  assert.deepEqual(events.map((e) => e.workflow_state), ["ready", "in_turn"]);
  await assert.rejects(() => engine.appendEvent("nope", { event_type: "x" }), (e) => e.code === "workflow_not_found");
});

test("emitOutcome records the outcome and hands it to the parent's controller", async () => {
  const delivered = [];
  const { engine } = fresh({ controllerOf: () => ({ onChildOutcome: async (parent, msg) => delivered.push({ parent: parent.id, outcome: msg.outcome }) }) });
  const parent = (await engine.create({ workflowType: "teaching", learnerId: L })).instance;
  const child = (await engine.create({ workflowType: "teaching", learnerId: L, parent: parent.id, source: { workflowId: parent.id, topicId: null, reason: "teach_back" } })).instance;
  assert.deepEqual(await engine.emitOutcome(child.id, { met: true }), { delivered: true });
  assert.deepEqual(delivered, [{ parent: parent.id, outcome: { met: true } }]);
  assert.ok((await engine.events(child.id)).some((e) => e.event_type === "outcome"));
  assert.deepEqual(await engine.emitOutcome(parent.id, { met: false }), { delivered: false }, "no parent, nothing to deliver");
});
