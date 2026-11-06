import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
const { refusalFor, struggleEffects, recordStruggle } = await import("./struggles.js");
const { STRUGGLE_TYPES, DETECTED_BY } = await import("./struggleTypes.js");
const read = (f) => readFile(new URL(f, import.meta.url), "utf8");

test("every struggle type says who may detect it; health_energy only from the learner", () => {
  for (const id of Object.keys(STRUGGLE_TYPES)) assert.ok(DETECTED_BY[id]?.length, `${id} has detectors`);
  assert.deepEqual(DETECTED_BY.health_energy, ["learner"]);
});

test("refusals: unknown type, a detector the type doesn't allow, an agent without evidence", () => {
  assert.equal(refusalFor({ type: "made_up", detectedBy: "rule" }), "unknown_type");
  assert.equal(refusalFor({ type: "health_energy", detectedBy: "agent", observation: "seems tired today in the session" }), "detector_not_allowed");
  assert.equal(refusalFor({ type: "misconception", detectedBy: "rule", evidenceRefs: ["s/t"] }), null);
  const agentOk = Object.keys(DETECTED_BY).find((k) => DETECTED_BY[k].includes("agent"));
  assert.equal(refusalFor({ type: agentOk, detectedBy: "agent", observation: "short" }), "no_cited_evidence");
  assert.equal(refusalFor({ type: agentOk, detectedBy: "agent", evidenceRefs: ["chat:1/2"] }), null);
});

test("effects: misconception found opens, cleared resolves; decay only from recall", () => {
  assert.deepEqual(struggleEffects({ kind: "misconception_detected", source: "teaching" }), [{ action: "open", type: "misconception" }]);
  assert.deepEqual(struggleEffects({ kind: "misconception_cleared", source: "teaching" }), [{ action: "resolve", type: "misconception" }]);
  assert.deepEqual(struggleEffects({ kind: "recall_gap", source: "learner_recall" }), [{ action: "open", type: "decay" }]);
  assert.deepEqual(struggleEffects({ kind: "recall_success", source: "teaching", sessionRef: "decay:1" }), [{ action: "resolve", type: "decay" }]);
  assert.deepEqual(struggleEffects({ kind: "recall_gap", source: "teaching", sessionRef: "teaching:1" }), []);
  assert.deepEqual(struggleEffects({ kind: "demonstrated_understanding", source: "teaching" }), []);
});

test("recordStruggle refuses before touching the database", async () => {
  assert.deepEqual(await recordStruggle({ type: "misconception", detectedBy: "rule" }), { status: "refused", reason: "no_learner" });
  assert.deepEqual(await recordStruggle({ learnerId: "u", type: "health_energy", detectedBy: "rule" }), { status: "refused", reason: "detector_not_allowed" });
});

test("wiring: the recorder runs struggle detection after a write; sensitive rows keep no words", async () => {
  const [rec, src, sql, manifest] = await Promise.all([read("./learning-events.js"), read("./struggles.js"),
    read("../../migrations/2026-learning-struggles.sql"), read("../../migrations/manifest.json")]);
  assert.match(rec, /afterLearningEvent\(event\)/);
  assert.match(src, /struggle_summary: def\.sensitive \? null/);
  assert.match(src, /what_worked: row\.sensitive \? null/);
  assert.match(sql, /CREATE UNIQUE INDEX/i);
  assert.match(manifest, /2026-learning-struggles\.sql/);
});
