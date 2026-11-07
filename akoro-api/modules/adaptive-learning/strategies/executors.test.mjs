// Harness execution of the non-Teaching strategies (Phase 4a, §7.7.2): replan,
// schedule and offline export, run by the Study Prep harness when the learner
// accepts an offered strategy; the accepted strategy starts a pending outcome.
import assert from "node:assert/strict";
import test from "node:test";

import { planReorder, positionMoves, chunkParts, buildOfflinePack, orderViolation, executeHarnessStrategy, runStrategyOffer, HARNESS_EXECUTORS } from "./executors.js";
import { STRATEGIES } from "./library.js";

const T = (id, position, status, label = id) => ({ id, position, status, label, syllabus_topic_id: id });
const EDGES = [
  { before: "water", after: "photo", beforeLabel: "Water", afterLabel: "Photo" },
  { before: "cells", after: "photo", beforeLabel: "Cells", afterLabel: "Photo" },
];

/** Apply moves to a copy, enforcing UNIQUE(position) at every step. */
function apply(topics, moves) {
  const rows = topics.map((t) => ({ ...t }));
  for (const m of moves) {
    assert.ok(!rows.some((r) => r.id !== m.id && r.position === m.position), `position ${m.position} taken when moving ${m.id}`);
    rows.find((r) => r.id === m.id).position = m.position;
  }
  return rows.sort((a, b) => a.position - b.position).map((r) => r.id);
}

test("every harness strategy that has a runner is mapped; the rest say why they did not run", () => {
  for (const id of ["interleave", "prerequisite_review", "chunk_plan", "space_out", "schedule_plan", "offline_pack"]) assert.ok(HARNESS_EXECUTORS[id], id);
  for (const id of Object.keys(HARNESS_EXECUTORS)) assert.equal(STRATEGIES.find((s) => s.id === id).runsAs.executor, "harness");
});

test("replan: prerequisite_review brings the active topic's prerequisites forward and names missing ones", () => {
  const topics = [T("photo", 1, "active"), T("matter", 2, "queued"), T("water", 3, "queued")];
  const plan = planReorder({ strategy: "prerequisite_review", topics, edges: EDGES });
  assert.deepEqual(plan.order, ["water", "matter"]);
  assert.deepEqual(plan.moved, ["water", "matter"]);
  assert.deepEqual(plan.missing, ["Cells"], "a prerequisite outside the plan is reported, never invented");
});

test("replan: interleave puts a related topic next; nothing related → the next one stays", () => {
  const topics = [T("water", 1, "active"), T("matter", 2, "queued"), T("energy", 3, "queued"), T("photo", 4, "queued")];
  assert.deepEqual(planReorder({ strategy: "interleave", topics, edges: EDGES }).order, ["photo", "matter", "energy"]);
  const unrelated = planReorder({ strategy: "interleave", topics: [T("energy", 1, "active"), T("matter", 2, "queued")], edges: EDGES });
  assert.deepEqual(unrelated.moved, []);
});

test("replan never writes an order that breaks a prerequisite edge", () => {
  // Moving "photo" next would put it before its prerequisite "cells".
  const topics = [T("water", 1, "active"), T("cells", 2, "queued"), T("matter", 3, "queued"), T("photo", 4, "queued")];
  assert.ok(orderViolation(["water", "photo", "cells"], EDGES));
  assert.equal(orderViolation(["photo", "cells"], EDGES, ["photo", "cells"]), null, "an edge already out of order is not a new break");
  const plan = planReorder({ strategy: "interleave", topics, edges: EDGES });
  assert.equal(plan.reason, "prerequisite_violation");
  assert.deepEqual(plan.order, ["cells", "matter", "photo"], "the queue is left as it was");
});

test("positionMoves: any reorder through one free slot, never two topics on one position", () => {
  const topics = [T("a", 1, "understood"), T("b", 2, "active"), T("c", 3, "queued"), T("d", 4, "queued"), T("e", 5, "queued")];
  for (const order of [["e", "c", "d"], ["d", "e", "c"], ["e", "d", "c"], ["c", "d", "e"]]) {
    const moves = positionMoves({ topics, order });
    assert.deepEqual(apply(topics, moves).slice(2), order, order.join(","));
  }
  assert.deepEqual(positionMoves({ topics, order: ["c", "d", "e"] }), []);
  const full = Array.from({ length: 12 }, (_, i) => T(`t${i}`, i + 1, i ? "queued" : "active"));
  assert.equal(positionMoves({ topics: full, order: ["t2", "t1", ...full.slice(3).map((t) => t.id)] }), null, "no free slot → refused, not forced");
});

test("chunk_plan parts and the offline pack's Markdown", () => {
  assert.deepEqual(chunkParts([T("a", 1, "active"), T("b", 2, "queued"), T("c", 3, "queued"), T("d", 4, "queued")]), [["b", "c"], ["d"]]);
  const md = buildOfflinePack({ subject: "Basic Science", goal: "Pass the term exam", topic: "Evaporation", gaps: ["the difference from boiling"], notes: ["explained heat"], generatedAt: "2026-11-07T10:00:00Z" });
  assert.match(md, /^# Evaporation — Basic Science/);
  assert.match(md, /Explain in your own words: the difference from boiling/);
  assert.match(md, /2026-11-07/);
  assert.doesNotMatch(buildOfflinePack({ topic: "X" }), /undefined/);
});

function deps(over = {}) {
  const calls = { moves: [], followUps: [], files: [], outcomes: [] };
  const topics = over.topics || [];
  return {
    calls,
    store: { updateTopicConditional: async (id, expected, patch) => { calls.moves.push([id, patch.position]); const t = topics.find((x) => x.id === id); if (!t || t.status !== expected) return null; t.position = patch.position; return t; } },
    now: () => "2026-11-07T10:00:00.000Z",
    prerequisites: async () => EDGES,
    scheduleFollowUp: async (input) => { calls.followUps.push(input); return { followUpId: `f${calls.followUps.length}`, scheduledAt: "later", repeat: input.repeat || null }; },
    evidenceNotes: async () => ["explained it"],
    saveFile: async (f) => { calls.files.push(f); return { fileKey: `records/u/${f.name}`, downloadUrl: "https://dl" }; },
    checkLimit: async () => ({ refusal: null, usesOnTopic: 0, limit: 2 }),
    recommend: async () => ({ ranked: [{ id: "interleave", reasons: ["untried_by_you"] }], struggleTypes: ["interference"] }),
    recordOutcome: async (o) => { calls.outcomes.push(o); return { recorded: true, id: "o1" }; },
    ...over,
  };
}
const SESSION = { id: "s1", subject: "Basic Science", goal: "Exam" };

test("executors: schedule (space_out, schedule_plan), offline_pack, chunk_plan, and the ones with no runner", async () => {
  const d = deps();
  const spaced = await executeHarnessStrategy({ strategy: "space_out", learnerId: "u", session: SESSION, topic: { label: "Evaporation" }, topics: [], deps: d });
  assert.deepEqual([spaced.executed, spaced.operation], [true, "schedule"]);
  assert.equal(d.calls.followUps[0].inMinutes, 2 * 24 * 60);
  const plan = await executeHarnessStrategy({ strategy: "schedule_plan", learnerId: "u", session: SESSION, topic: { label: "Evaporation" }, topics: [], deps: d });
  assert.equal(plan.effect.repeat, "daily");
  const pack = await executeHarnessStrategy({ strategy: "offline_pack", learnerId: "u", session: SESSION, topic: { label: "Evaporation", check_result: { gaps: ["boiling"] } }, topics: [], deps: d });
  assert.equal(pack.operation, "offline_export");
  assert.equal(pack.effect.downloadUrl, "https://dl");
  assert.match(d.calls.files[0].body, /boiling/);
  const chunks = await executeHarnessStrategy({ strategy: "chunk_plan", learnerId: "u", session: SESSION, topic: null, topics: [T("a", 1, "active"), T("b", 2, "queued"), T("c", 3, "queued"), T("d", 4, "queued")], deps: d });
  assert.deepEqual(chunks.effect.parts, [["b", "c"], ["d"]]);
  assert.equal(chunks.effect.scheduled.length, 1);
  assert.equal((await executeHarnessStrategy({ strategy: "escalate_human", session: SESSION, deps: d })).reason, "no_executor");
  assert.equal((await executeHarnessStrategy({ strategy: "teach_back", session: SESSION, deps: d })).reason, "runs_in_teaching");
  const broken = await executeHarnessStrategy({ strategy: "space_out", session: SESSION, topic: null, deps: { ...d, scheduleFollowUp: async () => { throw new Error("queue down"); } } });
  assert.deepEqual([broken.executed, broken.reason], [false, "executor_failed"], "never throws");
});

test("executors: replan moves only queued topics, through the store's conditional writes", async () => {
  const topics = [T("photo", 1, "active"), T("matter", 2, "queued"), T("water", 3, "queued")];
  const d = deps({ topics });
  const r = await executeHarnessStrategy({ strategy: "prerequisite_review", learnerId: "u", session: SESSION, topic: topics[0], topics: topics.map((t) => ({ ...t })), deps: d });
  assert.equal(r.executed, true);
  assert.deepEqual(topics.sort((a, b) => a.position - b.position).map((t) => t.id), ["photo", "water", "matter"]);
  assert.deepEqual(r.effect.missingPrerequisites, ["Cells"]);
});

test("runStrategyOffer: library + limit checks; an offer ranks candidates; acceptance executes and starts a pending outcome", async () => {
  const topic = { id: "t1", label: "Evaporation", check_result: { score: 0.4 } };
  assert.equal((await runStrategyOffer({ strategy: "retrieval_practice", session: SESSION, deps: deps() })).refusal, "strategy_not_permitted");
  const limited = await runStrategyOffer({ strategy: "space_out", learnerId: "u", session: SESSION, topic, deps: deps({ checkLimit: async () => ({ refusal: "strategy_limit_reached", usesOnTopic: 2, limit: 2 }) }) });
  assert.equal(limited.refusal, "strategy_limit_reached");
  const d = deps();
  const offered = await runStrategyOffer({ strategy: "space_out", learnerId: "u", session: SESSION, topic, deps: d });
  assert.equal(offered.accepted, false);
  assert.deepEqual(offered.recommended, [{ id: "interleave", reasons: ["untried_by_you"] }]);
  assert.equal(d.calls.followUps.length, 0, "an offer alone runs nothing");
  const accepted = await runStrategyOffer({ strategy: "space_out", accepted: true, learnerId: "u", session: SESSION, topic, deps: d });
  assert.equal(accepted.execution.executed, true);
  assert.equal(accepted.outcomeId, "o1");
  const o = d.calls.outcomes[0];
  assert.deepEqual([o.outcome, o.workflow, o.sessionRef, o.scoreBefore, o.details.pending, o.topic], ["abandoned", "study_prep", "study_prep:s1", 0.4, true, "Evaporation"]);
  assert.match(o.details.use, /^study_prep:s1#/);
  assert.match(o.turnRef, /^accept:t1:/);
});
