// Phase 3 (Grand Plan §7.9): the v3 envelope, the narrator, replay-then-live,
// Study Prep's steps as v3 events, and Agent Chat's live events on the same format.
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";

import { CATEGORY_TO_PILL, CATEGORIES, chatEnvelope, CHAT_EVENT_NAMES, EVENT_TYPES, boundPayload, forLearner, toEnvelope, v3Type } from "./envelope.js";
import { NODE_HEADLINES, TEMPLATES, narrate } from "./narrator.js";
import { streamWorkflowEvents } from "./stream.js";
import { createWorkflowEngine } from "./engine.js";
import { memoryWorkflowStore } from "./store.js";
import { workflowEventFor, studyPrepWorkflow, makeWorkflowMirror } from "../adaptive-learning/index.js";
import { DECISION_NODES } from "../adaptive-learning/index.js";

test("narrator: every event type has a template, and every one narrates to a headline", () => {
  const missing = EVENT_TYPES.filter((t) => typeof TEMPLATES[t] !== "function");
  assert.deepEqual(missing, [], "add a template to workflows/narrator.js");
  for (const type of EVENT_TYPES) {
    const n = narrate({ type, payload: {} });
    assert.ok(n.headline && typeof n.narration === "string", type);
  }
  for (const c of CATEGORIES) assert.ok(CATEGORY_TO_PILL[c], c);
});

test("narrator: facts in, the learner's words out; a harness narrative is the detail; intent only fills the why", () => {
  assert.deepEqual(narrate({ type: "assessment.completed", payload: { topicLabel: "Osmosis", score: 3, total: 5, percentage: 60 } }),
    { headline: "Marked", description: "Osmosis", result: "3 of 5 (60%)", narration: "Marked" });
  const tool = narrate({ type: "tool.started", payload: { tool: "syllabus.resolve", intent: "Find the JSS1 topics first" } });
  assert.equal(tool.headline, "Checking the syllabus");
  assert.equal(tool.narration, "Checking the syllabus — Find the JSS1 topics first");
  const node = narrate({ type: "activity", payload: { decisionNode: "syllabus_generated", narrative: "I drafted an outline from the national curriculum." } });
  assert.deepEqual([node.headline, node.description], ["Outline drafted", "I drafted an outline from the national curriculum."]);
  for (const n of DECISION_NODES) assert.ok(NODE_HEADLINES[n], `headline for ${n}`);
});

test("envelope: bounded payload, no answer keys or prompts; legacy types read as v3; learners never see developer events", () => {
  const p = boundPayload({ answer_key: [1], prompt: "x", nested: { correctAnswer: 2, ok: 1 }, long: "a".repeat(900) });
  assert.deepEqual(Object.keys(p).sort(), ["long", "nested"]);
  assert.deepEqual(p.nested, { ok: 1 });
  assert.equal(p.long.length, 500);
  assert.equal(v3Type("harness_decision"), "decision.accepted");
  assert.equal(v3Type("tool.started"), "tool.started");
  const env = toEnvelope({ id: "1", workflow_id: "w", sequence: 4, event_type: "tool.completed", category: "research", actor: "agent", visibility: "learner", payload: { tool: "learner.get_state", facts: { a: 1 } } }, { workflow_type: "study_prep" });
  assert.equal(env.v, 3);
  assert.equal(env.pill, "research");
  assert.equal(env.narration.headline, "Reviewing what you know");
  assert.equal(forLearner(env).payload.facts, undefined, "facts are developer-only");
  assert.equal(forLearner({ ...env, visibility: "developer" }), null);
});

test("Study Prep's steps become v3 events: every decision node maps, tools and failures too", () => {
  const ev = (row) => workflowEventFor(row);
  assert.equal(ev({ event_type: "agent_tool_call", origin: "agent_stated_intent", tool: "syllabus.resolve", agent_intent: "Find topics" }).event_type, "tool.started");
  assert.equal(ev({ event_type: "agent_tool_call", origin: "agent_stated_intent", tool: "syllabus.resolve", agent_intent: "Find topics" }).payload.intent, "Find topics");
  assert.equal(ev({ event_type: "observation", origin: "harness", tool: "x", facts: { ok: false, code: "not_permitted" } }).event_type, "tool.failed");
  assert.equal(ev({ event_type: "observation", origin: "harness", facts: { ok: true } }).event_type, "tool.completed");
  assert.equal(ev({ event_type: "agent_action", origin: "harness", action: "agent_error" }).visibility, "developer", "a provider failure is not the learner's");
  for (const node of DECISION_NODES) {
    const row = ev({ event_type: "harness_decision", origin: "harness", decision_node: node, narrative: "n" });
    assert.ok(EVENT_TYPES.includes(row.event_type), `${node} → ${row.event_type}`);
    assert.equal(row.visibility, "learner");
  }
  assert.equal(ev({ event_type: "harness_decision", origin: "harness", decision_node: "harness_rejection", narrative: "n" }).event_type, "decision.rejected");
});

test("reconnect: the gap after the last sequence is replayed in order, then live events follow once each", async () => {
  const stored = [];
  const bus = new EventEmitter();
  const write = (seq) => { const env = { sequence: seq, type: "activity", visibility: "learner" }; stored.push(env); bus.emit("e", env); };
  for (let i = 0; i <= 5; i += 1) stored.push({ sequence: i, type: "activity", visibility: "learner" });
  const got = [];
  const stop = streamWorkflowEvents({
    list: async (after) => stored.filter((e) => e.sequence > after),
    subscribe: (fn) => { bus.on("e", fn); return () => bus.off("e", fn); },
    after: 2, pollMs: 0, send: (name, data) => got.push([name, data.sequence ?? data.last]),
  });
  await stop.ready;
  assert.deepEqual(got, [["workflow_event", 3], ["workflow_event", 4], ["workflow_event", 5], ["caught_up", 5]]);
  write(6); write(7);
  stored.push({ sequence: 8, type: "activity", visibility: "learner" });   // written elsewhere: no live push
  write(9);                                                                // the gap (8) is read, in order
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(got.slice(4).map((g) => g[1]), [6, 7, 8, 9]);
  stop();
  write(10);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(got.length, 8, "nothing after stop");
});

test("engine: an event is written first, then published live, and the mirror records Study Prep's moves", async () => {
  const published = [];
  const store = memoryWorkflowStore();
  const engine = createWorkflowEngine({ store, publish: (row) => published.push(row.event_type) });
  const mirror = makeWorkflowMirror(engine, { log: { warn() {} } });
  const session = { id: "s1", learner_id: "l1", status: "planning", subject: "Basic Science" };
  const spStore = { async updateSessionConditional() { return session; }, async getSession() { return session; }, async listEvents() { return []; } };
  await mirror.sessionCreated(session, spStore);
  await mirror.eventsWritten("s1", [{ event_type: "harness_decision", origin: "harness", decision_node: "plan_validated", narrative: "ok", sequence: 0 }], spStore);
  await mirror.sessionMoved(session, "planning", "awaiting_confirmation");
  assert.deepEqual(published, ["workflow.created", "decision.accepted", "workflow.state_changed"]);
  const rows = await store.listEvents(session.workflow_id, { after: 0 });
  assert.deepEqual(rows.map((r) => r.sequence), [1, 2]);
  assert.ok(studyPrepWorkflow);
});

test("backfill: an older session gets its workflow once, its events copied once, in order", async () => {
  const store = memoryWorkflowStore();
  const engine = createWorkflowEngine({ store, publish: () => {} });
  const mirror = makeWorkflowMirror(engine, { log: { warn() {} } });
  const session = { id: "s2", learner_id: "l1", status: "topic_active", subject: "Maths" };
  const old = [0, 1, 2].map((i) => ({ event_type: "harness_decision", origin: "harness", decision_node: "topic_started", narrative: `t${i}`, sequence: i }));
  const spStore = { async updateSessionConditional() { return session; }, async listEvents() { return old; } };
  const id = await mirror.ensure(session, spStore);
  assert.ok(id);
  assert.equal(await mirror.ensure(session, spStore), id, "same workflow the second time");
  const rows = await store.listEvents(id);
  assert.deepEqual(rows.filter((r) => r.payload?.studyPrepSequence != null).map((r) => r.payload.studyPrepSequence), [0, 1, 2], "copied once");
});

test("Agent Chat: every live event carries the envelope; names and fields unchanged", () => {
  assert.deepEqual(chatEnvelope("tool_end", { ok: false }, { turnId: "t", sequence: 3 }), { v: 3, type: "tool.failed", sequence: 3, turnId: "t", workflowType: "agent_chat", actor: "agent", visibility: "learner" });
  assert.equal(chatEnvelope("think_start", {}).type, "agent.narration.start");
  assert.equal(chatEnvelope("delta", { text: "a" }).type, "reply.delta");
  assert.equal(chatEnvelope("tool_start", { category: "research" }).category, "research");
  assert.equal(chatEnvelope("error", {}), null, "an error stays as it was");
  for (const name of ["think_start", "think_delta", "think_end", "tool_start", "tool_end", "activity", "activity_start", "activity_delta", "activity_end", "activity_promote", "activity_drop", "delta", "done", "status"]) {
    assert.ok(CHAT_EVENT_NAMES.includes(name), name);
  }
});

test("a planning read says what it found, in learner-safe words", async () => {
  const { studyPrepResultLine } = await import("../adaptive-learning/index.js");
  assert.equal(studyPrepResultLine("learner.get_state", { ok: true, result: { topics: { Cells: 0.21, Habitats: 0.34, Water: 0.9, Air: 0.5 } } }), "Weakest: Cells 21%, Habitats 34%, Air 50%");
  assert.equal(studyPrepResultLine("syllabus.resolve", { ok: true, result: { found: false, topics: [] } }), "No syllabus found for this class");
  assert.equal(studyPrepResultLine("syllabus.resolve", { ok: true, result: { found: true, topics: Array(12).fill({}) } }), "12+ topics found");
  assert.equal(studyPrepResultLine("learner.get_history", { ok: true, result: { runs: [{}] } }), "1 past practice run found");
  assert.equal(studyPrepResultLine("learner.get_state", { ok: false, code: "x" }), null);
  const row = workflowEventFor({ event_type: "observation", origin: "harness", tool: "concept.get_prerequisites", facts: { ok: true, result: { edges: [{}, {}] } } });
  assert.equal(row.payload.resultLine, "2 prerequisite links to respect");
  assert.equal(narrate({ type: "tool.completed", payload: row.payload }).result, "2 prerequisite links to respect");
});

test("planning in the background: the plan-ready message is written from the plan", async () => {
  const { planReadyMessage } = await import("../adaptive-learning/index.js");
  assert.equal(planReadyMessage({ status: "awaiting_confirmation", subject: "Basic Science", plan: [{ label: "Cells" }, { label: "Habitats" }], estimate: { totalCoins: 12 }, syllabusSource: "generated" }),
    "Your Basic Science plan is ready: 2 topics, starting with **Cells**. It costs 12 coins in total, charged one topic at a time — nothing is charged until you approve it on the card. It's built on an AI-drafted outline of the national curriculum, not your school's official syllabus.");
  assert.match(planReadyMessage({ status: "paused", subject: "Maths" }), /got stuck while planning your Maths/);
  assert.match(planReadyMessage({ status: "planning", subject: "Maths" }), /couldn't finish planning/);
});

test("developer notes are live only: a developer stream gets them at once, a learner stream never does", async () => {
  const bus = new EventEmitter();
  const run = (filter) => {
    const got = [];
    const stop = streamWorkflowEvents({ list: async () => [], subscribe: (fn) => { bus.on("e", fn); return () => bus.off("e", fn); }, pollMs: 0, filter, send: (name, data) => got.push([name, data.payload?.thinking || data.last]) });
    return { got, stop };
  };
  const dev = run((env) => (env.live ? env : forLearner(env)));
  const learner = run(forLearner);
  await dev.stop.ready; await learner.stop.ready;
  bus.emit("e", { live: true, type: "agent.narration", visibility: "developer", payload: { thinking: "No evidence yet — lean on the syllabus order." } });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(dev.got.at(-1), ["workflow_live", "No evidence yet — lean on the syllabus order."]);
  assert.equal(learner.got.filter((g) => g[0] === "workflow_live").length, 0);
  dev.stop(); learner.stop();
});
