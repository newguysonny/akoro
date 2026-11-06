import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
const { outcomeRefusal, recordStrategyOutcome, strategyThatWorked } = await import("./outcomes.js");

const ok = { learnerId: "u1", strategyId: "contrast_pairs", outcome: "worked", workflow: "teaching", sessionRef: "teaching:s1" };

test("outcomeRefusal: library strategy, allowed in its workflow, a known outcome, a reference", () => {
  assert.equal(outcomeRefusal(ok), null);
  assert.equal(outcomeRefusal({ ...ok, learnerId: null }), "no_learner");
  assert.equal(outcomeRefusal({ ...ok, strategyId: "socratic" }), "unknown_strategy");
  assert.equal(outcomeRefusal({ ...ok, outcome: "great" }), "unknown_outcome");
  assert.equal(outcomeRefusal({ ...ok, workflow: "battle" }), "unknown_workflow");
  assert.equal(outcomeRefusal({ ...ok, strategyId: "retrieval_practice" }), "strategy_not_permitted", "not a Teaching strategy");
  assert.equal(outcomeRefusal({ ...ok, sessionRef: "  " }), "no_reference");
  assert.equal(outcomeRefusal({ ...ok, struggleType: "laziness" }), "unknown_struggle_type");
  assert.equal(outcomeRefusal({ ...ok, struggleType: "interference" }), null);
  assert.equal(outcomeRefusal({ ...ok, strategyId: "worked_example" }), null, "the pre-v3 name maps to worked_examples");
});

test("recordStrategyOutcome refuses before touching the database, and never throws", async () => {
  assert.deepEqual(await recordStrategyOutcome({ ...ok, strategyId: "drop_the_topic" }), { recorded: false, reason: "unknown_strategy" });
  assert.deepEqual(await recordStrategyOutcome({ ...ok, outcome: "maybe" }), { recorded: false, reason: "unknown_outcome" });
  assert.deepEqual(await recordStrategyOutcome({ ...ok, workflow: "decay_review", strategyId: "self_check" }), { recorded: false, reason: "strategy_not_permitted" });
  assert.deepEqual(await recordStrategyOutcome(), { recorded: false, reason: "no_learner" });
  assert.equal(await strategyThatWorked({ learnerId: null, sessionRef: "x" }), null);
});

test("the write is idempotent and versioned (source contract)", async () => {
  const src = await readFile(new URL("./outcomes.js", import.meta.url), "utf8");
  assert.match(src, /onConflict: "learner_id,session_ref,turn_ref,strategy_id", ignoreDuplicates: true/);
  assert.match(src, /strategy_version: s\.version, library_version: LIBRARY_VERSION/);
  const sql = await readFile(new URL("../../../migrations/2026-strategy-outcomes.sql", import.meta.url), "utf8");
  assert.match(sql, /UNIQUE \(learner_id, session_ref, turn_ref, strategy_id\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS edu\.learning_strategy_outcomes/);
  const manifest = JSON.parse(await readFile(new URL("../../../migrations/manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.schema.includes("2026-strategy-outcomes.sql"));
});

test("a resolved struggle credits the strategy that worked (struggles.afterLearningEvent reads it)", async () => {
  const src = await readFile(new URL("../struggles.js", import.meta.url), "utf8");
  assert.match(src, /event\.details\?\.strategy \|\| await strategyThatWorked\(/);
  assert.match(src, /whatWorkedStrategy: strategy \|\| null/);
});

test("teaching: a repair credits the session's strategy; a switch records the old one as did_not_work", async () => {
  const { currentTeachingStrategy, teachingSessionOutcome } = await import("../teaching-workflow/tools.js");
  assert.equal(currentTeachingStrategy({ session: { strategy: "contrast_pairs" } }), "contrast_pairs");
  assert.equal(currentTeachingStrategy({ session: { strategy: "worked_example" } }), "worked_examples");
  assert.equal(currentTeachingStrategy({ session: {} }), "teach_back", "the learner teaching the agent is teach_back");
  assert.equal(currentTeachingStrategy({ session: { teachingMode: "learn_with_guide" } }), null);
  assert.equal(teachingSessionOutcome({ totalTurns: 0 }), null, "nothing taught: no outcome");
  assert.equal(teachingSessionOutcome({ totalTurns: 5, endedBy: "objective_met" }), "worked");
  const ev = (...statuses) => ({ concepts: statuses.map((m) => ({ attempts: 1, masteryStatus: m })) });
  assert.equal(teachingSessionOutcome({ totalTurns: 5, teachingEvidence: ev("verified", "verified") }), "worked");
  assert.equal(teachingSessionOutcome({ totalTurns: 5, teachingEvidence: ev("verified", "introduced") }), "partial");
  assert.equal(teachingSessionOutcome({ totalTurns: 5, teachingEvidence: ev("introduced") }), "did_not_work");
  const controller = await readFile(new URL("../teaching-session/controller.js", import.meta.url), "utf8");
  assert.match(controller, /outcome: "did_not_work"/);
});
