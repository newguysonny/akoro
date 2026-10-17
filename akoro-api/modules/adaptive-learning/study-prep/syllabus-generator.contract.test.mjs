// Grand Plan §8.7 (D30): when no real syllabus exists, Study Prep plans from
// an AI-drafted outline — checked in code, reused, always labelled, and never
// used while a real syllabus exists. No db, no LLM: in-memory doubles.
import assert from "node:assert/strict";
import test from "node:test";

process.env.OPENAI_API_KEY ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";

const { checkOutline, normaliseClassLevel } = await import("./syllabus-generator.js");
const { createHarness, GENERATED_OUTLINE_LABEL, HarnessRejection } = await import("./harness.js");
const { deliberate } = await import("./narration.js");

const topic = (label, n = 2) => ({ label, objectives: Array.from({ length: n }, (_, i) => `Explain point ${i + 1} of ${label}`) });
const SCOPE = { subject: "Agricultural Science", classLevel: "JSS1" };

test("checkOutline accepts a clean draft and gives each topic a stable id", () => {
  const r = checkOutline({ subject: "Agricultural Science", classLevel: "JSS 1", topics: [topic("Meaning of agriculture"), topic("Farm tools"), topic("Soil types", 3)] }, SCOPE);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.topics.map((t) => t.id), ["meaning-of-agriculture", "farm-tools", "soil-types"]);
  assert.equal(r.topics[2].objectives.length, 3);
});

test("checkOutline rejects what the plan forbids", () => {
  const bad = (raw) => checkOutline(raw, SCOPE);
  assert.equal(bad({}).ok, false, "no topics");
  assert.equal(bad({ topics: [topic("A topic"), topic("B topic")] }).ok, false, "fewer than 3");
  assert.equal(bad({ topics: Array.from({ length: 16 }, (_, i) => topic(`Topic number ${i + 1}`)) }).ok, false, "more than 15");
  assert.equal(bad({ topics: [topic("Farm tools"), topic("Farm Tools"), topic("Soil")] }).ok, false, "duplicates by id");
  assert.equal(bad({ topics: [topic("Farm tools", 1), topic("Soil types"), topic("Crops")] }).ok, false, "too few objectives");
  assert.equal(bad({ topics: [topic("Farm tools", 6), topic("Soil types"), topic("Crops")] }).ok, false, "too many objectives");
  assert.equal(bad({ topics: [topic("See https://x.io"), topic("Soil types"), topic("Crops")] }).ok, false, "links");
  assert.equal(bad({ topics: [topic("**Farm tools**"), topic("Soil types"), topic("Crops")] }).ok, false, "markup");
  assert.equal(bad({ subject: "Mathematics", topics: [topic("Farm tools"), topic("Soil types"), topic("Crops")] }).ok, false, "wrong subject");
  assert.equal(bad({ classLevel: "SS2", topics: [topic("Farm tools"), topic("Soil types"), topic("Crops")] }).ok, false, "wrong class");
  assert.equal(normaliseClassLevel(" jss 1 "), "JSS1");
});

// ── harness with in-memory doubles ──────────────────────────────────────────
function harnessWith({ realTopics = [], outline = null, schoolChain = null }) {
  const sessions = new Map();
  const events = [];
  const calls = { generate: 0 };
  const store = {
    findActiveSession: async () => null,
    createSession: async (row) => { const s = { id: "s1", created_at: "t", updated_at: "t", ...row }; sessions.set(s.id, s); return s; },
    getSession: async (id) => sessions.get(id) || null,
    updateSessionConditional: async (id, status, patch) => { const r = sessions.get(id); if (!r || r.status !== status) return null; const u = { ...r, ...patch }; sessions.set(id, u); return u; },
    appendEvents: async (_id, rows) => { events.push(...rows); return rows; },
    listEvents: async () => events, getTopics: async () => [],
  };
  const syllabus = {
    resolveTopics: async () => realTopics,
    prerequisiteEdges: async () => [],
    generateOutline: async () => { calls.generate += 1; return outline; },
    generatedTopics: async (id) => (id === outline?.id ? outline.topics : []),
    // The learner's own class/school syllabus (§8.7), when the test gives one.
    ...(schoolChain ? {
      resolveSyllabusChain: async () => schoolChain,
      topicsForSource: async ({ source, ref }) => (source === schoolChain.source && ref === schoolChain.ref ? schoolChain.topics : []),
    } : {}),
  };
  return { harness: createHarness({ store, topicWorkflow: {}, syllabus }), sessions, events, calls };
}

const OUTLINE = { id: "g1", reused: false, topics: [{ id: "farm-tools", label: "Farm tools" }, { id: "soil-types", label: "Soil types" }, { id: "crops", label: "Crops" }] };

test("no real syllabus → the outline is drafted, recorded as the session's source, and plans validate against it", async () => {
  const { harness, sessions, events } = harnessWith({ outline: OUTLINE });
  const s = await harness.createSession({ learnerId: "L", goal: "Pass my JSS1 Agric test", subject: "Agricultural Science" });
  const out = await harness.generateSyllabus({ sessionId: s.id, learnerId: "L" });
  assert.equal(out.source, "generated");
  assert.equal(out.label, GENERATED_OUTLINE_LABEL);
  assert.equal(sessions.get(s.id).syllabus_source, "generated");
  assert.equal(sessions.get(s.id).syllabus_ref, "g1");
  assert.ok(events.some((e) => e.decisionNode === "syllabus_generated" || e.decision_node === "syllabus_generated"));

  const planned = await harness.proposePlan({ sessionId: s.id, learnerId: "L", topicIds: ["farm-tools", "crops"] });
  assert.equal(planned.session.status, "awaiting_confirmation");
  assert.equal(planned.session.syllabusSource, "generated");
  assert.equal(planned.session.syllabusLabel, GENERATED_OUTLINE_LABEL, "the plan card is labelled");
  assert.deepEqual(planned.plan.map((t) => t.label), ["Farm tools", "Crops"]);
});

test("a topic outside the generated outline is still rejected", async () => {
  const { harness } = harnessWith({ outline: OUTLINE });
  const s = await harness.createSession({ learnerId: "L", goal: "Agric", subject: "Agricultural Science" });
  await harness.generateSyllabus({ sessionId: s.id, learnerId: "L" });
  await assert.rejects(harness.proposePlan({ sessionId: s.id, learnerId: "L", topicIds: ["photosynthesis"] }),
    (e) => e instanceof HarnessRejection && e.code === "topic_not_in_syllabus");
});

test("a real syllabus always wins: generate is refused and nothing is drafted", async () => {
  const { harness, sessions, calls } = harnessWith({ realTopics: [{ id: "matter", label: "Matter" }], outline: OUTLINE });
  const s = await harness.createSession({ learnerId: "L", goal: "Basic Science", subject: "Basic Science" });
  await assert.rejects(harness.generateSyllabus({ sessionId: s.id, learnerId: "L" }), (e) => e.code === "syllabus_exists");
  assert.equal(calls.generate, 0);
  assert.equal(sessions.get(s.id).syllabus_source, undefined);
  const planned = await harness.proposePlan({ sessionId: s.id, learnerId: "L", topicIds: ["matter"] });
  assert.equal(planned.session.syllabusSource, "platform");
  assert.equal(planned.session.syllabusLabel, null);
});

test("only while planning; another learner's session is not found", async () => {
  const { harness, sessions } = harnessWith({ outline: OUTLINE });
  const s = await harness.createSession({ learnerId: "L", goal: "Agric", subject: "Agricultural Science" });
  await assert.rejects(harness.generateSyllabus({ sessionId: s.id, learnerId: "someone-else" }), (e) => e.code === "session_not_found");
  sessions.set(s.id, { ...sessions.get(s.id), status: "topic_active" });
  await assert.rejects(harness.generateSyllabus({ sessionId: s.id, learnerId: "L" }), (e) => e.code === "invalid_state_transition");
});

test("the narration says it's an AI-drafted outline, and when it was reused", () => {
  const fresh = deliberate("syllabus_generated", { subject: "Agricultural Science", classLevel: "JSS1", reused: false }).narrative;
  assert.match(fresh, /couldn't find a syllabus for JSS1 Agricultural Science/);
  assert.match(fresh, /AI-drafted outline, not your school's official syllabus/);
  assert.match(deliberate("syllabus_generated", { reused: true }).narrative, /drafted earlier/);
});

// ── the learner's class / school syllabus wins (§8.7 steps 1–2) ─────────────

const CLASS_CHAIN = {
  source: "class", ref: "class-jss1", className: "JSS1", term: "First",
  topics: [
    { id: "living-things", label: "Living Things", term: "First", covered: true, source: "class" },
    { id: "states-of-matter", label: "States of Matter", term: "First", covered: false, source: "class" },
  ],
};

test("syllabus.resolve: the class syllabus is returned, recorded as the source, and narrated", async () => {
  const { harness, sessions, events } = harnessWith({ schoolChain: CLASS_CHAIN, realTopics: [{ id: "energy", label: "Energy" }] });
  const s = await harness.createSession({ learnerId: "L", goal: "Pass my JSS1 test", subject: "Basic Science" });
  const out = await harness.resolveSyllabus({ sessionId: s.id, learnerId: "L" });
  assert.equal(out.found, true);
  assert.equal(out.source, "class");
  assert.equal(out.term, "First");
  assert.deepEqual(out.topics, [
    { id: "living-things", label: "Living Things", term: "First", covered: true },
    { id: "states-of-matter", label: "States of Matter", term: "First", covered: false },
  ]);
  assert.equal(sessions.get(s.id).syllabus_source, "class");
  assert.equal(sessions.get(s.id).syllabus_ref, "class-jss1");
  const said = events.find((e) => (e.decisionNode || e.decision_node) === "syllabus_resolved");
  assert.match(said.narrative, /your school's JSS1 Basic Science syllabus for the First term/);
  // Asked again: same source, no second narration.
  await harness.resolveSyllabus({ sessionId: s.id, learnerId: "L" });
  assert.equal(events.filter((e) => (e.decisionNode || e.decision_node) === "syllabus_resolved").length, 1);
});

test("a plan made from the class syllabus is checked against it — not the platform's", async () => {
  const { harness } = harnessWith({ schoolChain: CLASS_CHAIN, realTopics: [{ id: "energy", label: "Energy" }] });
  const s = await harness.createSession({ learnerId: "L", goal: "Pass my JSS1 test", subject: "Basic Science" });
  await harness.resolveSyllabus({ sessionId: s.id, learnerId: "L" });
  const planned = await harness.proposePlan({ sessionId: s.id, learnerId: "L", topicIds: ["states-of-matter", "living-things"] });
  assert.equal(planned.session.status, "awaiting_confirmation");
  assert.equal(planned.session.syllabusSource, "class");
  assert.equal(planned.session.syllabusLabel, null, "only a generated outline carries the AI-drafted label");
  // A platform-only topic is not in the class syllabus.
  const other = harnessWith({ schoolChain: CLASS_CHAIN, realTopics: [{ id: "energy", label: "Energy" }] });
  const s2 = await other.harness.createSession({ learnerId: "L", goal: "Pass my JSS1 test", subject: "Basic Science" });
  await other.harness.resolveSyllabus({ sessionId: s2.id, learnerId: "L" });
  await assert.rejects(() => other.harness.proposePlan({ sessionId: s2.id, learnerId: "L", topicIds: ["energy"] }), (e) => e.code === "topic_not_in_syllabus");
});

test("syllabus.generate is refused while the learner's class or school has a syllabus", async () => {
  for (const chain of [CLASS_CHAIN, { ...CLASS_CHAIN, source: "school", ref: "school-a", term: null }]) {
    const { harness, calls } = harnessWith({ schoolChain: chain, outline: OUTLINE });
    const s = await harness.createSession({ learnerId: "L", goal: "Pass my test", subject: "Basic Science" });
    await assert.rejects(() => harness.generateSyllabus({ sessionId: s.id, learnerId: "L" }), (e) => e.code === "syllabus_exists");
    assert.equal(calls.generate, 0, chain.source);
  }
});

test("nothing anywhere → found:false, and only then may an outline be drafted", async () => {
  const { harness, sessions } = harnessWith({ schoolChain: { source: null, ref: null, topics: [], term: null }, outline: OUTLINE });
  const s = await harness.createSession({ learnerId: "L", goal: "Pass my test", subject: "Agricultural Science" });
  const out = await harness.resolveSyllabus({ sessionId: s.id, learnerId: "L" });
  assert.equal(out.found, false);
  assert.match(out.next, /syllabus\.generate/);
  assert.equal(sessions.get(s.id).syllabus_source ?? null, null);
  const drafted = await harness.generateSyllabus({ sessionId: s.id, learnerId: "L" });
  assert.equal(drafted.source, "generated");
  // Once drafted, resolve returns the outline (it stays the source).
  const again = await harness.resolveSyllabus({ sessionId: s.id, learnerId: "L" });
  assert.equal(again.source, "generated");
  assert.deepEqual(again.topics.map((t) => t.id), ["farm-tools", "soil-types", "crops"]);
});
