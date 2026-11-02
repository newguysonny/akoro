/**
 * Phase 11 (dashboard descriptors, deterministic routing) and Phase 18 item 2
 * (one "needs you" list): every state of every REGISTERED workflow type maps
 * to exactly one category or none; the categories are mutually exclusive and
 * cover every case; counts equal the lists they link to; a learner sees only
 * their own items; nothing is read from reply text. In memory: no db.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";

// Every workflow type the app registers (each module registers itself on import).
await import("../adaptive-learning/study-prep/workflow.js");
await import("../adaptive-learning/teaching-session/workflow.js");
await import("../adaptive-learning/decay-review/workflow.js");
await import("../adaptive-learning/practice/workflow.js");
await import("../materials/ingestCore.js");

const { registeredTypes, workflowDefinition } = await import("./registry.js");
const { isTerminalStatus, statusFor, WORKFLOW_TYPES } = await import("./definition.js");
const { createWorkflowEngine } = await import("./engine.js");
const { memoryWorkflowStore } = await import("./store.js");
const { ATTENTION, NEEDS_YOU, SURFACES, BADGE_TONES, WAITERS, attentionOf, describeWorkflow, isCategory } = await import("./dashboard.js");
const { needsYou, countsOf, itemsIn, FAILED_WINDOW_MS, SOURCES } = await import("./needsYou.js");
const { makeDashboardApi, audienceOf } = await import("./dashboardApi.js");

const A = "learner-a";
const B = "learner-b";
const T = "instructor-t";
const NOW = Date.parse("2026-11-02T12:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const ahead = (ms) => new Date(NOW + ms).toISOString();

const everyState = () => registeredTypes().flatMap((type) => workflowDefinition(type).states.map((state) => ({ type, state, def: workflowDefinition(type) })));

/* ── the table covers the registry, exactly ─────────────────────────────── */

test("the registry holds every workflow type the app has", () => {
  for (const t of [...WORKFLOW_TYPES, "material_ingest"]) assert.ok(registeredTypes().includes(t), `${t} is registered`);
});

test("every state of every registered type → exactly one category, or none", () => {
  const seen = [];
  for (const { type, state } of everyState()) {
    assert.ok(Object.prototype.hasOwnProperty.call(ATTENTION[type] || {}, state), `${type}.${state} has a row`);
    const a = attentionOf(type, state);
    assert.ok(isCategory(a.needs), `${type}.${state}: ${a.needs} is a category or none`);
    // A single value, never a list: one category at most.
    assert.ok(a.needs === null || typeof a.needs === "string", `${type}.${state} has one category`);
    seen.push(`${type}.${state}:${a.needs}`);
  }
  // And the table names nothing the registry lacks.
  for (const [type, states] of Object.entries(ATTENTION)) {
    assert.ok(registeredTypes().includes(type), `${type} is registered`);
    for (const state of Object.keys(states)) assert.ok(workflowDefinition(type).states.includes(state), `${type}.${state} is a real state`);
  }
  assert.ok(seen.length >= 50, `walked ${seen.length} states`);
});

test("the categories are checkable: each follows from status and who the state waits for", () => {
  const healthyWaiting = new Set(["material_ingest.ready"]);        // the folder at rest
  for (const { type, state, def } of everyState()) {
    const a = attentionOf(type, state);
    const status = statusFor(def, state);
    const key = `${type}.${state}`;
    assert.ok(WAITERS.includes(a.who), `${key}: who`);
    assert.ok(BADGE_TONES.includes(a.badge.tone), `${key}: badge tone`);
    assert.ok(a.surface === null || SURFACES.includes(a.surface), `${key}: surface`);
    if (isTerminalStatus(status)) {
      assert.equal(a.needs, null, `${key}: finished → none`);
      assert.equal(a.who, "nobody", `${key}: finished waits for nobody`);
      assert.equal(a.surface, null, `${key}: finished opens nothing`);
      continue;
    }
    // Needs you ⇔ it waits for the learner (healthy waits excepted, and named).
    if (a.needs) assert.equal(a.who, "learner", `${key}: a category waits for you`);
    if (a.who === "learner") assert.ok(a.needs, `${key}: waits for you → a category`);
    if (status === "waiting_learner" && !healthyWaiting.has(key)) assert.ok(a.needs, `${key}: waiting_learner → a category`);
    // blocked ⇔ paused (a paused upload is failed or in Recently deleted instead).
    if (a.needs === "blocked") assert.equal(status, "paused", `${key}: blocked only when paused`);
    if (status === "paused") assert.ok(["blocked", "failed"].includes(a.needs) || key === "material_ingest.undone", `${key}: paused → blocked/failed`);
    // An agent or a check working is healthy.
    if (a.who === "agent" || a.who === "check") assert.equal(a.needs, null, `${key}: working → none`);
    if (status === "waiting_child") assert.equal(a.needs, null, `${key}: waits on a child → none (the child carries it)`);
  }
});

/* ── descriptors and routes ─────────────────────────────────────────────── */

test("every open state of every engine type gets a descriptor with one deterministic route carrying its workflowId", async () => {
  const store = memoryWorkflowStore();
  const engine = createWorkflowEngine({ store });
  for (const type of WORKFLOW_TYPES) {
    for (const state of workflowDefinition(type).states) {
      const { instance } = await engine.create({ workflowType: type, learnerId: A, state, metadata: { topic: "Water Cycle", subject: "Basic Science", battleId: "b-1", kind: ["running", "stopped"].includes(state) ? "agent_check" : undefined } });
      const d = describeWorkflow(instance);
      assert.equal(d.workflowId, instance.id);
      assert.equal(d.workflowType, type);
      assert.equal(d.state, state);
      assert.ok(d.title, `${type}.${state}: a title`);
      assert.equal(d.needsYou, isTerminalStatus(instance.status) ? null : attentionOf(type, state).needs);
      if (isTerminalStatus(instance.status)) { assert.equal(d.action, null); assert.equal(d.continue.available, false); continue; }
      assert.ok(d.action, `${type}.${state}: one primary action`);
      const r = d.action.route;
      assert.equal(r.workflowId, instance.id);
      assert.ok(SURFACES.includes(r.surface));
      assert.ok(r.surface === "battle" ? r.href.includes("battle=b-1") : r.href.includes(`workflow=${instance.id}`), `${type}.${state}: href ${r.href}`);
      // Deterministic: the same row gives the same route.
      assert.deepEqual(describeWorkflow(instance).action, d.action);
    }
  }
});

test("routes by type: Study Prep → chat; teaching → its modal (continuing its session); decay → review modal; exam → room; Agent Check → Battles", async () => {
  const engine = createWorkflowEngine({ store: memoryWorkflowStore() });
  const sp = (await engine.create({ workflowType: "study_prep", learnerId: A, state: "awaiting_confirmation", metadata: { studyPrepSessionId: "s-1", subject: "Basic Science" } })).instance;
  const t = (await engine.create({ workflowType: "teaching", learnerId: A, state: "teaching_active", parent: sp.id, source: { workflowId: sp.id }, metadata: { topic: "Evaporation", focus: ["Evaporation vs transpiration"], adaptiveSessionId: "as-1", progress: { done: 1, of: 3 } } })).instance;
  const dr = (await engine.create({ workflowType: "decay_review", learnerId: A, state: "intervention", metadata: { topic: "Photosynthesis", retrieval: { round: 2, done: [{}] }, teaching: { needed: true } } })).instance;
  const ex = (await engine.create({ workflowType: "practice", learnerId: A, state: "paused", metadata: { kind: "proctored", topic: "Algebra", assessmentId: "as-9" } })).instance;
  const ac = (await engine.create({ workflowType: "practice", learnerId: A, state: "running", metadata: { kind: "agent_check", topic: "Algebra", battleId: "bt-2", answered: 2, total: 5 } })).instance;

  const dsp = describeWorkflow(sp, { facts: { topics: 6, understood: 2 } });
  assert.equal(dsp.action.route.surface, "agent_chat");
  assert.equal(dsp.needsYou, "review");
  assert.deepEqual(dsp.progress, { done: 2, of: 6, label: "2 of 6 topics understood" });

  const dt = describeWorkflow(t, { parent: sp });
  assert.deepEqual(dt.action.route.params, { topic: "Evaporation", subject: null, adaptiveSessionId: "as-1", mode: "continuation" });
  assert.equal(dt.source.title, "Study Prep: Basic Science");
  assert.equal(dt.progress.label, "1 of 3 parts taught");
  assert.equal(dt.focus, "Evaporation vs transpiration");

  const ddr = describeWorkflow(dr);
  assert.equal(ddr.action.route.surface, "decay_review_modal");
  assert.equal(ddr.action.label, "Re-teach it", "a re-teach step changes only the words");
  assert.equal(ddr.needsYou, "answer");

  const dex = describeWorkflow(ex);
  assert.equal(dex.needsYou, "blocked");
  assert.equal(dex.action.route.params.assessmentId, "as-9");

  const dac = describeWorkflow(ac);
  assert.equal(dac.needsYou, null);
  assert.equal(dac.action.route.href, "/app?tab=battles&battle=bt-2");
  assert.equal(dac.progress.label, "2 of 5 questions answered");
});

test("a pause's reason says why, the category stays blocked", async () => {
  const engine = createWorkflowEngine({ store: memoryWorkflowStore() });
  const sp = (await engine.create({ workflowType: "study_prep", learnerId: A, state: "topic_active", metadata: { subject: "Maths" } })).instance;
  const paused = await engine.transition(sp.id, { from: "topic_active", to: "paused", reason: "insufficient_balance" });
  const d = describeWorkflow(paused);
  assert.equal(d.needsYou, "blocked");
  assert.equal(d.waitsFor.reason, "insufficient_balance");
  assert.match(d.waitsFor.label, /coins/);
});

test("nothing is read from reply text: words in metadata never change the category or the route", async () => {
  const engine = createWorkflowEngine({ store: memoryWorkflowStore() });
  const t = (await engine.create({ workflowType: "teaching", learnerId: A, state: "assessment", metadata: { topic: "Cells" } })).instance;
  const noisy = { ...t, metadata: { ...t.metadata, reply: "Please answer now! Waiting for your decision.", lastMessage: "FAILED — review this" } };
  const a = describeWorkflow(t);
  const b = describeWorkflow(noisy);
  assert.equal(b.needsYou, a.needsYou);
  assert.deepEqual(b.action, a.action);
  assert.deepEqual(b.badge, a.badge);
});

/* ── the list: one row per thing that needs you, counts = lists ──────────── */

test("walking every engine state: a run is on the list exactly when its state has a category", async () => {
  for (const type of WORKFLOW_TYPES) {
    for (const state of workflowDefinition(type).states) {
      const store = memoryWorkflowStore();
      const engine = createWorkflowEngine({ store });
      await engine.create({ workflowType: type, learnerId: A, state, metadata: { topic: "T" } });
      const runs = await engine.listForLearner(A, { active: true });
      const list = needsYou({ ownerId: A, workflows: runs, now: NOW });
      const want = attentionOf(type, state).needs;
      assert.equal(list.items.length, want ? 1 : 0, `${type}.${state}`);
      if (want) assert.equal(list.items[0].category, want);
      assert.equal(list.counts.total, list.items.length);
    }
  }
});

function fullWorld() {
  return {
    suggestions: [
      { id: "11111111-1111-4111-8111-111111111111", user_id: A, kind: "task", title: "Revise titration", status: "open", created_at: ago(3600e3) },
      { id: "11111111-1111-4111-8111-111111111112", user_id: A, kind: "task", title: "Dismissed one", status: "dismissed", created_at: ago(3600e3) },
      { id: "11111111-1111-4111-8111-111111111113", user_id: B, kind: "task", title: "B's idea", status: "open", created_at: ago(3600e3) },
    ],
    proposals: [
      { id: "22222222-2222-4222-8222-222222222221", user_id: A, kind: "revision_battle", title: "A 5-question check on moles", status: "proposed", expires_at: ahead(864e5), created_at: ago(7200e3) },
      { id: "22222222-2222-4222-8222-222222222222", user_id: A, kind: "task", title: "Expired idea", status: "proposed", expires_at: ago(1000), created_at: ago(8 * 864e5) },
      { id: "22222222-2222-4222-8222-222222222223", user_id: A, kind: "practice", title: "Practice that broke", status: "failed", decided_at: ago(3600e3), created_at: ago(2 * 864e5) },
      { id: "22222222-2222-4222-8222-222222222224", user_id: A, kind: "practice", title: "Old failure", status: "failed", decided_at: ago(FAILED_WINDOW_MS + 1000), created_at: ago(9 * 864e5) },
      { id: "22222222-2222-4222-8222-222222222225", user_id: T, kind: "chase_missing", title: "Remind 3 learners", status: "proposed", expires_at: ahead(864e5), created_at: ago(600e3) },
    ],
    confirmations: [
      { id: "33333333-3333-4333-8333-333333333331", principal_id: A, status: "pending", preview: { title: "Tidy my tasks", action: "Delete your tasks", items: ["x"] }, tool_arguments: {}, expires_at: ahead(600e3), created_at: ago(60e3) },
      { id: "33333333-3333-4333-8333-333333333332", principal_id: A, status: "pending", preview: { title: "Goal tracker" }, tool_arguments: { kind: "permission" }, expires_at: ahead(600e3), created_at: ago(120e3) },
      { id: "33333333-3333-4333-8333-333333333333", principal_id: A, status: "pending", preview: { title: "Expired" }, tool_arguments: {}, expires_at: ago(1), created_at: ago(900e3) },
      { id: "33333333-3333-4333-8333-333333333334", principal_id: T, status: "pending", preview: { title: "Rename my class" }, tool_arguments: {}, expires_at: ahead(600e3), created_at: ago(60e3) },
    ],
    drafts: [
      { id: "44444444-4444-4444-8444-444444444441", created_by: T, status: "draft", title: "Revision: fractions", created_at: ago(864e5) },
      { id: "44444444-4444-4444-8444-444444444442", created_by: T, status: "assigned", title: "Already sent", created_at: ago(864e5) },
      { id: "44444444-4444-4444-8444-444444444443", created_by: T, status: "draft", title: "Stale draft", created_at: ago(8 * 864e5) },
    ],
    ingests: [
      { id: "55555555-5555-4555-8555-555555555551", user_id: A, state: "failed", names: ["paper.pdf"], created_at: ago(3600e3) },
      { id: "55555555-5555-4555-8555-555555555552", user_id: A, state: "offering_more", folder_name: "Biology — Past papers", names: ["a.pdf", "b.pdf"], created_at: ago(3600e3) },
      { id: "55555555-5555-4555-8555-555555555553", user_id: A, state: "ready", names: ["c.pdf"], created_at: ago(3600e3) },
    ],
  };
}

test("other sources: proposals and suggestions are decisions, a fresh failure is failed, a change card is a review, a permission a decision", () => {
  const w = fullWorld();
  const list = needsYou({ ownerId: A, ...w, now: NOW });
  const by = Object.fromEntries(list.items.map((it) => [it.title, it]));
  assert.equal(by["Revise titration"].category, "decision");
  assert.equal(by["Revise titration"].source, "suggestion");
  assert.equal(by["A 5-question check on moles"].category, "decision");
  assert.equal(by["A 5-question check on moles"].action.label, "Start the check", "the Yes button says what it does");
  assert.equal(by["Practice that broke"].category, "failed");
  assert.equal(by["Tidy my tasks"].category, "review");
  assert.equal(by["Goal tracker"].category, "decision");
  assert.equal(by["paper.pdf"].category, "failed");
  assert.equal(by["Biology — Past papers"].category, "decision");
  for (const gone of ["Dismissed one", "Expired idea", "Old failure", "Expired", "c.pdf", "B's idea", "Remind 3 learners", "Rename my class", "Revision: fractions"]) {
    assert.equal(by[gone], undefined, `${gone} is not on A's list`);
  }
  for (const it of list.items) {
    assert.ok(SOURCES.includes(it.source));
    assert.ok(it.action?.href, `${it.title}: carries its action`);
    assert.equal(it.waitsFor.who, "you");
  }
});

test("categories are mutually exclusive and cover every row; every count equals the list it links to", () => {
  const list = needsYou({ ownerId: A, ...fullWorld(), now: NOW });
  const refs = new Set();
  let sum = 0;
  for (const c of NEEDS_YOU) {
    const rows = itemsIn(list, c);
    assert.equal(list.counts[c], rows.length, `count of ${c}`);
    for (const r of rows) { assert.ok(!refs.has(r.ref), `${r.ref} is in one category only`); refs.add(r.ref); }
    sum += rows.length;
  }
  assert.equal(sum, list.items.length, "every row is in a category");
  assert.equal(list.counts.total, list.items.length);
  assert.deepEqual(countsOf(list.items), list.counts);
  // Sorted by what it waits for.
  const order = list.items.map((it) => NEEDS_YOU.indexOf(it.category));
  assert.deepEqual(order, [...order].sort((x, y) => x - y));
});

test("an instructor's list: their drafts to review, their proposals and cards — never a learner's", () => {
  const list = needsYou({ ownerId: T, audience: "instructor", ...fullWorld(), now: NOW });
  const titles = list.items.map((it) => `${it.category}:${it.title}`).sort();
  assert.deepEqual(titles, ["decision:Remind 3 learners", "review:Rename my class", "review:Revision: fractions"]);
  const draft = list.items.find((it) => it.source === "draft");
  assert.equal(draft.action.href, "/activities/draft?draft=44444444-4444-4444-8444-444444444441");
  assert.match(list.items.find((it) => it.source === "proposal").action.href, /^\/chat\?inbox=/);
  assert.equal(audienceOf({ role: "instructor" }), "instructor");
  assert.equal(audienceOf({ role: "student" }), "learner");
});

test("ownership: a learner's dashboard and list hold only their own runs; another's run is not found", async () => {
  const store = memoryWorkflowStore();
  const engine = createWorkflowEngine({ store });
  const mine = (await engine.create({ workflowType: "decay_review", learnerId: A, state: "intervention", metadata: { topic: "Cells" } })).instance;
  await engine.create({ workflowType: "study_prep", learnerId: A, state: "topic_active", metadata: { subject: "Maths" } });
  await engine.create({ workflowType: "study_prep", learnerId: A, state: "completed", metadata: { subject: "Old" } });
  const theirs = (await engine.create({ workflowType: "teaching", learnerId: B, state: "scheduled", metadata: { topic: "B's topic" } })).instance;
  const w = fullWorld();
  const sources = {
    // A stray row of B's slipped into A's load: it must still not show.
    learner: async (id) => ({ workflows: [...await engine.listForLearner(id, { active: true }), theirs], workflowFacts: {}, suggestions: w.suggestions, proposals: w.proposals, confirmations: w.confirmations, ingests: w.ingests, unavailable: [] }),
    instructor: async () => ({ suggestions: [], proposals: [], confirmations: [], drafts: [], unavailable: [] }),
    studyPrepFacts: async () => ({}),
  };
  const api = makeDashboardApi({ engine, sources, now: () => NOW });
  const dash = await api.forLearner(A);
  assert.equal(dash.workflows.length, 2, "A's two open runs (the finished one and B's are not cards)");
  assert.ok(dash.workflows.every((d) => d.workflowId !== theirs.id));
  assert.ok(dash.needsYou.items.every((it) => it.ref !== `w:${theirs.id}`));
  assert.ok(dash.needsYou.items.some((it) => it.ref === `w:${mine.id}` && it.category === "answer"));
  // Healthy (topic_active) takes no row.
  assert.equal(dash.needsYou.items.filter((it) => it.source === "workflow").length, 1);
  assert.equal(await api.one(A, theirs.id), null, "another learner's run is not found");
  assert.equal((await api.one(A, mine.id)).workflowId, mine.id);
  const forA = await api.needsYouFor({ id: A, role: "student" });
  assert.equal(forA.audience, "learner");
  assert.equal(forA.counts.total, forA.items.length);
});

test("a source that failed to load is named, not counted as empty", async () => {
  const engine = createWorkflowEngine({ store: memoryWorkflowStore() });
  const api = makeDashboardApi({ engine, now: () => NOW, sources: {
    learner: async () => ({ workflows: [], workflowFacts: {}, suggestions: [], proposals: [], confirmations: [], ingests: [], unavailable: ["proposals"] }),
  } });
  const out = await api.forLearner(A);
  assert.deepEqual(out.unavailable, ["proposals"]);
});
