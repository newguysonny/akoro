import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
const { evidenceShape, recordLearningEvent, LEARNING_SOURCES } = await import("./learning-events.js");
const read = (f) => readFile(new URL(f, import.meta.url), "utf8");

test("evidence shape: a gap or misconception contradicts; the rest supports; the source sets the weight", () => {
  assert.equal(evidenceShape({ kind: "misconception_detected", source: "teaching" }).claim_status, "contradicted");
  assert.equal(evidenceShape({ kind: "recall_gap", source: "learner_recall" }).claim_status, "contradicted");
  assert.equal(evidenceShape({ kind: "misconception_cleared", source: "teaching" }).claim_status, "supported");
  assert.equal(evidenceShape({ kind: "assessment_result", source: "agent_recall", checked: false }).claim_status, "not_checked");
  assert.ok(evidenceShape({ kind: "recall_success", source: "chat" }).model_confidence < evidenceShape({ kind: "recall_success", source: "proctored" }).model_confidence, "a chat remark counts less than a proctored result");
  assert.equal(evidenceShape({ kind: "recall_success", source: "teaching", quality: 7 }).response_quality, 1, "clamped");
});

test("the recorder refuses what it can't stand behind (never throws)", async () => {
  const base = { learnerId: "u", kind: "recall_gap", source: "teaching", sessionRef: "s", turnRef: "t", conceptId: "c" };
  assert.deepEqual(await recordLearningEvent({ ...base, source: "guess" }), { recorded: false, reason: "unknown_source" });
  assert.deepEqual(await recordLearningEvent({ ...base, kind: "felt_sad" }), { recorded: false, reason: "unknown_kind" });
  assert.deepEqual(await recordLearningEvent({ ...base, learnerId: null }), { recorded: false, reason: "no_learner" });
  assert.deepEqual(await recordLearningEvent({ ...base, turnRef: null }), { recorded: false, reason: "no_reference" });
  assert.ok(LEARNING_SOURCES.includes("proctored") && LEARNING_SOURCES.includes("learner_recall"));
});

test("wiring: Teaching, Study Prep, Practice and Decay Review all record through the one recorder", async () => {
  const [tools, store, practice, decay] = await Promise.all([
    read("./teaching-workflow/tools.js"), read("./study-prep/store.js"), read("./practice/service.js"), read("./decay-review/service.js"),
  ]);
  assert.match(tools, /void recordTeachingEvidence\(orchestrator, context\);/);
  assert.match(tools, /kinds\.push\("misconception_detected"\)/);
  assert.match(tools, /update\.misconceptionRepaired\) kinds\.push\("misconception_cleared"\)/);
  assert.match(store, /await recordLearningEvent\(\{/);
  assert.doesNotMatch(store, /from\("learner_concept_evidence"\)\.upsert/, "no direct evidence writes left in Study Prep");
  assert.match(practice, /source: "proctored_assessment"/);
  assert.match(decay, /void recordDecayEvidence\(/);
});

test("no approved concept: nothing enters the learner model, but a waiting strategy is still judged by the attempt", async () => {
  const src = await read("./learning-events.js");
  const i = src.indexOf("if (!concept) {");
  assert.ok(i > 0 && src.indexOf("settlePendingStrategyOutcomes", i) > i && src.indexOf("record_learner_concept_evidence", i) > src.indexOf("settlePendingStrategyOutcomes", i));
  assert.match(src, /reason: "no_approved_concept"/);
});
