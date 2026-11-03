/**
 * The syllabus importer: layout kept, running lines dropped, pages chunked so
 * nothing is cut off, chunk topics merged back together, checks for review,
 * and the draft → ingestSubject shape. The model is a fake.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";

const L = await import("./layoutText.js");
const S = await import("./structure.js");

test("a table row reads across its columns; running headers and page numbers go", () => {
  const lines = L.linesFromItems([
    { str: "(iv) transportation;", x: 120, y: 500 }, { str: "Assessment would include", x: 330, y: 500.8 },
    { str: "(v) storage", x: 120, y: 488 },
  ]);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\s+\(iv\) transportation;\s{3,}Assessment would include$/);
  const words = ["cells", "tissues", "organs", "systems"];
  const pages = [1, 2, 3, 4].map((n) => ["WAEC BIOLOGY SYLLABUS", `Topic on ${words[n - 1]}`, `about ${words[n - 1]} one`, `about ${words[n - 1]} two`, `ends with ${words[n - 1]}`, String(n)]);
  const out = L.stripRunningLines(pages);
  assert.deepEqual(out[0], ["Topic on cells", "about cells one", "about cells two", "ends with cells"]);
});

test("pages chunk by size and a long page splits at line breaks — nothing is lost", () => {
  const pages = [{ page: 1, text: "a".repeat(6000) }, { page: 2, text: "b".repeat(6000) }, { page: 3, text: Array(30).fill("c".repeat(999)).join("\n") }];
  const chunks = S.chunkPages(pages, 10_000);
  assert.ok(chunks.every((c) => c.text.length <= 10_000));
  assert.equal(chunks.map((c) => c.text).join("\n").replace(/\n/g, "").length, pages.map((p) => p.text).join("").replace(/\n/g, "").length);
  assert.deepEqual([chunks[0].from, chunks.at(-1).to], [1, 3]);
});

test("a topic split across chunks merges back, and a subtopic cut in half joins up", () => {
  const merged = S.mergeTopics([
    [{ title: "A. BASIC CONCEPTS", continues: false, subtopics: [{ title: "1. Living things", content: "(a) x", objectives: [], notes: null }] }],
    [{ title: "Basic concepts", continues: true, subtopics: [{ title: "1. Living things", content: "(b) y", objectives: [], notes: "n" }, { title: "2. Cells", content: "c", objectives: [], notes: null }] },
     { title: "B. PLANT AND ANIMAL NUTRITION", continues: false, subtopics: [{ title: "1. Photosynthesis", content: "p", objectives: [], notes: null }] }],
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].subtopics.map((s) => s.title), ["1. Living things", "2. Cells"]);
  assert.equal(merged[0].subtopics[0].content, "(a) x; (b) y");
  assert.equal(merged[0].subtopics[0].notes, "n");
});

test("the import: front matter + every chunk, a failed chunk is a warning not a gap left silent", async () => {
  const pages = Array.from({ length: 5 }, (_, i) => ({ page: i + 1, text: `${i + 1}. Item ${i}\n${"x".repeat(4000)}` }));
  let calls = 0;
  const ask = async ({ system, user }) => {
    calls++;
    if (system === S.FRONT_SYSTEM) return JSON.stringify({ name: "Biology", code: null, aims: "1. know; 2. do", paper_structure: { papers: [{ name: "Paper 1", type: "Objective", questions: 50, duration_min: 50 }] } });
    if (user.includes("Pages 5–5")) throw new Error("bad json");
    return JSON.stringify({ topics: [{ title: "A. BASIC CONCEPTS", continues: !user.includes("Pages 1–"), subtopics: [{ title: `S${calls}`, content: "c", objectives: ["o"], notes: null }] }] });
  };
  const out = await S.structureSyllabus({ pages, hint: { exam: "WASSCE" }, ask, concurrency: 1 });
  assert.equal(out.doc.name, "Biology");
  assert.equal(out.doc.exam, "WASSCE");
  assert.equal(out.doc.topics.length, 1, "continued chunks merge into one topic");
  assert.ok(out.warnings.some((w) => w.kind === "chunk_failed"), "a chunk that failed twice is named for the reviewer");
  assert.equal(out.stats.pages, 5);
  const ingest = S.toIngestDoc(out.doc, "biology.pdf");
  assert.equal(ingest.topics[0].subtopics[0].objectives[0], "o");
  assert.equal(ingest.source, "biology.pdf");
});

test("notes ride in the published content; a single section isn't stamped on titles", () => {
  const doc = { exam: "WASSCE", name: "Biology", topics: [{ title: "Cells", section: "Section A", subtopics: [{ title: "1. Cell", content: "(a) parts", objectives: [], notes: "Use diagrams" }] }] };
  const out = S.toIngestDoc(doc, "x");
  assert.equal(out.topics[0].title, "Cells");
  assert.equal(out.topics[0].subtopics[0].content, "(a) parts\nNotes: Use diagrams");
  assert.equal(out.topics[0].subtopics[0].objectives, null);
});

test("the bundled WAEC Biology PDF reads with its layout (35 pages, the table rows across)", async () => {
  const buf = fs.readFileSync(new URL("../../../data/syllabus/sources/waec-biology.pdf", import.meta.url));
  const pages = await L.pdfLayoutPages(buf);
  assert.equal(pages.length, 35);
  assert.match(pages[0].text, /AIMS AND OBJECTIVES/);
  assert.ok(pages.some((p) => /Levels of organization/.test(p.text)));
});
