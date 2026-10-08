/**
 * modules/records/extract.contract.test.mjs
 *
 * Guards the record text-extraction pipeline (hanji-parse-4b on RunPod →
 * edu.record_extractions → the reader):
 *   • the lib's pure shaping behaves (bbox JSON parsing, reading order,
 *     markdown rendering, <image>/<hw> sentinels);
 *   • a page really round-trips through a MOCKED RunPod /runsync (offline —
 *     no network in the test environment);
 *   • the routes keep their contract: auth, ownership, caps, the honest
 *     501 when unconfigured, per-page idempotent persistence;
 *   • the reader side rasterizes client-side and offers extraction for
 *     scanned PDFs / images;
 *   • the migration is registered and the worker ships the prompt contract.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

const [routesSrc, libSrc, appSrc, manifest, recordsMigration, teachSessionSrc, extractPagesSrc, recordsApiSrc, workerSrc, pdfPagesSrc, readerSrc, teachModalSrc] = await Promise.all([
  read("routes.js"),
  read("extractLib.js"),
  read("../../app.js"),
  read("../../migrations/manifest.json"),
  read("../../migrations/2026-record-extractions.sql"),
  read("../../../akoro-learner/src/components/library/RecordTeachSession.jsx"),
  read("../../../akoro-learner/src/components/library/extractPages.js"),
  read("../../../akoro-learner/src/services/recordsApi.js"),
  read("../../../runpod-worker/handler.py"),
  read("../../../akoro-learner/src/components/library/PdfPages.jsx"),
  read("../../../akoro-learner/src/components/teaching/SessionReaderModal.jsx"),
  read("../../../akoro-learner/src/components/teaching/TeachAgentModal.jsx"),
]);

const { parseBlocks, sortBlocks, blocksToMarkdown, parsePageOnRunpod, recordsExtractionEnabled } =
  await import("./extractLib.js");

/* ── pure shaping ──────────────────────────────────────────────────────── */

test("parseBlocks extracts the bbox array out of a fenced / noisy completion", () => {
  const raw = '```json\n[{"bbox_2d":[10,20,300,80],"text_content":"Visit Date: 08/12/2025"},' +
    '{"bbox_2d":[10,90,300,400],"text_content":"| Item | Qty |\\n|---|---|\\n| Aspirin | 2 |"}]\n```';
  const blocks = parseBlocks(raw);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0].bbox_2d, [10, 20, 300, 80]);
  assert.match(blocks[1].text_content, /\| Item \| Qty \|/);
  assert.deepEqual(parseBlocks("no array here at all"), []);
  assert.deepEqual(parseBlocks(""), []);
});

test("sortBlocks orders reading-style: top-to-bottom, then left-to-right", () => {
  const sorted = sortBlocks([
    { bbox_2d: [500, 10, 900, 50], text_content: "right header" },
    { bbox_2d: [10, 10, 400, 60],  text_content: "left header" },
    { bbox_2d: [10, 100, 400, 200], text_content: "body" },
  ]);
  assert.deepEqual(sorted.map((b) => b.text_content), ["left header", "right header", "body"]);
});

test("blocksToMarkdown: reading order, hw marker stripped, figures become a placeholder", () => {
  const md = blocksToMarkdown([
    { bbox_2d: [10, 300, 400, 380], text_content: "<image>" },
    { bbox_2d: [10, 10, 400, 80],   text_content: "<hw>J.T.</hw> signed above" },
    { bbox_2d: [10, 90, 400, 260],  text_content: "Diagnosis: malaria" },
  ]);
  const lines = md.split("\n\n");
  assert.deepEqual(lines, ["J.T. signed above", "Diagnosis: malaria", "*[figure]*"]);
  assert.equal(blocksToMarkdown([]), "");
  assert.equal(blocksToMarkdown(null), "");
});

/* ── the RunPod round-trip, offline via a mock ─────────────────────────── */

const ENDPOINT = "test-endpoint-id";

function withEnv(fn) {
  const oldKey = process.env.RUNPOD_API_KEY, oldId = process.env.RUNPOD_PARSE_ENDPOINT_ID;
  process.env.RUNPOD_API_KEY = "rpa_test";
  process.env.RUNPOD_PARSE_ENDPOINT_ID = ENDPOINT;
  return Promise.resolve(fn()).finally(() => {
    if (oldKey === undefined) delete process.env.RUNPOD_API_KEY; else process.env.RUNPOD_API_KEY = oldKey;
    if (oldId === undefined) delete process.env.RUNPOD_PARSE_ENDPOINT_ID; else process.env.RUNPOD_PARSE_ENDPOINT_ID = oldId;
  });
}

test("parsePageOnRunpod: one page → runsync → blocks + markdown; the image rides as image_b64", async () => {
  let captured;
  const mockFetch = async (url, opts = {}) => {
    captured = { url, body: JSON.parse(opts.body || "{}"), auth: opts.headers?.authorization };
    return new Response(JSON.stringify({
      id: "job-1", status: "COMPLETED",
      output: {
        raw: '[{"bbox_2d":[10,10,400,60],"text_content":"Chapter 3"}]',
        blocks: [{ bbox_2d: [10, 10, 400, 60], text_content: "Chapter 3" }],
        model: "hanji-dev/hanji-parse-4b",
      },
    }), { status: 200 });
  };

  await withEnv(async () => {
    const out = await parsePageOnRunpod({ imageBase64: "aGVsbG8=", fetchImpl: mockFetch });
    assert.match(captured.url, new RegExp(`/v2/${ENDPOINT}/runsync`));
    assert.equal(captured.auth, "Bearer rpa_test");
    assert.equal(captured.body.input.image_b64, "aGVsbG8=");
    assert.equal(captured.body.input.max_new_tokens, 8192);
    assert.equal(out.markdown, "Chapter 3");
    assert.equal(out.blocks.length, 1);
    assert.equal(out.model, "hanji-dev/hanji-parse-4b");
  });
});

test("parsePageOnRunpod: queue failures throw, incomplete statuses throw, unconfigured throws", async () => {
  const notCompleted = async () => new Response(JSON.stringify({ id: "j", status: "IN_QUEUE" }), { status: 200 });
  const http500 = async () => new Response("boom", { status: 500 });
  const workerError = async () => new Response(JSON.stringify({ status: "COMPLETED", output: { error: "image_b64 is not a valid image" } }), { status: 200 });

  await withEnv(async () => {
    await assert.rejects(() => parsePageOnRunpod({ imageBase64: "x", fetchImpl: notCompleted }), /IN_QUEUE/);
    await assert.rejects(() => parsePageOnRunpod({ imageBase64: "x", fetchImpl: http500 }), /HTTP 500/);
    await assert.rejects(() => parsePageOnRunpod({ imageBase64: "x", fetchImpl: workerError }), /not a valid image/);
  });

  const hadKey = delete process.env.RUNPOD_API_KEY;
  try {
    await assert.rejects(() => parsePageOnRunpod({ imageBase64: "x", fetchImpl: async () => new Response("{}", { status: 200 }) }), /not configured/);
    assert.equal(recordsExtractionEnabled(), false);
  } finally {
    if (hadKey === false) process.env.RUNPOD_API_KEY = "rpa_test";   // restore for later tests
  }
});

/* ── route + wiring contract ───────────────────────────────────────────── */

test("the extract routes authenticate, check ownership, cap batches, and 501 honestly", () => {
  const postIdx = routesSrc.indexOf('router.post("/extract"');
  const patchIdx = routesSrc.indexOf('router.patch("/:id"');
  assert.ok(postIdx !== -1 && patchIdx !== -1, "the POST /extract route exists");
  assert.ok(postIdx < patchIdx, "registered before the generic /:id routes");

  assert.match(routesSrc, /router\.post\("\/extract", authenticateToken/, "POST /extract is learner-authenticated");
  assert.match(routesSrc, /router\.get\("\/extract\/:recordId", authenticateToken/, "GET /extract/:recordId is learner-authenticated");
  assert.match(routesSrc, /\.eq\("user_id", userId\)\.maybeSingle\(\)/, "ownership is checked before any parsing");
  assert.match(routesSrc, /recordsExtractionEnabled\(\)/, "the enabled gate exists");
  assert.match(routesSrc, /Text extraction isn't configured/, "the honest 501 message");
  assert.match(routesSrc, /MAX_PAGES_PER_REQUEST/, "the ≤8 pages-per-request cap is enforced");
  assert.match(routesSrc, /MAX_IMAGE_B64_CHARS/, "per-page image size cap");
  assert.match(routesSrc, /onConflict/, "the upsert (idempotent per page) is on the hot path via extractLib");
  assert.match(libSrc, /onConflict: "record_id,page_number"/, "persistence upserts per (record, page)");
});

test("the migration exists, is registered, and follows the learner-data rules", () => {
  assert.match(manifest, /2026-record-extractions\.sql/, "registered in the manifest");
  assert.match(recordsMigration, /REFERENCES public\.users\(id\) ON DELETE CASCADE/, "rows die with their learner");
  assert.match(recordsMigration, /REFERENCES edu\.records\(id\) ON DELETE CASCADE/, "rows die with their record");
  assert.match(recordsMigration, /UNIQUE \(record_id, page_number\)/, "idempotency key");
  assert.match(appSrc, /\/api\/records\/extract.*express\.json\(\{ limit: "25mb" \}/, "the route's raised body limit");
});

test("the reader rasterizes client-side and offers extraction for scans & images", () => {
  assert.match(extractPagesSrc, /from 'pdfjs-dist'/, "PDF pages rasterize with the already-loaded pdf.js");
  assert.match(extractPagesSrc, /TARGET_PIXELS\s*=\s*1_600_000/, "rendered a bit under the model's 2MP cap");
  assert.match(extractPagesSrc, /BATCH = 8/, "pages go up in ≤8-page batches");
  assert.match(teachSessionSrc, /Scanned document detected/, "the offer overlay exists");
  assert.match(teachSessionSrc, /getRecordExtraction/, "the cache is consulted before spending GPU time");
  assert.match(teachSessionSrc, /runRecordExtraction/, "the reader drives the batched run");
  assert.match(recordsApiSrc, /\/api\/records\/extract\//, "the service seam points at the new routes");
  // The layout overlay — stored bboxes become visible on the page
  assert.match(routesSrc, /parsed\.push\(\{ pageNumber, markdown, model, blocks \}\)/, "the POST response carries blocks back");
  assert.match(teachSessionSrc, /blocks=\{pdfBlocks\.get\(i \+ 1\)\}/, "the reader hands each page its blocks");
  assert.match(pdfPagesSrc, /export function PdfPage\(\{ pdf, pageNumber, blocks = null \}\)/, "PdfPage accepts blocks");
  assert.match(pdfPagesSrc, /x1 \/ 10/, "bbox 0-1000 → percent math (value/10)");
  assert.match(pdfPagesSrc, /Layout/, "the per-page Layout toggle chip exists");
  // Citations: generated tools carry the block bbox, citeJump flashes that region
  assert.match(readerSrc, /function blockBboxForOffset/, "sentences map back to their extraction block");
  assert.match(readerSrc, /sentenceCiteFor\(pageIndex, blockBboxForOffset/, "summary/quiz citations carry the block bbox");
  assert.match(readerSrc, /cite-bbox-flash/, "citeJump flashes the exact bbox region on the page");
  assert.match(readerSrc, /pageBlocks = null/, "the reader accepts per-page blocks");
  assert.match(teachModalSrc, /pageBlocks: content\.pageBlocks \|\| null/, "TeachAgentModal forwards pageBlocks to the reader");
  assert.match(teachSessionSrc, /pageBlocks: pages\.map/, "RecordTeachSession supplies the per-page blocks");
  // Extracted text becomes a selectable layer on the scan
  assert.match(pdfPagesSrc, /btxt-/, "block texts render as a transparent selectable layer");
  assert.match(pdfPagesSrc, /pointerEvents: 'auto', cursor: 'text'/, "spans capture selection; empty areas pass through");
});

test("the worker owns the prompt contract the model was fine-tuned on", () => {
  assert.match(workerSrc, /PRODUCTION_BBOX_2D_JSON_PROMPT/, "the production prompt ships with the worker");
  assert.match(workerSrc, /"<image>\\n" \+ PRODUCTION_BBOX_2D_JSON_PROMPT/, "the leading <image> prefix is part of the contract");
  assert.match(workerSrc, /QWEN_MAX_IMAGE_PIXELS.*2000000|MAX_PIXELS.*2000000/, "the training pixel cap");
  assert.match(workerSrc, /do_sample=False/, "greedy decode — the model is prompt-coupled, not chat");
  assert.match(workerSrc, /PARSE_MODEL_ALLOW_PROMPT/, "client prompts are ignored unless deliberately allowed");
});
