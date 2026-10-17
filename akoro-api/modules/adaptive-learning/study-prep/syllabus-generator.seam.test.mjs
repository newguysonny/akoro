// Seam tests for generateOutline / generatedTopics over the in-memory fake db.
// The model is never called: every test injects a stub `draft`.
// (checkOutline is covered by syllabus-generator.contract.test.mjs.)
import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";

const { default: db } = await import("../../../db.js");
const { installFakeDb } = await import("../../../lib/testing/fakeDb.mjs");
const { generateOutline, generatedTopics, OUTLINE_PROMPT_VERSION } = await import("./syllabus-generator.js");

const G = "edu.generated_syllabi";
const TOPICS = [
  { id: "states-of-matter", label: "States of Matter", objectives: ["Name the three states", "Describe melting"] },
  { id: "living-things", label: "Living Things", objectives: ["List features of living things", "Classify organisms"] },
  { id: "energy", label: "Energy", objectives: ["Define energy", "Name energy forms"] },
];

function fakeFor(t, seed = {}, options = {}) {
  const fake = installFakeDb(db, seed, options);
  t.after(() => fake.restore());
  return fake;
}

const neverDraft = async () => { throw new Error("draft must not be called"); };

test("reuses the provisional outline for the same scope (subject/class case- and space-insensitive) without drafting", async (t) => {
  const fake = fakeFor(t, {
    [G]: [{ id: "g1", status: "provisional", subject: "basic science", class_level: "jss1", term: null, exam_board: null, topics: TOPICS }],
  });
  const out = await generateOutline({ subject: "  Basic   Science ", classLevel: "JSS 1", draft: neverDraft });
  assert.deepEqual(out, { id: "g1", topics: TOPICS, reused: true });
  assert.equal(fake.calls.filter((c) => c.op === "insert").length, 0);
});

test("does not reuse an outline from another scope, status, term or exam board", async (t) => {
  const fake = fakeFor(t, {
    [G]: [
      { id: "approved", status: "approved", subject: "Basic Science", class_level: "JSS1", term: null, exam_board: null, topics: TOPICS },
      { id: "termed", status: "provisional", subject: "Basic Science", class_level: "JSS1", term: "first", exam_board: null, topics: TOPICS },
      { id: "waec", status: "provisional", subject: "Basic Science", class_level: "JSS1", term: null, exam_board: "WAEC", topics: TOPICS },
      { id: "jss2", status: "provisional", subject: "Basic Science", class_level: "JSS2", term: null, exam_board: null, topics: TOPICS },
      { id: "maths", status: "provisional", subject: "Mathematics", class_level: "JSS1", term: null, exam_board: null, topics: TOPICS },
    ],
  });
  let drafted = 0;
  const out = await generateOutline({ subject: "Basic Science", classLevel: "JSS1", draft: async () => { drafted += 1; return { topics: TOPICS, model: "stub" }; } });
  assert.equal(drafted, 1);
  assert.equal(out.reused, false);
  assert.ok(!["approved", "termed", "waec", "jss2", "maths"].includes(out.id));
  assert.equal(fake.rows(G).length, 6);
});

test("exam board is part of the scope: a WAEC request reuses the WAEC outline", async (t) => {
  fakeFor(t, {
    [G]: [
      { id: "none", status: "provisional", subject: "Basic Science", class_level: "JSS1", term: null, exam_board: null, topics: [] },
      { id: "waec", status: "provisional", subject: "Basic Science", class_level: "JSS1", term: null, exam_board: "WAEC", topics: TOPICS },
    ],
  });
  assert.equal((await generateOutline({ subject: "Basic Science", classLevel: "JSS1", examBoard: "WAEC", draft: neverDraft })).id, "waec");
});

test("no outline yet: calls the injected draft with the normalised scope, saves a provisional row, reused:false", async (t) => {
  const fake = fakeFor(t, {}, { defaults: { [G]: { status: "provisional", term: null } } });
  const draftCalls = [];
  const out = await generateOutline({
    subject: " Basic  Science ", classLevel: "jss 1", examBoard: "WAEC", goal: "Pass my exams", learnerId: "learner-1",
    draft: async (args) => { draftCalls.push(args); return { topics: TOPICS, model: "stub-model" }; },
  });
  assert.deepEqual(draftCalls, [{ subject: "Basic Science", classLevel: "JSS1", examBoard: "WAEC", goal: "Pass my exams" }]);
  assert.equal(out.reused, false);
  assert.deepEqual(out.topics, TOPICS);
  const [row] = fake.rows(G);
  assert.equal(row.id, out.id);
  assert.deepEqual(
    { created_by_learner: row.created_by_learner, subject: row.subject, class_level: row.class_level, exam_board: row.exam_board, status: row.status, model: row.model, prompt_version: row.prompt_version, grounding: row.grounding },
    { created_by_learner: "learner-1", subject: "Basic Science", class_level: "JSS1", exam_board: "WAEC", status: "provisional", model: "stub-model", prompt_version: OUTLINE_PROMPT_VERSION, grounding: { platformTopics: 0 } },
  );
  // The saved outline is now reused for the same scope.
  const again = await generateOutline({ subject: "basic science", classLevel: "JSS1", examBoard: "WAEC", draft: neverDraft });
  assert.deepEqual(again, { id: out.id, topics: TOPICS, reused: true });
});

test("defaults: examBoard null, learner null, model null when the draft names none", async (t) => {
  const fake = fakeFor(t);
  await generateOutline({ subject: "Basic Science", classLevel: "JSS1", draft: async () => ({ topics: TOPICS }) });
  const [row] = fake.rows(G);
  assert.equal(row.exam_board, null);
  assert.equal(row.created_by_learner, null);
  assert.equal(row.model, null);
});

test("a draft failure propagates and nothing is saved", async (t) => {
  const fake = fakeFor(t);
  const invalid = Object.assign(new Error("The drafted outline failed its checks"), { code: "outline_invalid" });
  await assert.rejects(generateOutline({ subject: "Basic Science", classLevel: "JSS1", draft: async () => { throw invalid; } }), { code: "outline_invalid" });
  assert.equal(fake.rows(G).length, 0);
});

test("23505 race: another learner saved the same scope while we drafted → their row is returned (reused:true)", async (t) => {
  const fake = fakeFor(t, {}, { unique: { [G]: [["subject", "class_level", "exam_board", "status"]] }, defaults: { [G]: { status: "provisional", term: null } } });
  const out = await generateOutline({
    subject: "Basic Science", classLevel: "JSS1", examBoard: "WAEC",
    draft: async () => {
      fake.rows(G).push({ id: "theirs", status: "provisional", subject: "Basic Science", class_level: "JSS1", term: null, exam_board: "WAEC", topics: TOPICS });
      return { topics: [{ id: "mine", label: "Mine", objectives: [] }], model: "stub" };
    },
  });
  assert.deepEqual(out, { id: "theirs", topics: TOPICS, reused: true });
  assert.equal(fake.rows(G).length, 1);
});

test("23505 with no provisional row to fall back on rethrows the insert error", async (t) => {
  const fake = fakeFor(t);
  fake.failNext(G, "insert", { code: "23505", message: "duplicate key value violates unique constraint" });
  await assert.rejects(generateOutline({ subject: "Basic Science", classLevel: "JSS1", draft: async () => ({ topics: TOPICS }) }), { code: "23505" });
});

test("a lookup error propagates before drafting", async (t) => {
  const fake = fakeFor(t);
  fake.failNext(G, "select", { message: "lookup down" });
  await assert.rejects(generateOutline({ subject: "Basic Science", classLevel: "JSS1", draft: neverDraft }), { message: "lookup down" });
});

test("generatedTopics returns {id,label,objectives} for a saved outline; [] for no id or an unknown id", async (t) => {
  fakeFor(t, {
    [G]: [{ id: "g1", topics: [{ id: "a", label: "A", objectives: ["x", "y"], extra: "dropped" }, { id: "b", label: "B" }] }, { id: "g2", topics: null }],
  });
  assert.deepEqual(await generatedTopics("g1"), [{ id: "a", label: "A", objectives: ["x", "y"] }, { id: "b", label: "B", objectives: [] }]);
  assert.deepEqual(await generatedTopics("g2"), []);
  assert.deepEqual(await generatedTopics("missing"), []);
  assert.deepEqual(await generatedTopics(null), []);
});

test("generatedTopics propagates a db error", async (t) => {
  const fake = fakeFor(t);
  fake.failNext(G, "select", { message: "down" });
  await assert.rejects(generatedTopics("g1"), { message: "down" });
});
