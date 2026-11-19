import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";

const {
  storedTextKindOf, runsToParagraphs, pdfPageFromParagraphs, pdfTextPages, textFilePages, extractStoredText, STORED_TEXT_LIMITS,
} = await import("./storedText.js");
const { keysNeedingText, backfillRecordText } = await import("./textBackfill.js");
const routes = await readFile(new URL("./routes.js", import.meta.url), "utf8")
  + await readFile(new URL("./service-records.js", import.meta.url), "utf8");   // the upload hook lives in the records service
const app = await readFile(new URL("../../app.js", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
const autoExtract = await readFile(new URL("../../../akoro-learner/src/components/library/extractPages.js", import.meta.url), "utf8");

test("what the server reads for free: PDFs, text files, Word, PowerPoint — nothing else", () => {
  assert.equal(storedTextKindOf("application/pdf", "a"), "pdf");
  assert.equal(storedTextKindOf("", "Notes.MD"), "text");
  assert.equal(storedTextKindOf("text/csv", "x"), "text");
  assert.equal(storedTextKindOf("", "deck.pptx"), "pptx");
  assert.equal(storedTextKindOf("image/png", "scan.png"), null);
  assert.equal(storedTextKindOf("audio/mpeg", "a.mp3"), null);
});

test("text runs → lines → paragraphs, with hyphenation joined and columns of runs spaced", () => {
  const run = (str, left, top, right, h = 12) => ({ str, left, right, top, bottom: top + h });
  const paras = runsToParagraphs([
    run("Photo", 50, 100, 80), run("synthesis is how", 82, 100.5, 200),  // same line, touching → no space
    run("plants make food from light. It needs chloro-", 50, 114, 400),
    run("phyll.", 50, 128, 90),
    run("Second", 50, 170, 100), run("paragraph", 104, 170, 170),          // gap → space; big vertical gap → new para
    run("   ", 50, 200, 60),                                                 // blank run dropped
  ]);
  assert.deepEqual(paras.map((p) => p.text), [
    "Photosynthesis is how plants make food from light. It needs chlorophyll.",
    "Second paragraph",
  ]);
  assert.deepEqual(paras[0].box, { left: 50, top: 100, right: 400, bottom: 140 });
  const page = pdfPageFromParagraphs(paras, 500, 1000);
  assert.deepEqual(page.blocks[0].bbox_2d, [100, 100, 800, 140]);
  assert.equal(page.markdown, "Photosynthesis is how plants make food from light. It needs chlorophyll.\n\nSecond paragraph");
  assert.deepEqual(page.size, { width: 500, height: 1000, unit: "pt" });
});

const makePdf = async (pagesText) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pagesText) {
    const page = doc.addPage([600, 800]);
    lines.forEach((t, i) => page.drawText(t, { x: 60, y: 720 - i * 20, size: 12, font }));
    if (!lines.length) page.drawRectangle({ x: 50, y: 50, width: 500, height: 700, borderWidth: 1 });
  }
  return Buffer.from(await doc.save());
};

test("a real PDF: text pages come back with boxes and the page size; a textless PDF is a scan", async () => {
  const pdf = await makePdf([
    ["Cell Biology", "The cell is the basic unit of life.", "Every organism is made of cells."],
    [],
    ["Mitochondria release energy from glucose in respiration."],
  ]);
  const out = await pdfTextPages(pdf);
  assert.equal(out.scanned, false);
  assert.equal(out.totalPages, 3);
  assert.deepEqual(out.pages.map((p) => p.pageNumber), [1, 3]);   // the blank page stays for tap-to-extract
  assert.match(out.pages[0].markdown, /Cell Biology[\s\S]*basic unit of life[\s\S]*made of cells/);
  assert.deepEqual(out.pages[0].size, { width: 600, height: 800, unit: "pt" });
  const [x1, y1, x2, y2] = out.pages[0].blocks[0].bbox_2d;
  assert.ok(x1 >= 90 && x1 <= 110 && y1 > 80 && y1 < 120 && x2 > x1 && y2 > y1, `box ${out.pages[0].blocks[0].bbox_2d}`);

  const scan = await pdfTextPages(await makePdf([[], []]));
  assert.equal(scan.scanned, true);
  assert.deepEqual(scan.pages, []);
});

test("text files: paragraphs, headings and long line runs (a CSV) become pages", () => {
  const csv = Array.from({ length: 200 }, (_, i) => `row${i},value ${i}`).join("\n");
  const pages = textFilePages(Buffer.from(`﻿# Notes\r\n\r\nFirst idea.\r\n\r\n${csv}`));
  assert.equal(pages[0].blocks[0].text_content, "# Notes");
  assert.equal(pages[0].blocks[1].text_content, "First idea.");
  const pieces = pages.flatMap((p) => p.blocks.map((b) => b.text_content)).filter((t) => t.startsWith("row"));
  assert.ok(pieces.length > 1 && pieces.every((t) => t.length <= STORED_TEXT_LIMITS.TEXT_PIECE_CHARS));
  assert.equal(pieces.join("\n"), csv);
});

const fakeLib = (log, { claim = true } = {}) => ({
  claimContentJob: async () => { log.push(["claim"]); return claim; },
  saveExtractionPages: async ({ model, pages }) => { log.push(["save", model, pages.length]); },
  finishContentJob: async (k, lane, status, result) => { log.push(["finish", status, result]); },
});

test("the flow: a text PDF is read, then claimed, saved, indexed (bill passed through), finished", async () => {
  const log = [];
  const pdf = await makePdf([["Osmosis moves water across a membrane by diffusion."]]);
  const out = await extractStoredText(
    { contentKey: "k", name: "a.pdf", mime: "application/pdf", fileUrl: "u", bill: false },
    { extractLib: fakeLib(log), indexByContentKey: async ({ bill }) => log.push(["index", bill]), download: async () => pdf },
  );
  assert.equal(out.status, "done");
  assert.deepEqual(log.map((l) => l[0]), ["claim", "save", "index", "finish"]);
  assert.equal(log[1][1], "pdf-text");
  assert.equal(log[2][1], false);
  assert.deepEqual(log[3][2], { mode: "text", pages: 1 });
});

test("a scan claims nothing at upload (the browser's RunPod run needs the claim); the backfill remembers it", async () => {
  const scanPdf = await makePdf([[]]);
  let log = [];
  const deps = () => ({ extractLib: fakeLib(log), indexByContentKey: async () => {}, download: async () => scanPdf });
  assert.equal((await extractStoredText({ contentKey: "k", name: "s.pdf", fileUrl: "u" }, deps())).status, "scanned");
  assert.deepEqual(log, []);
  assert.equal((await extractStoredText({ contentKey: "k", name: "s.pdf", fileUrl: "u", rememberScanned: true }, deps())).status, "scanned");
  assert.deepEqual(log, [["claim"], ["finish", "done", { mode: "text", scanned: true, pages: 0 }]]);
  // A held claim → running; images / audio → skipped.
  log = [];
  assert.equal((await extractStoredText({ contentKey: "k", name: "a.txt", fileUrl: "u" },
    { extractLib: fakeLib(log, { claim: false }), indexByContentKey: async () => {}, download: async () => Buffer.from("x") })).status, "running");
  assert.equal((await extractStoredText({ contentKey: "k", name: "a.png", mime: "image/png", fileUrl: "u" })).status, "skipped");
});

test("backfill: done, running, and server-judged files are skipped; RunPod-failed files are retried", () => {
  const need = keysNeedingText(
    ["parsed", "running", "judged", "office", "ocrFailed", "fresh"],
    ["parsed"],
    [
      { content_key: "running", status: "running", result: null },
      { content_key: "judged", status: "done", result: { mode: "text", scanned: true } },
      { content_key: "office", status: "failed", result: { mode: "office", error: "x" } },
      { content_key: "ocrFailed", status: "failed", result: { mode: "async" } },
    ],
  );
  assert.deepEqual([...need].sort(), ["fresh", "ocrFailed"]);
});

/* A tiny stand-in for the supabase query builder: every chain resolves
   through `answer(table, filters)`. */
function fakeDb(answer) {
  const chain = (table) => {
    const q = { table, filters: {} };
    const api = {
      select: () => api, order: () => api,
      eq: (k, v) => { q.filters[k] = v; return api; },
      not: (k) => { q.filters[`not:${k}`] = true; return api; },
      in: (k, v) => { q.filters[`in:${k}`] = v; return api; },
      range: (a, b) => { q.filters.range = [a, b]; return api; },
      then: (res, rej) => Promise.resolve(answer(q.table, q.filters)).then(res, rej),
    };
    return api;
  };
  return { schema: () => ({ from: chain }) };
}

test("backfill pass: readable uploads (one per shared key) are extracted unbilled; scans of images aren't touched; pastes get indexed", async () => {
  const records = [
    { id: "1", user_id: "u1", name: "notes.pdf", mime: "application/pdf", file_key: "kA" },
    { id: "2", user_id: "u2", name: "notes.pdf", mime: "application/pdf", file_key: "kA" },   // the same file, shared
    { id: "3", user_id: "u1", name: "photo.png", mime: "image/png", file_key: "kB" },
    { id: "4", user_id: "u1", name: "list.txt", mime: "text/plain", file_key: "kC" },
    { id: "5", user_id: "u1", name: "done.pdf", mime: "application/pdf", file_key: "kD" },
  ];
  const pastes = [{ id: "p1", user_id: "u1", name: "Paste", content: "Some notes" }, { id: "p2", user_id: "u1", name: "Indexed", content: "x" }];
  const db = fakeDb((table, f) => {
    if (table === "records" && f.kind === "upload") return { data: f.range[0] === 0 ? records : [] };
    if (table === "records" && f.kind === "paste") return { data: f.range[0] === 0 ? pastes : [] };
    if (table === "content_parses") return { data: [{ content_key: "kD" }] };
    if (table === "content_jobs") return { data: [] };
    if (table === "record_chunks") return { data: [{ record_id: "p2" }] };
    return { data: [] };
  });
  const extracted = [], indexed = [];
  const counts = await backfillRecordText({}, {
    db, log: () => {},
    presign: async (key) => `https://signed/${key}`,
    extract: async (args) => { extracted.push(args); return { status: "done" }; },
    indexRecord: async (args) => { indexed.push(args); },
  });
  assert.deepEqual(extracted.map((a) => [a.contentKey, a.userId, a.bill, a.rememberScanned]), [["kA", "u1", false, true], ["kC", "u1", false, true]]);
  assert.deepEqual(indexed.map((a) => [a.recordId, a.pasteText, a.bill]), [["p1", "Some notes", false]]);
  assert.equal(counts.files.done, 2);
  assert.equal(counts.files.already, 1);
  assert.equal(counts.pastes, 1);
});

test("wiring: extracted at upload, a retry route, a startup job, a script; the browser skips text PDFs", () => {
  assert.match(routes, /storedTextKindOf\(data\.mime, data\.name\)\)[\s\S]{0,300}extractStoredText\(/);
  assert.match(routes, /router\.post\(\["\/extract\/text", "\/extract\/office"\], authenticateToken/);
  assert.match(app, /skipJob\("record text backfill"\)[\s\S]{0,300}backfillRecordText\(\)/);
  assert.equal(pkg.scripts["records:backfill-text"], "node scripts/backfill-record-text.mjs");
  assert.match(autoExtract, /if \(!looksScanned\(texts \|\| \[\]\)\) return \{ status: 'skipped' \};/);   // textLayer.js: a repeated watermark isn't text
});
