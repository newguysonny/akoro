// Seam tests for the learner model's read side (Phase 10) over the fake db:
// misconception flags and the engine's recommendation come from the central
// learner_concept_state, matched the way the recorder matches concepts.
import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";

const { default: db } = await import("../../db.js");
const { installFakeDb } = await import("../../lib/testing/fakeDb.mjs");
const { centralMisconceptionFlags, recommendForLearner, readConceptStates } = await import("./learner-model.js");

const L = "learner-1";
const catalog = [
  { id: "c-osm", status: "approved", subject: "Biology", topic_key: "osmosis", title: "Osmosis" },
  { id: "c-dif", status: "approved", subject: "Biology", topic_key: "diffusion", title: "Diffusion" },
  { id: "c-trn", status: "approved", subject: "Biology", topic_key: "transport-in-cells", title: "Transport in cells" },
  { id: "c-old", status: "retired", subject: "Biology", topic_key: "active-transport", title: "Active transport" },
];

function fakeFor(t, seed) {
  const fake = installFakeDb(db, seed);
  t.after(() => fake.restore());
  return fake;
}

test("flags per must-know part: part concept first, then the lesson topic; null where the model has nothing", async (t) => {
  fakeFor(t, {
    "edu.concept_catalog": catalog,
    "edu.learner_concept_state": [
      { learner_id: L, concept_id: "c-osm", mastery: 0.2, misconception_active: true },
      { learner_id: L, concept_id: "c-dif", mastery: 0.6, misconception_active: false },
      { learner_id: L, concept_id: "c-trn", mastery: 0.4, misconception_active: true },
      { learner_id: "someone-else", concept_id: "c-dif", mastery: 0.1, misconception_active: true },
    ],
  });
  const flags = await centralMisconceptionFlags({
    learnerId: L, subject: "Biology", topic: "Transport in cells",
    parts: ["Osmosis", "Diffusion", "Active transport", ""],
  });
  // Active transport is retired (never matched) → falls back to the lesson topic's concept.
  assert.deepEqual(flags, [true, false, true, true]);
});

test("no learner, no parts, or the model unavailable → no central answer (never throws)", async (t) => {
  const fake = fakeFor(t, { "edu.concept_catalog": catalog, "edu.learner_concept_state": [] });
  assert.deepEqual(await centralMisconceptionFlags({ learnerId: null, parts: ["Osmosis"] }), [null]);
  assert.deepEqual(await centralMisconceptionFlags({ learnerId: L, subject: "Biology", parts: ["Osmosis"] }), [null], "no state row yet");
  fake.failNext("edu.learner_concept_state", "select", { message: "down" });
  assert.equal((await readConceptStates({ learnerId: L, conceptIds: ["c-osm"] })).size, 0);
});

test("recommendForLearner: the engine decides from the central state", async (t) => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  fakeFor(t, {
    "edu.learner_concept_state": [
      { learner_id: L, concept_id: "c-osm", mastery: 0.8, misconception_active: true, last_evidence_at: "2026-11-06T11:00:00Z" },
      { learner_id: L, concept_id: "c-dif", mastery: 0.8, misconception_active: false, last_evidence_at: "2026-11-06T11:00:00Z" },
    ],
  });
  const a = await recommendForLearner({ learnerId: L, conceptId: "c-osm", now });
  assert.deepEqual({ action: a.action, reason: a.reason, source: a.source, misconceptionActive: a.misconceptionActive }, { action: "CLEAR_MISTAKE", reason: "misconception_active", source: "learner_model", misconceptionActive: true });
  const b = await recommendForLearner({ learnerId: L, conceptId: "c-dif", now });
  assert.equal(b.action, "NAME_IT");
  const c = await recommendForLearner({ learnerId: L, conceptId: "c-new", now });
  assert.deepEqual({ action: c.action, reason: c.reason, hasState: c.hasState }, { action: "DIG_DEEPER", reason: "no_history", hasState: false });
});
