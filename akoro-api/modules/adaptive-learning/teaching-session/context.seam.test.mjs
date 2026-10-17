// Seam tests for teaching-session/context.js against the in-memory db fake:
// continuation / decay context loading, ownership filtering and carry-forward.
import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";

const { default: db } = await import("../../../db.js");
const { installFakeDb } = await import("../../../lib/testing/fakeDb.mjs");
const { carryForward, CARRY_BLOCK_CAP, loadContinuationContext, loadDecayPriorLesson } = await import("./context.js");

const T = "edu.adaptive_sessions";
const DAY = 86_400_000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();
const quiet = () => { const w = console.warn; console.warn = () => {}; return () => { console.warn = w; }; };

test("carryForward: no prior → opening blocks unchanged (same reference)", () => {
  const opening = [{ type: "agent", text: "hi" }];
  assert.equal(carryForward([], opening), opening);
  assert.equal(carryForward(null, opening), opening);
  assert.equal(carryForward("junk", opening), opening);
});

test("carryForward: drops dividers and non-objects, fades the prior, keeps opening blocks last", () => {
  const prior = [{ type: "system-divider", label: "Prev" }, null, "x", { type: "user", text: "a" }, { type: "agent", text: "b", faded: false }];
  const out = carryForward(prior, [{ type: "agent", text: "new" }]);
  assert.deepEqual(out, [
    { type: "user", text: "a", faded: true },
    { type: "agent", text: "b", faded: true },
    { type: "agent", text: "new" },
  ]);
  assert.equal(prior[4].faded, false, "input blocks are not mutated");
});

test("carryForward: keeps only the newest CARRY_BLOCK_CAP prior blocks so chains stay bounded", () => {
  assert.equal(CARRY_BLOCK_CAP, 80);
  const prior = Array.from({ length: 200 }, (_, i) => ({ type: "user", text: `m${i}` }));
  const out = carryForward(prior, [{ type: "agent", text: "open" }]);
  assert.equal(out.length, 81);
  assert.equal(out[0].text, "m120");
  assert.equal(out[79].text, "m199");
  assert.equal(out[80].text, "open");
  // Continuing a continuation never grows past the cap.
  const again = carryForward(out, [{ type: "agent", text: "open2" }]);
  assert.equal(again.length, 81);
});

test("loadContinuationContext: loads transcript, resume position and evidence for the owner", async () => {
  const blocks = [{ type: "user", text: "q" }, { type: "agent", text: "a" }];
  const evidence = { policyVersion: "teaching-evidence-v1", concepts: [] };
  const fake = installFakeDb(db, {
    [T]: [{ id: "s-1", student_id: "learner-1", block_history: blocks, completed_at: daysAgo(3), updated_at: daysAgo(1), current_subtopic_idx: 2, current_phase: "3", teaching_evidence: evidence }],
  });
  const ctx = await loadContinuationContext({ studentId: "learner-1", prevSessionId: "s-1" });
  assert.deepEqual(ctx.resumeFrom, { subtopicIdx: 2, phase: "PHASE_3" });
  assert.deepEqual(ctx.resumeTeachingEvidence, evidence);
  assert.deepEqual(ctx.priorBlocks, blocks, "raw blocks become agent memory");
  assert.deepEqual(ctx.historyBlocks, [
    { type: "system-divider", label: "Previous session · 3 days ago" },
    { type: "user", text: "q", faded: true },
    { type: "agent", text: "a", faded: true },
  ]);
  fake.restore();
});

test("loadContinuationContext: another learner's session id never loads (ownership in the query)", async () => {
  const fake = installFakeDb(db, {
    [T]: [{ id: "s-other", student_id: "learner-2", block_history: [{ type: "user", text: "secret" }], current_phase: "4", current_subtopic_idx: 3, teaching_evidence: { x: 1 } }],
  });
  const ctx = await loadContinuationContext({ studentId: "learner-1", prevSessionId: "s-other" });
  assert.deepEqual(ctx, { historyBlocks: [], priorBlocks: [], resumeFrom: null, resumeTeachingEvidence: null });
  fake.restore();
});

test("loadContinuationContext: MASTERY / PHASE_ prefixes normalise; empty transcript still resumes position", async () => {
  const fake = installFakeDb(db, {
    [T]: [
      { id: "m", student_id: "l", current_phase: "mastery", current_subtopic_idx: "4", block_history: [] },
      { id: "p", student_id: "l", current_phase: "PHASE_2", current_subtopic_idx: null, block_history: null },
    ],
  });
  const m = await loadContinuationContext({ studentId: "l", prevSessionId: "m" });
  assert.deepEqual(m.resumeFrom, { subtopicIdx: 4, phase: "MASTERY" });
  assert.deepEqual(m.historyBlocks, []);
  assert.deepEqual(m.priorBlocks, []);
  assert.equal(m.resumeTeachingEvidence, null);
  const p = await loadContinuationContext({ studentId: "l", prevSessionId: "p" });
  assert.deepEqual(p.resumeFrom, { subtopicIdx: 0, phase: "PHASE_2" });
  fake.restore();
});

test("loadContinuationContext: missing ids short-circuit; missing evidence column retries; other errors degrade to empty", async () => {
  const restore = quiet();
  const fake = installFakeDb(db, { [T]: [{ id: "s-1", student_id: "l", current_phase: "2", block_history: [{ type: "user", text: "x" }] }] });
  const empty = { historyBlocks: [], priorBlocks: [], resumeFrom: null, resumeTeachingEvidence: null };
  assert.deepEqual(await loadContinuationContext({ studentId: "l" }), empty);
  assert.deepEqual(await loadContinuationContext({ prevSessionId: "s-1" }), empty);
  assert.equal(fake.calls.length, 0);

  fake.failNext(T, "select", { code: "42703", message: "column adaptive_sessions.teaching_evidence does not exist" });
  const retried = await loadContinuationContext({ studentId: "l", prevSessionId: "s-1" });
  assert.deepEqual(retried.resumeFrom, { subtopicIdx: 0, phase: "PHASE_2" });
  assert.equal(retried.priorBlocks.length, 1);
  assert.equal(fake.calls.filter((c) => c.op === "select").length, 2);

  // The retry keeps the ownership filter.
  fake.failNext(T, "select", { code: "42703", message: "column adaptive_sessions.teaching_evidence does not exist" });
  assert.deepEqual(await loadContinuationContext({ studentId: "intruder", prevSessionId: "s-1" }), empty);

  fake.failNext(T, "select", { message: "connection reset" });
  assert.deepEqual(await loadContinuationContext({ studentId: "l", prevSessionId: "s-1" }), empty);
  restore();
  fake.restore();
});

test("loadDecayPriorLesson: newest active/complete lesson on the topic (case-insensitive), last 10 blocks, dividers dropped", async () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ type: i % 2 ? "agent" : "user", text: `t${i}` }));
  many.splice(12, 0, { type: "system-divider", label: "x" });
  const fake = installFakeDb(db, {
    [T]: [
      { id: "old", student_id: "l", topic: "Photosynthesis", status: "complete", updated_at: daysAgo(9), completed_at: daysAgo(9), block_history: [{ type: "user", text: "old" }] },
      { id: "new", student_id: "l", topic: "photosynthesis", status: "complete", updated_at: daysAgo(2), completed_at: daysAgo(4), block_history: many },
      { id: "cancel", student_id: "l", topic: "Photosynthesis", status: "cancelled", updated_at: daysAgo(0), block_history: [{ type: "user", text: "cancelled" }] },
      { id: "other-topic", student_id: "l", topic: "Respiration", status: "active", updated_at: daysAgo(0), block_history: [{ type: "user", text: "resp" }] },
    ],
  });
  const ctx = await loadDecayPriorLesson({ studentId: "l", topic: "PHOTOSYNTHESIS" });
  assert.equal(ctx.priorBlocks.length, 10);
  assert.deepEqual(ctx.priorBlocks.map((b) => b.text), ["t5", "t6", "t7", "t8", "t9", "t10", "t11", "t12", "t13", "t14"]);
  assert.ok(ctx.priorBlocks.every((b) => !b.faded), "agent memory is the raw tail");
  assert.deepEqual(ctx.historyBlocks[0], { type: "system-divider", label: "Last lesson · 4 days ago" });
  assert.equal(ctx.historyBlocks.length, 11);
  assert.ok(ctx.historyBlocks.slice(1).every((b) => b.faded === true));
  fake.restore();
});

test("loadDecayPriorLesson: another learner's lesson on the same topic never loads", async () => {
  const fake = installFakeDb(db, {
    [T]: [{ id: "x", student_id: "learner-2", topic: "Photosynthesis", status: "complete", updated_at: daysAgo(1), block_history: [{ type: "user", text: "secret" }] }],
  });
  assert.deepEqual(await loadDecayPriorLesson({ studentId: "learner-1", topic: "Photosynthesis" }), { historyBlocks: [], priorBlocks: [] });
  fake.restore();
});

test("loadDecayPriorLesson: missing inputs, empty history and read errors degrade to empty context", async () => {
  const fake = installFakeDb(db, {
    [T]: [{ id: "e", student_id: "l", topic: "Cells", status: "active", updated_at: daysAgo(1), block_history: [] }],
  });
  const empty = { historyBlocks: [], priorBlocks: [] };
  assert.deepEqual(await loadDecayPriorLesson({ studentId: "l" }), empty);
  assert.deepEqual(await loadDecayPriorLesson({ topic: "Cells" }), empty);
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(await loadDecayPriorLesson({ studentId: "l", topic: "Cells" }), empty);
  fake.failNext(T, "select", { message: "boom" });
  assert.deepEqual(await loadDecayPriorLesson({ studentId: "l", topic: "Cells" }), empty);
  fake.restore();
});
