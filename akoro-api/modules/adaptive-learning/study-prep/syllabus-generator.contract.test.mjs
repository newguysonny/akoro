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
function harnessWith({ realTopics = [], outline = null }) {
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
