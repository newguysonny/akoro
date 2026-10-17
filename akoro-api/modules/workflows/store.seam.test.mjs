// The engine over the REAL store code (makeSupabaseWorkflowStore) on the
// in-memory fake db: the same behaviour as the memory store — idempotent
// create on the unique key, CAS on state, ordered event sequences.
import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";

const { default: db } = await import("../../db.js");
const { installFakeDb } = await import("../../lib/testing/fakeDb.mjs");
const { makeSupabaseWorkflowStore } = await import("./store.js");
const { createWorkflowEngine } = await import("./engine.js");
const { studyPrepWorkflow } = await import("../adaptive-learning/study-prep/workflow.js");

const L = "11111111-1111-4111-8111-111111111111";
const setup = (t) => {
  const fake = installFakeDb(db, {}, { unique: { "edu.workflow_instances": [["learner_id", "workflow_type", "idempotency_key"]], "edu.workflow_events": [["workflow_id", "sequence"]] } });
  t.after(() => fake.restore());
  return { fake, engine: createWorkflowEngine({ store: makeSupabaseWorkflowStore(db), definitionOf: (type) => (type === "study_prep" ? studyPrepWorkflow : null) }) };
};

test("a Study Prep run through the real store: create once, move by CAS, list open runs", async (t) => {
  const { fake, engine } = setup(t);
  const a = await engine.create({ workflowType: "study_prep", learnerId: L, idempotencyKey: "study_prep:s1" });
  const b = await engine.create({ workflowType: "study_prep", learnerId: L, idempotencyKey: "study_prep:s1" });
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(fake.rows("edu.workflow_instances").length, 1);
  assert.equal(a.instance.status, "active");

  const id = a.instance.id;
  assert.equal((await engine.transition(id, { from: "planning", to: "awaiting_confirmation" })).status, "waiting_learner");
  assert.equal(await engine.transition(id, { from: "planning", to: "awaiting_confirmation" }), null, "stale");
  await assert.rejects(() => engine.transition(id, { from: "awaiting_confirmation", to: "completed" }), (e) => e.code === "invalid_state_transition");
  assert.equal((await engine.listForLearner(L, { active: true })).length, 1);
  await engine.cancel(id);
  assert.equal((await engine.listForLearner(L, { active: true })).length, 0);
  assert.equal((await engine.listForLearner(L)).length, 1);
});

test("events get 0, 1, 2… per run through the real store", async (t) => {
  const { engine } = setup(t);
  const { instance } = await engine.create({ workflowType: "study_prep", learnerId: L });
  for (let i = 0; i < 3; i++) await engine.appendEvent(instance.id, { event_type: "observation", payload: { i } });
  assert.deepEqual((await engine.events(instance.id)).map((e) => e.sequence), [0, 1, 2]);
});
