// Seam tests for lesson-ladder resolution over the in-memory fake db
// (MIGRATION_MATRIX §7). No model is ever called: the ladder generator
// (`guide`) is injected, and the syllabus-grounding embedding goes through a
// local stub of the OpenAI client's embeddings endpoint.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { beforeEach } from "node:test";
import { resetSharedEmbeddings } from "../../lib/searchEmbedding.js";
// These seams count embedding calls: no shared embedding carried from one test to the next.
beforeEach(() => resetSharedEmbeddings());

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";
// lessonLadder → syllabus.js → auth/routes.js, which registers a Google
// passport strategy at import and throws without a client id.
process.env.GOOGLE_CLIENT_ID ||= "test";
process.env.GOOGLE_CLIENT_SECRET ||= "test";

const { default: db } = await import("../../db.js");
const { installFakeDb } = await import("../../lib/testing/fakeDb.mjs");
const { openai } = await import("../../lib/aiModel.js");
// auth/routes.js starts a ref'd setInterval (DenyList.sweep) at import that
// would keep this test process alive forever; unref intervals made while
// importing so the file exits by itself.
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => realSetInterval(...args).unref();
let ladder;
try { ladder = await import("./lessonLadder.js"); } finally { globalThis.setInterval = realSetInterval; }
const { learnerContext, resolveLadder, provenanceLabel } = ladder;

function fakeFor(t, seed = {}, options = {}) {
  const fake = installFakeDb(db, seed, options);
  t.after(() => fake.restore());
  return fake;
}

/** Stub the embeddings endpoint underneath the metered proxy (no network). */
function stubEmbeddings(t) {
  const calls = [];
  const saved = Object.getOwnPropertyDescriptor(openai, "embeddings");
  openai.embeddings = { create: async (params) => { calls.push(params); return { data: [{ embedding: [0.1, 0.2, 0.3] }] }; } };
  t.after(() => { if (saved) Object.defineProperty(openai, "embeddings", saved); });
  return calls;
}

/** A guide that fails the test if the generator is reached. */
const forbiddenGuide = {
  generateSubtopics: () => { throw new Error("generator must not be called"); },
  generateObjectives: () => { throw new Error("generator must not be called"); },
};

const stubGuide = (subtopics = ["Basics", "Middle", "Advanced"]) => {
  const calls = { subtopics: [], objectives: [] };
  return {
    calls,
    generateSubtopics: async (topic, subject, context) => { calls.subtopics.push({ topic, subject, context }); return { subtopics, map: [{ step: subtopics[0] }] }; },
    generateObjectives: async (st) => { calls.objectives.push(st); return [`Know ${st}.`]; },
  };
};

const tick = () => new Promise((resolve) => setImmediate(resolve));

const STUDENT = randomUUID();
const SCHOOL = randomUUID();
const CLASS = randomUUID();

// ── learnerContext ──────────────────────────────────────────────────────────

test("learnerContext: no student id → no school/class, no query", async (t) => {
  const fake = fakeFor(t);
  assert.deepEqual(await learnerContext(null), { schoolId: null, classId: null });
  assert.deepEqual(await learnerContext(""), { schoolId: null, classId: null });
  assert.equal(fake.calls.length, 0);
});

test("learnerContext: a linked mgmt.students row gives school + class", async (t) => {
  fakeFor(t, { "mgmt.students": [{ user_id: STUDENT, school_id: SCHOOL, class_id: CLASS }] });
  assert.deepEqual(await learnerContext(STUDENT), { schoolId: SCHOOL, classId: CLASS });
});

test("learnerContext: roster row without a class → school only", async (t) => {
  fakeFor(t, { "mgmt.students": [{ user_id: STUDENT, school_id: SCHOOL, class_id: null }] });
  assert.deepEqual(await learnerContext(STUDENT), { schoolId: SCHOOL, classId: null });
});

test("learnerContext: not on the roster (or roster row has no school) → classroom membership fallback, class unknown", async (t) => {
  const fake = fakeFor(t, {
    "mgmt.students": [{ user_id: STUDENT, school_id: null, class_id: CLASS }],
    classroom_students: [{ user_id: STUDENT, classrooms: { school_id: SCHOOL } }],
  });
  assert.deepEqual(await learnerContext(STUDENT), { schoolId: SCHOOL, classId: null });
  assert.ok(fake.calls.some((c) => c.table === "classroom_students"));
});

test("learnerContext: on neither → nulls; a db exception is swallowed → nulls", async (t) => {
  fakeFor(t, { "mgmt.students": [], classroom_students: [{ user_id: randomUUID(), classrooms: { school_id: SCHOOL } }] });
  assert.deepEqual(await learnerContext(STUDENT), { schoolId: null, classId: null });

  const savedSchema = db.schema;
  db.schema = () => { throw new Error("db down"); };
  t.after(() => { db.schema = savedSchema; });
  assert.deepEqual(await learnerContext(STUDENT), { schoolId: null, classId: null });
});

// ── resolveLadder: cache hit ────────────────────────────────────────────────

const cachedLadder = (over = {}) => ({
  id: randomUUID(), school_id: SCHOOL, class_id: CLASS, subject: "Biology", topic_key: "photosynthesis", topic: "Photosynthesis",
  subtopics: ["Light", "Chlorophyll", "Calvin cycle"], knowledge_map: [{ step: "Light" }], objectives: { Light: ["Explain light"] },
  provenance: "syllabus", refs: [{ exam: "WAEC" }], status: "approved", use_count: 4, ...over,
});

test("resolveLadder: cache hit returns the stored ladder, bumps use_count, never generates", async (t) => {
  const row = cachedLadder();
  const fake = fakeFor(t, {
    "mgmt.students": [{ user_id: STUDENT, school_id: SCHOOL, class_id: CLASS }],
    "edu.lesson_ladders": [row],
  });
  const out = await resolveLadder({ studentId: STUDENT, topic: "  PhotoSynthesis ", subject: "biology", guide: forbiddenGuide });
  assert.deepEqual(out, {
    subtopics: row.subtopics, map: row.knowledge_map, objectives: row.objectives, provenance: "syllabus",
    refs: row.refs, status: "approved", ladderId: row.id, cached: true,
  });
  await tick();
  assert.equal(fake.rows("edu.lesson_ladders")[0].use_count, 5, "fire-and-forget use_count bump");
  assert.equal(fake.rows("edu.lesson_ladders").length, 1, "no new ladder cached");
});

test("resolveLadder: cache is keyed per school/class — another class misses", async (t) => {
  const fake = fakeFor(t, {
    "mgmt.students": [{ user_id: STUDENT, school_id: SCHOOL, class_id: randomUUID() }],
    "edu.lesson_ladders": [cachedLadder()],
  });
  stubEmbeddings(t);
  const guide = stubGuide();
  const out = await resolveLadder({ studentId: STUDENT, topic: "Photosynthesis", subject: "Biology", guide });
  assert.equal(out.cached, false);
  assert.equal(guide.calls.subtopics.length, 1);
  assert.equal(fake.rows("edu.lesson_ladders").length, 2);
});

// ── resolveLadder: cache miss without a model (scheme of work tier) ────────

const scheme = (topic, over = {}) => ({
  school_id: SCHOOL, class_id: CLASS, topic, objectives: `Define ${topic}; Give examples\n• Apply ${topic}`,
  activities: null, resources: null, week: 1, term: 1, subject_id: "s1", subjects: { name: "Biology" }, ...over,
});

test("resolveLadder: a miss with a school scheme of work builds an approved ladder (no model) and caches it", async (t) => {
  const fake = fakeFor(t, {
    "mgmt.students": [{ user_id: STUDENT, school_id: SCHOOL, class_id: CLASS }],
    "edu.lesson_ladders": [cachedLadder({ status: "rejected" })], // rejected ladders regenerate
    "mgmt.scheme_of_work": [
      scheme("Photosynthesis I", { week: 1 }), scheme("Photosynthesis II", { week: 2 }),
      scheme("Photosynthesis I", { week: 3 }), // duplicate topic collapses
      scheme("Respiration", { week: 4, subjects: { name: "Chemistry" } }), // unrelated topic + subject
      scheme("Photosynthesis III", { week: 5, school_id: randomUUID() }), // other school
    ],
  });
  const out = await resolveLadder({ studentId: STUDENT, topic: "Photosynthesis", subject: "Biology", guide: forbiddenGuide });
  assert.equal(out.cached, false);
  assert.equal(out.provenance, "scheme_of_work");
  assert.equal(out.status, "approved");
  assert.deepEqual(out.subtopics, ["Photosynthesis I", "Photosynthesis II"]);
  assert.deepEqual(out.objectives["Photosynthesis I"], ["Define Photosynthesis I", "Give examples", "Apply Photosynthesis I"]);
  assert.deepEqual(out.map, []);
  assert.ok(!("deferObjectives" in out));

  const stored = fake.rows("edu.lesson_ladders").find((r) => r.status !== "rejected");
  assert.equal(out.ladderId, stored.id);
  assert.equal(stored.topic_key, "photosynthesis");
  assert.equal(stored.use_count, 1);
  assert.equal(stored.school_id, SCHOOL);

  // The next learner in the same class hits the cache.
  const again = await resolveLadder({ studentId: STUDENT, topic: "photosynthesis", subject: "BIOLOGY", guide: forbiddenGuide });
  assert.equal(again.cached, true);
  assert.equal(again.ladderId, stored.id);
});

test("resolveLadder: a single scheme row is not a sequence → falls through to the generator (stubbed, provenance ai)", async (t) => {
  const fake = fakeFor(t, {
    "mgmt.students": [{ user_id: STUDENT, school_id: SCHOOL, class_id: CLASS }],
    "mgmt.scheme_of_work": [scheme("Photosynthesis")],
  }, { rpc: { match_syllabus: () => ({ data: [] }) } });
  const embeds = stubEmbeddings(t);
  const guide = stubGuide();
  const out = await resolveLadder({ studentId: STUDENT, topic: "Photosynthesis", subject: "Biology", guide });
  assert.equal(out.provenance, "ai");
  assert.equal(out.status, "pending_review");
  assert.deepEqual(out.subtopics, ["Basics", "Middle", "Advanced"]);
  assert.equal(embeds.length, 1, "grounding was attempted via the (stubbed) embedding");
  assert.equal(guide.calls.subtopics[0].context, "");
  // Objectives are filled in the background and patched onto the cached row.
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(guide.calls.objectives.sort(), ["Advanced", "Basics", "Middle"]);
  assert.deepEqual(fake.rows("edu.lesson_ladders")[0].objectives, { Basics: ["Know Basics."], Middle: ["Know Middle."], Advanced: ["Know Advanced."] });
});

test("resolveLadder: syllabus hits ground the generator → provenance syllabus with refs", async (t) => {
  const fake = fakeFor(t, {}, { rpc: { match_syllabus: () => ({ data: [
    { exam: "WAEC", subject_slug: "biology", subject_name: "Biology", topic_title: "Plant nutrition", content: "Photosynthesis basics", similarity: 0.8 },
  ] }) } });
  stubEmbeddings(t);
  const guide = stubGuide();
  const out = await resolveLadder({ studentId: null, topic: "Photosynthesis", subject: "Biology", guide });
  assert.equal(out.provenance, "syllabus");
  assert.deepEqual(out.refs, [{ exam: "WAEC", subject: "Biology", topic: "Plant nutrition" }]);
  assert.match(guide.calls.subtopics[0].context, /Plant nutrition/);
  assert.equal(fake.rpcCalls[0].args.p_subject_slug, null);
});

test("resolveLadder: a failing cache insert never blocks the learner", async (t) => {
  const warn = console.warn; console.warn = () => {}; t.after(() => { console.warn = warn; });
  const savedSchema = db.schema;
  fakeFor(t, {}, { rpc: { match_syllabus: () => ({ data: [] }) } });
  const fakeSchema = db.schema;
  db.schema = (s) => {
    const inner = fakeSchema(s);
    return { ...inner, from: (tbl) => { const q = inner.from(tbl); if (tbl === "lesson_ladders") q.insert = () => { throw new Error("insert down"); }; return q; } };
  };
  t.after(() => { db.schema = savedSchema; });
  stubEmbeddings(t);
  const out = await resolveLadder({ studentId: null, topic: "Osmosis", subject: "Biology", guide: stubGuide(["A", "B"]) });
  assert.deepEqual(out.subtopics, ["A", "B"]);
  assert.equal(out.ladderId, null);
  assert.equal(out.cached, false);
});

test("resolveLadder: a standalone learner's cached ladder (school/class NULL) is looked up with IS NULL, not eq.null", async (t) => {
  fakeFor(t, { "edu.lesson_ladders": [cachedLadder({ school_id: null, class_id: null })] });
  const eqNull = [];
  const fakeSchema = db.schema;
  db.schema = (s) => {
    const inner = fakeSchema(s);
    return {
      ...inner,
      from: (tbl) => {
        const q = inner.from(tbl);
        if (tbl === "lesson_ladders") { const eq = q.eq.bind(q); q.eq = (c, v) => { if (v === null) eqNull.push(c); return eq(c, v); }; }
        return q;
      },
    };
  };
  t.after(() => { db.schema = fakeSchema; });
  const out = await resolveLadder({ studentId: null, topic: "Photosynthesis", subject: "Biology", guide: forbiddenGuide });
  assert.equal(out.cached, true, "the fake matches eq(null) loosely; real PostgREST would miss here");
  assert.deepEqual(eqNull, [], `NULL keys must use .is(col, null), got eq null on: ${eqNull.join(", ")}`);
});

// ── provenanceLabel ─────────────────────────────────────────────────────────

test("provenanceLabel maps provenance × review status to the chip copy", () => {
  assert.equal(provenanceLabel("scheme_of_work", "approved"), "From your school's scheme of work");
  assert.equal(provenanceLabel("syllabus", "approved"), "Reviewed · aligned to exam syllabus");
  assert.equal(provenanceLabel("syllabus", "pending_review"), "Aligned to exam syllabus");
  assert.equal(provenanceLabel("ai", "approved"), "Reviewed by your teacher");
  assert.equal(provenanceLabel("ai", "pending_review"), "AI-generated");
});
