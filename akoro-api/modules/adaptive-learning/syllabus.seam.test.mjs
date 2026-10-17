// Seam tests for the syllabus knowledge base's retrieval side over the
// in-memory fake db (MIGRATION_MATRIX §7). Ingest/extract (embedding + LLM)
// are skipped; searchSyllabus's embedding goes through a local stub of the
// OpenAI client's embeddings endpoint and match_syllabus is a stubbed rpc.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";
// syllabus.js → auth/routes.js registers a Google passport strategy at import.
process.env.GOOGLE_CLIENT_ID ||= "test";
process.env.GOOGLE_CLIENT_SECRET ||= "test";

const { default: db } = await import("../../db.js");
const { installFakeDb } = await import("../../lib/testing/fakeDb.mjs");
const { openai } = await import("../../lib/aiModel.js");
// auth/routes.js starts a ref'd setInterval at import; unref it so the file exits.
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => realSetInterval(...args).unref();
let syllabus;
try { syllabus = await import("./syllabus.js"); } finally { globalThis.setInterval = realSetInterval; }
const { getSubjectOutline, listSubjects, searchSyllabus, getSyllabusGrounding, getSyllabusContext, deleteSubject } = syllabus;

function fakeFor(t, seed = {}, options = {}) {
  const fake = installFakeDb(db, seed, options);
  t.after(() => fake.restore());
  return fake;
}

function stubEmbeddings(t, { fail = false } = {}) {
  const calls = [];
  const saved = Object.getOwnPropertyDescriptor(openai, "embeddings");
  openai.embeddings = { create: async (params) => { calls.push(params); if (fail) throw new Error("embed down"); return { data: [{ embedding: [0.5, 0.5] }] }; } };
  t.after(() => { if (saved) Object.defineProperty(openai, "embeddings", saved); });
  return calls;
}

const MATHS = { id: randomUUID(), exam: "WASSCE", name: "General Mathematics", slug: "general-mathematics", code: "MATH", aims: "Numeracy", paper_structure: { papers: 2 }, updated_at: "2026-01-01" };
const BIO = { id: randomUUID(), exam: "WASSCE", name: "Biology", slug: "biology", code: null, aims: null, paper_structure: null, updated_at: "2026-01-02" };

// ── getSubjectOutline ───────────────────────────────────────────────────────

test("getSubjectOutline: slugifies the input and returns the subject with ordered topics + nested subtopics", async (t) => {
  fakeFor(t, {
    "edu.syllabus_subjects": [MATHS, BIO],
    "edu.syllabus_topics": [
      { id: "t2", subject_id: MATHS.id, title: "Algebra", sort_order: 1, syllabus_subtopics: [{ id: "s1", title: "Equations", sort_order: 0 }] },
      { id: "t1", subject_id: MATHS.id, title: "Number", sort_order: 0, syllabus_subtopics: [] },
      { id: "tb", subject_id: BIO.id, title: "Cells", sort_order: 0, syllabus_subtopics: [] },
    ],
  });
  const out = await getSubjectOutline("  General  Mathematics!! ");
  assert.equal(out.id, MATHS.id);
  assert.equal(out.slug, "general-mathematics");
  assert.deepEqual(out.topics.map((x) => x.title), ["Number", "Algebra"], "ordered by sort_order, own subject only");
  assert.equal(out.topics[1].syllabus_subtopics[0].title, "Equations");
});

test("getSubjectOutline: unknown subject → null; subject with no topics → topics []", async (t) => {
  fakeFor(t, { "edu.syllabus_subjects": [BIO] });
  assert.equal(await getSubjectOutline("chemistry"), null);
  assert.equal(await getSubjectOutline(""), null);
  assert.deepEqual((await getSubjectOutline("Biology")).topics, []);
});

// ── listSubjects ────────────────────────────────────────────────────────────

test("listSubjects: ordered by name with topic_count from the embedded count (0 when absent)", async (t) => {
  fakeFor(t, { "edu.syllabus_subjects": [
    { ...MATHS, syllabus_topics: [{ count: 7 }] },
    { ...BIO, syllabus_topics: [] },
  ] });
  const out = await listSubjects();
  assert.deepEqual(out.map((s) => [s.name, s.topic_count]), [["Biology", 0], ["General Mathematics", 7]]);
});

test("listSubjects: a db error degrades to []", async (t) => {
  const fake = fakeFor(t, { "edu.syllabus_subjects": [MATHS] });
  fake.failNext("edu.syllabus_subjects", "select", { message: "down" });
  assert.deepEqual(await listSubjects(), []);
});

test("deleteSubject: deletes by slugified name only", async (t) => {
  const fake = fakeFor(t, { "edu.syllabus_subjects": [MATHS, BIO] });
  await deleteSubject("General Mathematics");
  assert.deepEqual(fake.rows("edu.syllabus_subjects").map((s) => s.slug), ["biology"]);
});

// ── searchSyllabus (stubbed embedding + rpc) ────────────────────────────────

test("searchSyllabus: embeds the query and calls match_syllabus with slug + limit", async (t) => {
  const hits = [{ content: "x", similarity: 0.9 }];
  const fake = fakeFor(t, {}, { rpc: { match_syllabus: () => ({ data: hits }) } });
  const embeds = stubEmbeddings(t);
  const out = await searchSyllabus("quadratic equations", { subject: "General Mathematics", limit: 3 });
  assert.deepEqual(out, hits);
  assert.equal(embeds[0].model, "text-embedding-3-small");
  assert.equal(embeds[0].input, "quadratic equations");
  assert.deepEqual(fake.rpcCalls[0], { name: "match_syllabus", args: { p_query_embedding: [0.5, 0.5], p_subject_slug: "general-mathematics", p_match_count: 3 } });
});

test("searchSyllabus: defaults (no subject, limit 6); rpc error throws; null data → []", async (t) => {
  let mode = "null";
  const fake = fakeFor(t, {}, { rpc: { match_syllabus: () => (mode === "error" ? { error: { message: "rpc down" } } : { data: null }) } });
  stubEmbeddings(t);
  assert.deepEqual(await searchSyllabus("cells"), []);
  assert.equal(fake.rpcCalls[0].args.p_subject_slug, null);
  assert.equal(fake.rpcCalls[0].args.p_match_count, 6);
  mode = "error";
  await assert.rejects(searchSyllabus("cells"), { message: "rpc down" });
});

test("searchSyllabus: clips very long queries before embedding", async (t) => {
  fakeFor(t, {}, { rpc: { match_syllabus: () => ({ data: [] }) } });
  const embeds = stubEmbeddings(t);
  await searchSyllabus("y".repeat(9000));
  assert.equal(embeds[0].input.length, 8000);
});

// ── getSyllabusGrounding / getSyllabusContext ──────────────────────────────

const hit = (over) => ({ exam: "WAEC", subject_slug: "biology", subject_name: "Biology", topic_title: "Cells", content: "Cell theory", similarity: 0.9, ...over });

test("getSyllabusGrounding: drops weak matches, numbers the context, dedupes refs and caps them at 3", async (t) => {
  fakeFor(t, {}, { rpc: { match_syllabus: () => ({ data: [
    hit({}), hit({ content: "Organelles" }), // same ref twice
    hit({ topic_title: "Genetics", content: "Mendel" }),
    hit({ exam: "JAMB", topic_title: "Ecology", content: "Food chains", subject_name: null }),
    hit({ topic_title: "Evolution", content: "Darwin" }),
    hit({ topic_title: "Weak", content: "noise", similarity: 0.1 }),
    hit({ topic_title: "NoScore", content: "unknown", similarity: undefined }),
  ] }) } });
  stubEmbeddings(t);
  const { context, refs } = await getSyllabusGrounding("cells");
  assert.match(context, /^Relevant exam syllabus/);
  assert.match(context, /1\. \[WAEC Biology › Cells\] Cell theory/);
  assert.match(context, /4\. \[JAMB biology › Ecology\] Food chains/, "falls back to the slug when the name is missing");
  assert.doesNotMatch(context, /noise|unknown/, "below minSimilarity (and missing similarity) is excluded");
  assert.deepEqual(refs, [
    { exam: "WAEC", subject: "Biology", topic: "Cells" },
    { exam: "WAEC", subject: "Biology", topic: "Genetics" },
    { exam: "JAMB", subject: "biology", topic: "Ecology" },
  ]);
});

test("getSyllabusGrounding: honours a custom minSimilarity", async (t) => {
  fakeFor(t, {}, { rpc: { match_syllabus: () => ({ data: [hit({ similarity: 0.5 })] }) } });
  stubEmbeddings(t);
  assert.equal((await getSyllabusGrounding("cells", { minSimilarity: 0.6 })).context, "");
  assert.equal((await getSyllabusGrounding("cells", { minSimilarity: 0.5 })).refs.length, 1);
});

test("getSyllabusGrounding: an embedding or rpc outage degrades to empty grounding (never throws)", async (t) => {
  fakeFor(t, {}, { rpc: { match_syllabus: () => ({ error: { message: "rpc down" } }) } });
  stubEmbeddings(t);
  assert.deepEqual(await getSyllabusGrounding("cells"), { context: "", refs: [] });
});

test("getSyllabusGrounding: embedding failure → empty grounding", async (t) => {
  fakeFor(t, {}, { rpc: { match_syllabus: () => ({ data: [hit({})] }) } });
  stubEmbeddings(t, { fail: true });
  assert.deepEqual(await getSyllabusGrounding("cells"), { context: "", refs: [] });
});

test("getSyllabusContext returns just the context string", async (t) => {
  fakeFor(t, {}, { rpc: { match_syllabus: () => ({ data: [hit({})] }) } });
  stubEmbeddings(t);
  const ctx = await getSyllabusContext("cells");
  assert.equal(typeof ctx, "string");
  assert.match(ctx, /Cell theory/);
});
