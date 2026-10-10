import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";

const {
  ASK_LIMITS, contentWords, selectPassages, buildAskMessages, extractCitations, passageWhere, gatherPassages,
} = await import("./askLib.js");
const routesSrc = await readFile(new URL("./routes.js", import.meta.url), "utf8")
  + await readFile(new URL("./access.js", import.meta.url), "utf8");   // the access rule lives in access.js
const migration = await readFile(new URL("../../migrations/2026-record-chat.sql", import.meta.url), "utf8");
const manifest = await readFile(new URL("../../migrations/manifest.json", import.meta.url), "utf8");

const block = (bbox, text) => ({ bbox_2d: bbox, text_content: text });
const pages = new Map([
  [3, { markdown: "", blocks: [
    block([50, 40, 950, 90], "Chapter 2: Photosynthesis"),
    block([50, 100, 950, 300], "Photosynthesis converts light energy into chemical energy stored in glucose."),
    block([50, 320, 950, 400], "<image>"),
    block([50, 420, 950, 600], "The Calvin cycle fixes carbon dioxide in the stroma."),
  ] }],
  [7, { markdown: "", blocks: [
    block([60, 80, 940, 200], "Respiration releases the energy stored in glucose."),
  ] }],
  [9, { markdown: "Page nine has text but no layout blocks.", blocks: [] }],
]);
const hits = [
  { chunkKind: "page", pageNumber: 3, text: "…" },
  { chunkKind: "page", pageNumber: 7, text: "…" },
  { chunkKind: "page", pageNumber: 9, text: "…" },
];

test("passages come from the best blocks of the hit pages, each with its page and box, in reading order", () => {
  const ps = selectPassages({ hits, pages, question: "How does photosynthesis store light energy in glucose?" });
  assert.ok(ps.length >= 3);
  assert.deepEqual(ps.map((p) => p.n), ps.map((_, i) => i + 1), "numbered 1..n");
  assert.ok(!ps.some((p) => p.text === "<image>"), "figures are never passages");
  const best = ps.find((p) => /converts light energy/.test(p.text));
  assert.deepEqual([best.kind, best.pageNumber, best.bbox], ["block", 3, [50, 100, 950, 300]]);
  assert.ok(ps.some((p) => p.pageNumber === 7), "every hit page is represented");
  const nine = ps.find((p) => p.pageNumber === 9);
  assert.deepEqual([nine.kind, nine.bbox], ["page", null], "a page without blocks falls back to its text");
  const order = ps.map((p) => [p.pageNumber, p.bbox ? p.bbox[1] : 0]);
  assert.deepEqual(order, [...order].sort((a, b) => a[0] - b[0] || a[1] - b[1]), "reading order");
});

test("a pinned selection comes first and is matched to its block", () => {
  const ps = selectPassages({ hits, pages, question: "explain", selection: { pageNumber: 3, text: "The Calvin cycle fixes carbon dioxide" } });
  assert.equal(ps[0].n, 1);
  assert.equal(ps[0].pinned, true);
  assert.deepEqual(ps[0].bbox, [50, 420, 950, 600]);
  assert.equal(ps.filter((p) => /Calvin cycle/.test(p.text)).length, 1, "the pinned block is not repeated");
});

test("recordings and pasted text become passages with their moment", () => {
  const ps = selectPassages({ hits: [
    { chunkKind: "transcript", startMs: 725000, endMs: 760000, text: "Today we look at enzymes and activation energy." },
    { chunkKind: "paste", text: "Notes: enzymes lower activation energy." },
  ], question: "enzymes" });
  assert.deepEqual(ps.map((p) => p.kind).sort(), ["paste", "transcript"]);
  const t = ps.find((p) => p.kind === "transcript");
  assert.deepEqual([t.startMs, t.endMs], [725000, 760000]);
  assert.equal(passageWhere(t), "at 12:05");
});

test("passages are bounded in count and total size", () => {
  const many = new Map([[1, { markdown: "", blocks: Array.from({ length: 60 }, (_, i) => block([0, i * 10, 1000, i * 10 + 9], `photosynthesis fact ${i} `.repeat(30))) }]]);
  const ps = selectPassages({ hits: [{ chunkKind: "page", pageNumber: 1 }], pages: many, question: "photosynthesis" });
  assert.ok(ps.length <= ASK_LIMITS.MAX_PASSAGES);
  assert.ok(ps.reduce((n, p) => n + p.text.length, 0) <= ASK_LIMITS.MAX_CONTEXT_CHARS);
});

test("the prompt grounds the model in numbered passages and demands [n] citations", () => {
  const ps = selectPassages({ hits, pages, question: "photosynthesis" });
  const msgs = buildAskMessages({ docName: "Biology notes", passages: ps, question: "What is photosynthesis?", history: [
    { role: "user", text: "earlier q" }, { role: "assistant", text: "earlier a [1]" },
  ] });
  assert.equal(msgs[0].role, "system");
  assert.match(msgs[0].content, /Use ONLY the numbered passages/);
  assert.match(msgs[0].content, /\[1\] \(page 3\)/);
  assert.match(msgs[0].content, /could not find it in this document/);
  assert.deepEqual(msgs.slice(1).map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(msgs.at(-1).content, "What is photosynthesis?");
});

test("citations: only markers the answer used, first-use order, unknown markers reported", () => {
  const ps = selectPassages({ hits, pages, question: "photosynthesis glucose" });
  const n = ps.find((p) => /converts light energy/.test(p.text)).n;
  const { citations, unknown } = extractCitations(`Light becomes chemical energy [${n}]. It is stored [${n}] in glucose [99].`, ps);
  assert.equal(citations.length, 1);
  assert.deepEqual([citations[0].n, citations[0].pageNumber, citations[0].bbox], [n, 3, [50, 100, 950, 300]]);
  assert.match(citations[0].quote, /converts light energy/);
  assert.deepEqual(unknown, [99]);
});

test("gatherPassages searches the OWNER's chunks for the record and falls back to opening pages", async () => {
  let asked = null;
  const r = await gatherPassages({
    target: { recordId: "rec-owner", ownerId: "owner-1", contentKey: null },
    question: "enzymes",
    search: async (args) => { asked = args; return [{ chunkKind: "paste", text: "enzymes lower activation energy", snippet: "enzymes…" }]; },
  });
  assert.deepEqual([asked.userId, asked.recordId, asked.full], ["owner-1", "rec-owner", true], "shared files search under the owner, full chunk text");
  assert.equal(r.indexed, true);
  assert.equal(r.passages[0].kind, "paste");

  const none = await gatherPassages({ target: { recordId: "r", ownerId: "o", contentKey: null }, question: "x", search: async () => [] });
  assert.equal(none.indexed, false, "an unindexed document says so");
});

test("routes: auth, shared-file access rule, streaming answer, saved turn, history", () => {
  assert.match(routesSrc, /router\.post\("\/ask", authenticateToken/);
  assert.match(routesSrc, /router\.get\("\/ask\/history", authenticateToken/);
  assert.match(routesSrc, /const id = await resolveContentAccess\(\{ userId, contentKey \}\);/, "shared files use the extraction access rule");
  assert.match(routesSrc, /resolveAskTargetFor\(\{ userId: req\.user\.id, recordId: src\?\.recordId, contentKey: src\?\.contentKey \}\)/);
  assert.match(routesSrc, /rec\.user_id !== userId\) return \{ status: 404/, "own records are owner-only");
  assert.match(routesSrc, /send\("delta", \{ text: delta \}\)/);
  assert.match(routesSrc, /extractCitations\(answer, passages\)/);
  assert.match(routesSrc, /saveAskTurn\(\{ userId: req\.user\.id, recordId: target\.recordId/);
  assert.match(routesSrc, /send\("done", payload\)/);
  assert.match(routesSrc, /isn't searchable yet/, "an unindexed document gets an honest answer, not a made-up one");
});

test("the thread table is private per learner and per document", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS edu\.record_chat_messages/);
  assert.match(migration, /user_id\s+UUID NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
  assert.match(migration, /record_id\s+UUID NOT NULL REFERENCES edu\.records\(id\) ON DELETE CASCADE/);
  assert.match(migration, /record_chat_messages_thread_idx\s+ON edu\.record_chat_messages\(user_id, record_id, created_at\)/);
  assert.ok(manifest.indexOf('"2026-record-chat.sql"') > manifest.indexOf('"2026-record-search.sql"'), "runs after the records/search migrations");
  assert.ok(contentWords("The photosynthesis of glucose").has("photosynthesis"));
});
