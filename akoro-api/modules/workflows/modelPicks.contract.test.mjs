// Scenario K (§7.11.5): the learner's pick is saved on the chat thread and on
// their open Study Prep / Teaching workflows, each change is a model.changed
// event, the latest pick follows the learner, and locked roles never get it.
import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";

const { makeModelPicks, ModelPickError, MODEL_CHANGED } = await import("./modelPicks.js");
const { createModelRegistry } = await import("../../lib/modelRegistry.js");
const { createWorkflowEngine } = await import("./engine.js");
const { memoryWorkflowStore } = await import("./store.js");
const { EVENT_TYPES } = await import("./envelope.js");
const { narrate } = await import("./narrator.js");
const { defineWorkflow } = await import("./definition.js");

// Small stand-ins for the two picked workflow types (the real ones load the app's modules).
const toy = (type) => defineWorkflow({
  type, version: "t1", initial: "proposed", states: ["proposed", "active", "done"],
  transitions: { proposed: ["active"], active: ["done"], done: [] },
  statusOf: { proposed: "created", active: "active", done: "completed" },
});
const DEFS = { study_prep: toy("study_prep"), teaching: toy("teaching") };

const env = { ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", DEEPSEEK_API_KEY: "k", DEEPSEEK_MODEL: "deepseek-chat",
  AI_MODELS: JSON.stringify([{ id: "deepseek", provider: "deepseek", price: { in: 0.3, out: 1.2 } }]) };
const registry = createModelRegistry(env);

function memoryThreads() {
  const rows = new Map();
  return {
    rows,
    add(id, learnerId) { rows.set(id, { id, learnerId, selection: {} }); },
    async get(id, learnerId) { const r = rows.get(id); return r && r.learnerId === learnerId ? { id, selection: r.selection } : null; },
    async set(id, learnerId, selection) { const r = rows.get(id); if (!r || r.learnerId !== learnerId) return false; r.selection = selection; return true; },
    async latest(learnerId) {
      const mine = [...rows.values()].filter((r) => r.learnerId === learnerId && r.selection.changedAt).sort((a, b) => b.selection.changedAt.localeCompare(a.selection.changedAt));
      return mine[0] ? { ...mine[0].selection, conversationId: mine[0].id } : null;
    },
  };
}

function setup({ allowed = ["claude-sonnet", "deepseek"], envOver = {} } = {}) {
  const store = memoryWorkflowStore();
  const engine = createWorkflowEngine({ store, publish: () => {}, definitionOf: (t) => DEFS[t] });
  const threads = memoryThreads();
  let t = 0;
  const now = () => new Date(Date.UTC(2026, 10, 7, 10, 0, t++)).toISOString();
  const picks = makeModelPicks({ threads, engine, registry, env: { ...env, ...envOver }, tiersFor: async () => ({ allowedModels: allowed }), now });
  return { store, engine, threads, picks };
}

test("model.changed is a stored event type with a learner-facing line", () => {
  assert.ok(EVENT_TYPES.includes(MODEL_CHANGED));
  assert.equal(narrate({ type: MODEL_CHANGED, payload: { label: "Claude Sonnet" } }).headline, "Model changed");
});

test("a pick on a chat is saved on the thread, reaches the learner's open workflows, and is the learner's latest", async () => {
  const { engine, threads, picks } = setup();
  threads.add("c1", "L1");
  const { instance: sp } = await engine.create({ workflowType: "study_prep", learnerId: "L1" });
  const { instance: tw } = await engine.create({ workflowType: "teaching", learnerId: "L1", state: "proposed" });
  const { instance: other } = await engine.create({ workflowType: "study_prep", learnerId: "L2" });

  const r = await picks.saveThreadPick({ learnerId: "L1", conversationId: "c1", modelId: "claude-sonnet" });
  assert.equal(r.changed, true);
  assert.equal(r.previous, null);
  assert.equal(r.selection.modelId, "claude-sonnet");
  assert.equal(r.selection.resolved, "claude-sonnet");
  assert.equal(r.selection.source, "learner");
  assert.deepEqual(r.workflows.sort(), [sp.id, tw.id].sort());
  assert.equal(threads.rows.get("c1").selection.modelId, "claude-sonnet");

  for (const id of [sp.id, tw.id]) {
    const w = await engine.get(id);
    assert.equal(w.model_selection.modelId, "claude-sonnet", "saved on the workflow");
    const evs = await engine.events(id);
    const changed = evs.filter((e) => e.event_type === MODEL_CHANGED);
    assert.equal(changed.length, 1, "one model.changed event");
    assert.equal(changed[0].visibility, "learner");
    assert.deepEqual([changed[0].payload.from, changed[0].payload.to], [null, "claude-sonnet"]);
  }
  assert.deepEqual((await engine.get(other.id)).model_selection, {}, "another learner's workflow is untouched");
  assert.equal((await picks.learnerPick("L1")).modelId, "claude-sonnet", "the latest pick follows the learner (another device)");

  const again = await picks.saveThreadPick({ learnerId: "L1", conversationId: "c1", modelId: "claude-sonnet" });
  assert.equal(again.changed, false, "the same pick again is no change");
  assert.equal((await engine.events(sp.id)).filter((e) => e.event_type === MODEL_CHANGED).length, 1, "…and no second event");

  const back = await picks.saveThreadPick({ learnerId: "L1", conversationId: "c1", modelId: null });
  assert.equal(back.changed, true);
  assert.equal(back.previous, "claude-sonnet");
  assert.equal(back.selection.modelId, null, "null is the default");
  assert.equal((await engine.get(sp.id)).model_selection.modelId, null);
});

test("an unknown or unpickable model is refused; a chat that isn't the learner's is not found", async () => {
  const { threads, picks } = setup();
  threads.add("c1", "L1");
  await assert.rejects(picks.saveThreadPick({ learnerId: "L1", conversationId: "c1", modelId: "made-up" }), (e) => e instanceof ModelPickError && e.code === "unknown_model");
  await assert.rejects(picks.saveThreadPick({ learnerId: "L1", conversationId: "c1", modelId: "gpt-4.1-mini" }), (e) => e.code === "unknown_model", "a price-table model isn't pickable");
  await assert.rejects(picks.saveThreadPick({ learnerId: "L2", conversationId: "c1", modelId: "claude-sonnet" }), (e) => e.code === "thread_not_found");
});

test("a pick outside the payer's plan is saved with its notice (it falls back at call time)", async () => {
  const { threads, picks } = setup({ allowed: ["deepseek"] });
  threads.add("c1", "L1");
  const r = await picks.saveThreadPick({ learnerId: "L1", conversationId: "c1", modelId: "claude-opus" });
  assert.equal(r.selection.modelId, "claude-opus");
  assert.equal(r.selection.source, "default");
  assert.match(r.selection.notice, /isn't in your plan/);
});

test("call fields: the workflow's own pick, else the learner's; never for a locked role or with the picker off", async () => {
  const { engine, threads, picks } = setup();
  threads.add("c1", "L1");
  await picks.saveThreadPick({ learnerId: "L1", conversationId: "c1", modelId: "deepseek" });
  const { instance: w } = await engine.create({ workflowType: "teaching", learnerId: "L1", state: "proposed" });
  assert.deepEqual(await picks.callFields({ learnerId: "L1", workflow: w.id, role: "controller" }), { __learnerChoice: "deepseek", __allowedModels: ["claude-sonnet", "deepseek"] }, "no pick on the workflow: the learner's latest");
  await picks.saveWorkflowPick({ learnerId: "L1", workflowId: w.id, modelId: "claude-sonnet" });
  assert.equal((await picks.callFields({ learnerId: "L1", workflow: w.id, role: "persona" })).__learnerChoice, "claude-sonnet", "the workflow's own pick wins");
  for (const role of ["assessor", "evidence"]) assert.deepEqual(await picks.callFields({ learnerId: "L1", workflow: w.id, role }), {}, `${role} stays locked`);
  const off = makeModelPicks({ threads, engine, registry, env: { ...env, AI_MODEL_PICKER_ENABLED: "false" }, tiersFor: async () => ({ allowedModels: [] }) });
  assert.deepEqual(await off.callFields({ learnerId: "L1", workflow: w.id }), {}, "picker off: no pick");
  const lockedEnv = makeModelPicks({ threads, engine, registry, env: { ...env, AI_MODEL_LOCKED_ROLES: "persona" }, tiersFor: async () => ({ allowedModels: [] }) });
  assert.deepEqual(await lockedEnv.callFields({ learnerId: "L1", workflow: w.id, role: "persona" }), {}, "a role locked by env stays locked");
  assert.deepEqual(await picks.callFields({ learnerId: "L9", role: "controller" }), {}, "no pick at all: nothing to carry");
});

test("a workflow pick on another learner's workflow does nothing", async () => {
  const { engine, picks } = setup();
  const { instance: w } = await engine.create({ workflowType: "study_prep", learnerId: "L1" });
  assert.equal(await picks.saveWorkflowPick({ learnerId: "L2", workflowId: w.id, modelId: "claude-sonnet" }), null);
  assert.deepEqual((await engine.get(w.id)).model_selection, {});
});
