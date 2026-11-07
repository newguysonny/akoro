// recommendStrategies (Phase 4a, §7.7, §7.15.3): own outcomes first, then the
// anonymous population for the struggle type, minus exhausted strategies;
// limits.maxUsesPerTopic enforced.
import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
const { default: db } = await import("../../../db.js");
const { installFakeDb } = await import("../../../lib/testing/fakeDb.mjs");
const { rankStrategies, strategyLimitRefusal, topicUses, recommendStrategies, checkStrategyLimit, candidatesFor, POPULATION_MIN_LEARNERS } = await import("./recommend.js");
const { getStrategy } = await import("./library.js");

const C = "11111111-1111-4111-8111-111111111111";
const row = (strategy_id, outcome, extra = {}) => ({ learner_id: "me", strategy_id, outcome, workflow: "study_prep", concept_id: null, topic_label: "Other", session_ref: `s-${Math.random()}`, details: {}, created_at: "2026-11-01T00:00:00Z", ...extra });

test("candidates: a struggle type's strategies in this workflow, else the workflow's; library order", () => {
  assert.deepEqual(candidatesFor({ struggleTypes: ["interference"], workflow: "study_prep" }), ["interleave", "peer_help", "contrast_pairs"]);
  assert.ok(!candidatesFor({ struggleTypes: ["interference"], workflow: "teaching", executor: "teaching" }).includes("interleave"));
  assert.ok(candidatesFor({ struggleTypes: [], workflow: "teaching", executor: "teaching" }).every((id) => getStrategy(id).runsAs.executor === "teaching"));
});

test("ranking: the learner's own outcomes first — worked > untried > failed elsewhere", () => {
  const own = [row("contrast_pairs", "worked"), row("interleave", "did_not_work")];
  const { ranked, exhausted } = rankStrategies({ candidates: ["interleave", "peer_help", "contrast_pairs"], own, topic: "Evaporation", workflow: "study_prep", struggleTypes: ["interference"] });
  assert.deepEqual(ranked.map((r) => r.id), ["contrast_pairs", "peer_help", "interleave"]);
  assert.deepEqual(exhausted, []);
  assert.ok(ranked[0].reasons.includes("worked_for_you") && ranked[0].reasons.includes("targets_struggle"));
  assert.ok(ranked[1].reasons.includes("untried_by_you"));
});

test("ranking: then the population for the struggle type — only from enough learners (D36)", () => {
  const many = Array.from({ length: POPULATION_MIN_LEARNERS }, (_, i) => row("contrast_pairs", "worked", { learner_id: `p${i}`, struggle_type: "interference" }));
  const few = Array.from({ length: POPULATION_MIN_LEARNERS - 1 }, (_, i) => row("peer_help", "worked", { learner_id: `q${i}`, struggle_type: "interference" }));
  const { ranked } = rankStrategies({ candidates: ["interleave", "peer_help", "contrast_pairs"], population: [...many, ...few], struggleTypes: ["interference"] });
  assert.equal(ranked[0].id, "contrast_pairs");
  assert.equal(ranked[0].populationRate, 1);
  assert.equal(ranked.find((r) => r.id === "peer_help").populationRate, null, "four learners are not a pattern");
  // Own beats population.
  const { ranked: mine } = rankStrategies({ candidates: ["interleave", "contrast_pairs"], own: [row("interleave", "worked")], population: many });
  assert.equal(mine[0].id, "interleave");
});

test("exhausted: used up on this topic, or last judged did_not_work here in this workflow", () => {
  const limit = getStrategy("contrast_pairs").limits.maxUsesPerTopic;
  const used = Array.from({ length: limit }, (_, i) => row("contrast_pairs", "partial", { concept_id: C, session_ref: `t${i}`, workflow: "teaching" }));
  const failed = [row("interleave", "did_not_work", { topic_label: "evaporation" })];
  const { ranked, exhausted } = rankStrategies({ candidates: ["interleave", "peer_help", "contrast_pairs"], own: [...used, ...failed], conceptId: C, topic: "Evaporation", workflow: "study_prep" });
  assert.deepEqual(ranked.map((r) => r.id), ["peer_help"]);
  assert.deepEqual(exhausted.map((e) => [e.id, e.reason]), [["interleave", "failed_here"], ["contrast_pairs", "limit_reached"]]);
  // A failure in another workflow does not exhaust it here.
  const other = rankStrategies({ candidates: ["interleave"], own: [row("interleave", "did_not_work", { topic_label: "Evaporation", workflow: "practice" })], topic: "Evaporation", workflow: "study_prep" });
  assert.equal(other.ranked.length, 1);
});

test("limit: uses are distinct sessions (Teaching) or accepted offers (Study Prep); a pending one counts", () => {
  const twoRowsOneSession = [row("prerequisite_review", "worked", { concept_id: C, session_ref: "teaching:1" }), row("prerequisite_review", "did_not_work", { concept_id: C, session_ref: "teaching:1" })];
  assert.equal(topicUses({ strategyId: "prerequisite_review", ownRows: twoRowsOneSession, conceptId: C }).usesOnTopic, 1);
  assert.equal(strategyLimitRefusal({ strategyId: "prerequisite_review", ownRows: twoRowsOneSession, conceptId: C }), "strategy_limit_reached", "maxUsesPerTopic 1");
  const pending = [row("teach_back", "abandoned", { topic_label: "Osmosis", session_ref: "study_prep:s", details: { pending: true, use: "study_prep:s#1" } }),
    row("teach_back", "abandoned", { topic_label: "Osmosis", session_ref: "study_prep:s", details: { pending: true, use: "study_prep:s#2" } })];
  assert.equal(topicUses({ strategyId: "teach_back", ownRows: pending, topic: "osmosis" }).usesOnTopic, 2);
  assert.equal(strategyLimitRefusal({ strategyId: "teach_back", ownRows: pending, topic: "Osmosis" }), null, "teach_back allows 3");
  assert.equal(strategyLimitRefusal({ strategyId: "teach_back", ownRows: pending, topic: "Diffusion" }), null, "another topic");
});

test("recommendStrategies reads the learner's outcomes, the population and open struggles (fake db)", async (t) => {
  const fake = installFakeDb(db, {
    "edu.concept_catalog": [{ id: C, status: "approved", subject: "Basic Science", topic_key: "evaporation", title: "Evaporation" }],
    "edu.learning_struggles": [{ learner_id: "me", status: "open", struggle_type: "interference", concept_id: C }],
    "edu.learning_strategy_outcomes": [
      row("interleave", "did_not_work", { concept_id: C, workflow: "study_prep" }),
      ...Array.from({ length: 5 }, (_, i) => row("contrast_pairs", "worked", { learner_id: `p${i}`, struggle_type: "interference" })),
    ],
  });
  t.after(() => fake.restore());
  const r = await recommendStrategies({ learnerId: "me", subject: "Basic Science", topic: "Evaporation", workflow: "study_prep" });
  assert.deepEqual(r.struggleTypes, ["interference"]);
  assert.equal(r.conceptId, C);
  assert.deepEqual(r.ranked.map((s) => s.id), ["contrast_pairs", "peer_help"]);
  assert.deepEqual(r.exhausted.map((e) => e.id), ["interleave"]);
  const limit = await checkStrategyLimit({ learnerId: "me", strategyId: "interleave", conceptId: C });
  assert.equal(limit.usesOnTopic, 1);
  assert.equal(limit.refusal, null, "interleave allows 2");
});

test("recommendStrategies never throws: a read failure gives the library order, degraded", async (t) => {
  const fake = installFakeDb(db, {});
  t.after(() => fake.restore());
  fake.failNext("edu.learning_struggles", "select", { message: "down" });
  const r = await recommendStrategies({ learnerId: "me", conceptId: C, workflow: "teaching", executor: "teaching" });
  assert.equal(r.degraded, true);
  assert.ok(r.ranked.length > 3);
  assert.equal((await checkStrategyLimit({ learnerId: null, strategyId: "teach_back" })).refusal, null);
});
