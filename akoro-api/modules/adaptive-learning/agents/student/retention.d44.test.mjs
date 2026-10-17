// D44: the protégé's forgetting curve — per concept, slow, never compounding,
// with each topic's health derived from its concepts.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";
delete process.env.REDIS_URL;

const R = await import("./retention.js");
const { default: db } = await import("../../../../db.js");
const { installFakeDb } = await import("../../../../lib/testing/fakeDb.mjs");
const { decayEngine } = await import("./decayEngine.js");

const DAY = 86_400_000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const A = "a0000000-0000-4000-8000-000000000001";
const S = "50000000-0000-4000-8000-000000000001";
const row = (subtopic, { learned = 0.85, days = 0, stability = 45, topic = "Cells", subject = "Biology", priority = "low" } = {}) => ({
  id: `${topic}-${subtopic || "topic"}`, agent_id: A, student_id: S, topic, subject, subtopic,
  confidence: learned, learned_confidence: learned, learned_at: ago(days), last_seen_at: ago(days), stability_days: stability, priority, times_seen: 1,
});

test("slow: a concept learned at 0.85 is medium after ~1 week, high after ~3, critical after ~6", () => {
  const at = (d) => R.retainedConfidence({ learned: 0.85, daysSince: d });
  assert.ok(at(0) === 0.85);
  assert.ok(at(7) > 0.72 - 0.01 && at(7) < 0.76, `7d ${at(7)}`);
  assert.ok(at(20) > 0.52 && at(20) < 0.58, `20d ${at(20)}`);
  assert.ok(at(40) > 0.33 && at(40) < 0.37, `40d ${at(40)}`);
  for (let d = 1; d < 120; d++) assert.ok(at(d) <= at(d - 1), "never rises with time");
  assert.ok(R.retainedConfidence({ learned: 0.9, daysSince: 9999 }) >= R.RETENTION.floor);
});

test("good reviews make a concept fade more slowly; poor ones faster", () => {
  const good = R.afterReview({ current: 0.4, stabilityDays: 45, outcome: "correct" });
  assert.equal(good.stabilityDays, 90);
  assert.ok(Math.abs(good.learned - 0.6) < 1e-9);
  assert.ok(R.afterReview({ current: 0.4, stabilityDays: 45, outcome: "partial" }).stabilityDays > 45);
  assert.ok(R.afterReview({ current: 0.4, stabilityDays: 45, outcome: "incorrect" }).stabilityDays < 45);
  assert.equal(R.afterReview({ current: 0.4, stabilityDays: 300, outcome: "correct" }).stabilityDays, R.RETENTION.maxStabilityDays);
  assert.equal(R.afterReview({ current: 0.4, stabilityDays: 8, outcome: "incorrect" }).stabilityDays, R.RETENTION.minStabilityDays);
  const after = R.retainedConfidence({ learned: 0.6, daysSince: 30, stabilityDays: 90 });
  const before = R.retainedConfidence({ learned: 0.6, daysSince: 30, stabilityDays: 45 });
  assert.ok(after > before);
});

test("outcomes from a session's evidence: verified → correct, worked on → partial, not reached → none", () => {
  assert.equal(R.outcomeForEvidence({ masteryStatus: "verified" }), "correct");
  assert.equal(R.outcomeForEvidence({ masteryStatus: "developing", attempts: 1 }), "partial");
  assert.equal(R.outcomeForEvidence({ masteryStatus: "introduced", attempts: 2 }), "partial");
  assert.equal(R.outcomeForEvidence({ masteryStatus: "introduced", attempts: 0 }), null);
  assert.equal(R.outcomeForScore(0.8), "correct");
  assert.equal(R.outcomeForScore(0.5), "partial");
  assert.equal(R.outcomeForScore(0.1), "incorrect");
});

test("a topic's health comes from its concepts; one faded concept doesn't drag the rest", () => {
  const h = R.topicHealth([
    { subtopic: "Cell wall", confidence: 0.30, priority: "critical" },
    { subtopic: "Nucleus", confidence: 0.80, priority: "low" },
    { subtopic: "Mitochondria", confidence: 0.75, priority: "low" },
  ]);
  assert.ok(Math.abs(h.confidence - (0.30 + 0.80 + 0.75) / 3) < 1e-9);
  assert.equal(h.priority, "critical");
  assert.deepEqual(h.faded.map((c) => c.concept), ["Cell wall"]);
  assert.deepEqual(h.concepts.map((c) => c.concept), ["Cell wall", "Mitochondria", "Nucleus"]);
  assert.equal(R.topicHealth([]).confidence, null);
});

function fake(t, rows, extra = {}) {
  // Column defaults the real tables have.
  const f = installFakeDb(db, { "edu.agent_knowledge": rows, ...extra }, { defaults: { "edu.decay_notifications": { is_read: false, is_actioned: false } } });
  t.after(() => f.restore());
  return f;
}

test("nightly decay is per concept and idempotent — running it twice doesn't decay twice", async (t) => {
  const f = fake(t, [row("Cell wall", { days: 40 }), row("Nucleus", { days: 2 }), row("Mitochondria", { days: 3 })]);
  const first = await decayEngine.applyDecay(A);
  const snapshot = f.rows("edu.agent_knowledge").map((r) => [r.subtopic, r.confidence]);
  const second = await decayEngine.applyDecay(A);
  assert.deepEqual(f.rows("edu.agent_knowledge").map((r) => [r.subtopic, r.confidence]), snapshot, "no compounding");
  const cellWall = f.rows("edu.agent_knowledge").find((r) => r.subtopic === "Cell wall");
  const nucleus = f.rows("edu.agent_knowledge").find((r) => r.subtopic === "Nucleus");
  assert.ok(cellWall.confidence < 0.37 && nucleus.confidence > 0.8, "each concept on its own curve");
  assert.equal(first.length, 1, "one entry for the topic");
  assert.equal(first[0].topic, "Cells");
  assert.deepEqual(first[0].concepts.map((c) => c.concept), ["Cell wall"]);
  assert.ok(first[0].confidence > cellWall.confidence, "topic health is the mean, not the weakest");
  // Nothing changed on the second run, so nothing is reported again.
  assert.deepEqual(second, []);
});

test("one alert per topic naming the faded concepts; not repeated while it's open", async (t) => {
  const f = fake(t, [row("Cell wall", { days: 40 }), row("Osmosis", { days: 45 }), row("Nucleus", { days: 1 })], { "edu.decay_notifications": [], notifications: [], "edu.decay_events": [] });
  const groups = await decayEngine.applyDecay(A);
  assert.equal(await decayEngine.sendDecayAlert(null, S, A, groups), 1);
  const [n] = f.rows("edu.decay_notifications");
  assert.deepEqual(n.concepts.map((c) => c.concept).sort(), ["Cell wall", "Osmosis"]);
  assert.match(n.message, /forgetting (Cell wall, Osmosis|Osmosis, Cell wall) in Biology — Cells/);
  assert.doesNotMatch(n.message, /[\u{1F300}-\u{1FAFF}☀-➿]/u, "no emoji");
  assert.equal(await decayEngine.sendDecayAlert(null, S, A, groups), 0, "still open → not alerted again");
  assert.equal(f.rows("edu.decay_notifications").length, 1);
});

test("a review session teaches the faded concepts first, with no model call", async (t) => {
  fake(t, [row("Cell wall", { days: 40 }), row("Nucleus", { days: 1 }), row("Osmosis", { days: 25 })]);
  await decayEngine.applyDecay(A);
  const s = await decayEngine.generateDecaySession(A, S, "biology", "cells");
  assert.deepEqual(s.mustKnowParts, ["Cell wall", "Osmosis", "Nucleus"], "weakest first, no LLM fallback");
  assert.deepEqual(s.fadedConcepts.map((c) => c.concept), ["Cell wall"].concat(s.fadedConcepts.length > 1 ? ["Osmosis"] : []));
  assert.ok(s.confidence > 0.3 && s.confidence < 0.8, "the topic mean");
  assert.equal(s.subject, "biology");
});

test("reinforcement is per concept: only what the review reached moves up and slows down", async (t) => {
  const f = fake(t, [row("Cell wall", { days: 40, learned: 0.85 }), row("Nucleus", { days: 1 }), row("Osmosis", { days: 25 })], { "edu.decay_events": [] });
  await decayEngine.applyDecay(A);
  const before = Object.fromEntries(f.rows("edu.agent_knowledge").map((r) => [r.subtopic, { c: r.confidence, s: r.stability_days }]));
  const out = await decayEngine.reinforceKnowledge(A, S, "Biology", "Cells", 0.5, "sess-1", { conceptOutcomes: { "cell wall": "correct", Osmosis: "partial" } });
  const now = Object.fromEntries(f.rows("edu.agent_knowledge").map((r) => [r.subtopic, { c: r.confidence, s: r.stability_days, learned: r.learned_confidence }]));
  assert.equal(now["Cell wall"].s, before["Cell wall"].s * 2);
  assert.ok(now["Cell wall"].c > before["Cell wall"].c);
  assert.equal(now["Cell wall"].learned, now["Cell wall"].c, "the curve restarts from the reviewed value");
  assert.ok(now.Osmosis.s > before.Osmosis.s && now.Osmosis.s < before.Osmosis.s * 2);
  assert.deepEqual(now.Nucleus, { ...now.Nucleus, c: before.Nucleus.c, s: before.Nucleus.s }, "not reached → untouched");
  assert.deepEqual(out.concepts.map((c) => c.concept).sort(), ["Cell wall", "Osmosis"]);
  // Without concept outcomes the session score applies to every concept.
  const all = await decayEngine.reinforceKnowledge(A, S, "Biology", "Cells", 0.9, "sess-2");
  assert.equal(all.concepts.length, 3);
});

test("teaching files knowledge under the lesson topic and the concept being taught", () => {
  const tools = readFileSync(new URL("../../teaching-workflow/tools.js", import.meta.url), "utf8");
  assert.match(tools, /activeConcept\(context\),\s+\/\/ the concept this turn taught \(D44\)/);
  const agent = readFileSync(new URL("./agent.js", import.meta.url), "utf8");
  assert.match(agent, /topic:      lessonTopic,\s+subtopic:   lessonConcept,/);
  const knowledge = readFileSync(new URL("./knowledge.js", import.meta.url), "utf8");
  assert.match(knowledge, /afterReteach\(/);
  assert.match(knowledge, /learned_confidence: newConf,/);
  const orch = readFileSync(new URL("./orchestrator.js", import.meta.url), "utf8");
  assert.match(orch, /conceptOutcomes: Object\.keys\(conceptOutcomes\)\.length \? conceptOutcomes : null/);
});
