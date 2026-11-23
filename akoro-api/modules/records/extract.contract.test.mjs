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

const [routesSrc, libSrc, appSrc, manifest, recordsMigration, teachSessionSrc, extractPagesSrc, recordsApiSrc, workerSrc, pdfPagesSrc, readerSrc, teachModalSrc, extractionCardSrc, pharmdReaderSrc, blockLayerSrc] = await Promise.all([
  read("routes.js") + read("access.js") + read("rules.js") + read("service-extract.js") + read("service-records.js"),   // the access rule lives in access.js
  read("extractLib.js"),
  read("../../app.js"),
  read("../../migrations/manifest.json"),
  read("../../migrations/2026-content-cache.sql"),
  read("../../../akoro-learner/src/features/library/components/RecordTeachSession.jsx")
    + read("../../../akoro-learner/src/features/library/hooks/useRecordSession.js"),
  read("../../../akoro-learner/src/components/library/extractPages.js")
    + read("../../../akoro-learner/src/lib/extractRun.js"),
  read("../../../akoro-learner/src/services/recordsApi.js"),
  read("../../../runpod-worker/handler.py"),
  read("../../../akoro-learner/src/components/library/PdfPages.jsx"),
  read("../../../akoro-learner/src/features/teaching/components/SessionReaderModal.jsx")
    + read("../../../akoro-learner/src/features/teaching/components/sessionReaderModel.js")
    + read("../../../akoro-learner/src/features/teaching/hooks/useSessionReader.js"),
  read("../../../akoro-learner/src/features/teaching/components/TeachAgentModal.jsx"),
  read("../../../akoro-learner/src/components/library/ExtractionCard.jsx"),
  read("../../../akoro-learner/src/features/pharmd/components/PharmDTopicSession.jsx"),
  read("../../../akoro-learner/src/components/library/BlockTextLayer.jsx"),
]);

const { parseBlocks, sortBlocks, blocksToMarkdown, parsePageOnRunpod, recordsExtractionEnabled, runpodEndpointHealth } =
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

test("the extract routes: auth, ownership OR shared access, caps, claim, honest 501", () => {
  const postIdx = routesSrc.indexOf('router.post("/extract"');
  const patchIdx = routesSrc.indexOf('router.patch("/:id"');
  assert.ok(postIdx !== -1 && patchIdx !== -1, "the POST /extract route exists");
  assert.ok(postIdx < patchIdx, "registered before the generic /:id routes");

  assert.match(routesSrc, /router\.post\("\/extract", authenticateToken/, "POST /extract is learner-authenticated");
  assert.match(routesSrc, /router\.get\("\/extract\/:recordId", authenticateToken/, "GET /extract/:recordId is learner-authenticated");
  assert.match(routesSrc, /router\.get\("\/extract\/content\/:key", authenticateToken/, "the shared-content read route exists");
  assert.match(routesSrc, /rec\.user_id !== userId/, "your records stay owner-only");
  assert.match(routesSrc, /premiumIds\.includes\(rec\.user_id\)/, "shared keys pass the SAME rule the discovery feed uses");
  assert.match(routesSrc, /claimContentJob\(contentKey, "parse", req\.user\.id\)/, "single-flight claim before spending");
  assert.match(routesSrc, /finishContentJob\(contentKey, "parse"/, "the claim is released with a status");
  assert.match(routesSrc, /409/, "a concurrent first-open polls instead of double-spending");
  assert.match(routesSrc, /recordsExtractionEnabled\(\)/, "the enabled gate exists");
  assert.match(routesSrc, /Text extraction isn't configured/, "the honest 501 message");
  assert.match(routesSrc, /MAX_PAGES_PER_REQUEST/, "the ≤8 pages-per-request cap is enforced");
  assert.match(routesSrc, /MAX_IMAGE_B64_CHARS/, "per-page image size cap");
  assert.match(libSrc, /onConflict: "content_key,page_number"/, "persistence upserts per (file, page)");
  assert.match(routesSrc, /contentKey: r\.file_key/, "discover-open hands back the shared cache key");
});

test("the shared content cache: file-keyed rows, single-flight claims", () => {
  assert.match(manifest, /2026-content-cache\.sql/, "registered in the manifest");
  assert.ok(!manifest.includes("2026-record-extractions.sql"), "the per-record table is gone — cache is file-keyed");
  assert.match(recordsMigration, /UNIQUE \(content_key, page_number\)/, "idempotency per file+page");
  assert.match(recordsMigration, /PRIMARY KEY \(content_key, lane\)/, "one claim per file+lane");
  assert.match(recordsMigration, /CHECK \(lane IN \('parse', 'av'\)\)/, "both lanes share the claim table");
  assert.match(recordsMigration, /ON DELETE SET NULL/, "shared cache outlives the user who ran the job");
  assert.match(appSrc, /\/api\/records\/extract.*express\.json\(\{ limit: "25mb" \}/, "the route's raised body limit");
});

test("the reader rasterizes client-side and offers extraction for scans & images", () => {
  assert.match(extractPagesSrc, /from 'pdfjs-dist'/, "PDF pages rasterize with the already-loaded pdf.js");
  assert.match(extractPagesSrc, /TARGET_PIXELS\s*=\s*1_600_000/, "rendered a bit under the model's 2MP cap");
  assert.match(extractPagesSrc, /EXTRACT_BATCH_PAGES/, "pages go up in bounded batches");
  assert.match(extractionCardSrc, /Extract text/, "the shared offer overlay exists");
  assert.match(teachSessionSrc, /<ExtractionCard/, "the Library reader reuses the shared card");
  assert.match(pharmdReaderSrc, /RecordTeachSession/, "the PHARM.D reader is the shared reader");
  assert.match(teachSessionSrc, /getSharedExtraction\(record\.contentKey\)/, "shared files read the shared cache before spending");
  assert.match(recordsApiSrc, /export async function getSharedExtraction/, "the shared-cache seam exists");
  assert.match(teachSessionSrc, /runRecordExtraction/, "the reader drives the batched run");
  assert.match(recordsApiSrc, /\/api\/records\/extract\//, "the service seam points at the new routes");
  // The layout overlay — stored bboxes become visible on the page
  assert.match(routesSrc, /saved\.push\(\{ pageNumber: entry\.pageNumber, markdown: settled\.markdown, model: settled\.model, blocks: settled\.blocks/, "the status poll carries blocks back");
  assert.match(teachSessionSrc, /blocks=\{pdfBlocks\.get\(i \+ 1\)\}/, "the reader hands each page its blocks");
  assert.match(pdfPagesSrc, /export function PdfPage\(\{ pdf, pageNumber, blocks = null/, "PdfPage accepts blocks");
  assert.match(pdfPagesSrc, /x1 \/ 10/, "bbox 0-1000 → percent math (value/10)");
  assert.match(pdfPagesSrc, /Layout/, "the per-page Layout toggle chip exists");
  // Citations: generated tools carry the block bbox, citeJump flashes that region
  assert.match(readerSrc, /function blockBboxForOffset/, "sentences map back to their extraction block");
  assert.match(readerSrc, /sentenceCiteFor\(pageIndex, blockBboxForOffset/, "summary/quiz citations carry the block bbox");
  assert.match(readerSrc, /cite-bbox-flash/, "citeJump flashes the exact bbox region on the page");
  assert.match(readerSrc, /pageBlocks = null/, "the reader accepts per-page blocks");
  assert.match(teachModalSrc, /pageBlocks: content\.pageBlocks \|\| null/, "TeachAgentModal forwards pageBlocks to the reader");
  assert.match(teachSessionSrc, /pageBlocks: pages\.map/, "RecordTeachSession supplies the per-page blocks");
  // Extracted text becomes a selectable layer on the scan (shared with images)
  const blockLayerSrc = read("../../../akoro-learner/src/components/library/BlockTextLayer.jsx");
  assert.match(pdfPagesSrc, /<BlockTextLayer blocks=\{blockList\}/, "block texts render as a transparent selectable layer");
  assert.match(blockLayerSrc, /pointerEvents: 'auto', cursor: 'text'/, "spans capture selection; empty areas pass through");
  assert.match(blockLayerSrc, /scaleX\(/, "one-line blocks stretch to their box, so marks cover the printed words");
});

test("the worker owns the prompt contract the model was fine-tuned on", () => {
  assert.match(workerSrc, /PRODUCTION_BBOX_2D_JSON_PROMPT/, "the production prompt ships with the worker");
  assert.match(workerSrc, /PRODUCTION_PROMPT = PRODUCTION_BBOX_2D_JSON_PROMPT/, "unwrapped — the obsolete <image> prefix caused tokens: 0, features N (fixed in parse-worker v1.0.3)");
  // The prompt is sent as a user turn inside the model's chat template, with
  // the assistant turn opened — Hanji's own server (serving/server.py) does
  // exactly this. A bare prompt made the chat fine-tune end its turn at once:
  // COMPLETED in ~1 s with empty output (2026-10-10).
  assert.match(workerSrc, /apply_chat_template\(messages, tokenize=False, add_generation_prompt=True\)/, "the model's own chat template, assistant turn opened");
  assert.match(workerSrc, /<\|vision_start\|><\|image_pad\|><\|vision_end\|>/, "Qwen3-VL placeholder — the processor expands <|image_pad|> to the exact visual token count");
  assert.doesNotMatch(workerSrc, /"<image>\\n" \+ PRODUCTION/, "the obsolete <image> prefix must never return");
  assert.match(workerSrc, /QWEN_MAX_IMAGE_PIXELS.*2000000|MAX_PIXELS.*2000000/, "the training pixel cap");
  assert.match(workerSrc, /do_sample=False/, "greedy decode — the model is prompt-coupled");
  assert.match(workerSrc, /PARSE_MODEL_ALLOW_PROMPT/, "client prompts are ignored unless deliberately allowed");
});

test("runpodEndpointHealth — the /health deep probe of the parse endpoint", async () => {
  // unconfigured → a clear throw, before any network call
  delete process.env.RUNPOD_API_KEY;
  delete process.env.RUNPOD_PARSE_ENDPOINT_ID;
  await assert.rejects(() => runpodEndpointHealth(), /not configured/);

  // configured → GET /v2/:id/health with the bearer key, latency attached
  process.env.RUNPOD_API_KEY = "rpa_test";
  process.env.RUNPOD_PARSE_ENDPOINT_ID = "ep_test_123";
  let seen = null;
  const fetchImpl = async (url, opts = {}) => {
    seen = { url, opts };
    return { ok: true, status: 200, json: async () => ({ status: "healthy", jobs: { completed: 2, failed: 0, in_queue: 0 }, workers: { idle: 1, running: 0 } }) };
  };
  const d = await runpodEndpointHealth({ fetchImpl });
  assert.equal(seen.url, "https://api.runpod.ai/v2/ep_test_123/health");
  assert.equal(seen.opts.headers.authorization, "Bearer rpa_test");
  assert.ok(seen.opts.signal instanceof AbortSignal, "bounded by an AbortController");
  assert.equal(d.status, "healthy");
  assert.equal(d.workers.idle, 1);
  assert.ok(Number.isFinite(d.latencyMs), "latencyMs rides the result");

  // non-200 → readable throw; abort → timeout message
  await assert.rejects(
    () => runpodEndpointHealth({ fetchImpl: async () => ({ ok: false, status: 503 }) }),
    /HTTP 503/,
  );
  await assert.rejects(
    // a fetch that honors the signal, like the real one
    () => runpodEndpointHealth({ timeoutMs: 1, fetchImpl: (url, opts = {}) =>
      new Promise((_, reject) => opts.signal?.addEventListener("abort",
        () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))) }),
    /timed out/,
  );
  delete process.env.RUNPOD_API_KEY;
  delete process.env.RUNPOD_PARSE_ENDPOINT_ID;

  // the /health wiring: config always reported, probe deep-only, never gated
  const appJs = read("../../app.js");
  assert.match(appJs, /runpod: \{/, "/health reports the RunPod block");
  assert.match(appJs, /configured: recordsExtractionEnabled\(\)/);
  assert.match(appJs, /keyPresent: !!process\.env\.RUNPOD_API_KEY/, "key presence, never the key");
  assert.match(appJs, /endpointId: process\.env\.RUNPOD_PARSE_ENDPOINT_ID \|\| null/);
  assert.match(appJs, /deep && recordsExtractionEnabled\(\) \? await probeRunpod\(\) : null/,
    "the live probe rides ?deep=1 only");
  assert.match(appJs, /must not restart the API/, "never gates the health status — Render restarts on failing checks");
});

/* ── The async extract lane: submit (POST) → collect (GET /extract/status) ── */

test("settleParseJob: real pages save, '[]' is a blank page, an empty answer is a FAILURE", async () => {
  const { settleParseJob, PARSE_JOB_DEADLINE_MS } = await import("./extractLib.js");
  const done = (output) => ({ status: "COMPLETED", output });

  const page = settleParseJob(done({ raw: '[{"bbox_2d":[10,20,500,80],"text_content":"Photosynthesis"}]', model: "m" }));
  assert.equal(page.state, "saved");
  assert.equal(page.blank, false);
  assert.equal(page.markdown, "Photosynthesis");
  assert.equal(page.model, "m");

  const blank = settleParseJob(done({ raw: " [] ", blocks: [] }));
  assert.deepEqual([blank.state, blank.blank, blank.markdown], ["saved", true, ""], "the prompt's contract for an empty page is exactly []");

  const empty = settleParseJob(done({ raw: "", blocks: [] }));
  assert.equal(empty.state, "failed", "an empty answer is the model ending its turn — never a blank page");
  assert.match(empty.error, /ended its answer immediately/);

  const garbled = settleParseJob(done({ raw: "Sorry, I cannot", blocks: [] }));
  assert.equal(garbled.state, "failed");
  assert.equal(garbled.rawPreview, "Sorry, I cannot");

  assert.equal(settleParseJob(done({ error: "Model unavailable: no cache" })).state, "failed");
  assert.match(settleParseJob({ status: "FAILED" }).error, /Parse job FAILED/);
  assert.equal(settleParseJob({ status: "IN_QUEUE" }).state, "pending");
  const now = Date.now();
  const late = settleParseJob({ status: "IN_PROGRESS" }, { submittedAt: new Date(now - PARSE_JOB_DEADLINE_MS - 1000).toISOString(), now });
  assert.equal(late.state, "failed", "a page stuck past the deadline fails instead of holding the file forever");
});

test("POST /extract submits and returns at once; GET /extract/status collects and releases the claim", () => {
  const post = routesSrc.slice(routesSrc.indexOf("export async function submitExtract"), routesSrc.indexOf("export async function extractStatus"));
  const status = routesSrc.slice(routesSrc.indexOf("export async function extractStatus"), routesSrc.indexOf("export async function getRecordExtraction"));
  assert.ok(post.length > 0 && status.length > 0, "both routes exist, status registered BEFORE /extract/:recordId");

  // No GPU work rides the request: submit via /run, never /runsync.
  assert.match(post, /parsePageRunAsync\(\{ imageBase64: b64 \}\)/);
  assert.doesNotMatch(post, /parsePageOnRunpod/);
  assert.match(post, /res\.status\(202\)/);

  // Validation happens BEFORE the claim — a 400 can no longer leave the file locked.
  const blobStart = post.indexOf("Send at least one rendered page.");
  const claim = post.indexOf("claimContentJob(", blobStart);
  const lastValidation = post.lastIndexOf("return res400(", claim);
  assert.ok(lastValidation !== -1 && claim > lastValidation, "every 400 returns before the claim is taken");
  assert.match(post, /await finishContentJob\(contentKey, "parse", "failed"/, "a batch nobody accepted releases the claim");
  assert.match(post, /await updateContentJob\(contentKey, "parse", \{ mode: "async", submittedAt, jobs \}\)/);

  // The poll settles each job, saves real/blank pages, reports failures, and
  // releases the claim when nothing is pending (the next batch can go).
  assert.match(status, /settleParseJob\(polled, \{ submittedAt: batch\.submittedAt \}\)/);
  assert.match(status, /await saveExtractionPage\(/);
  assert.match(status, /entry\.state = "failed"/);
  assert.match(status, /if \(done\) \{[\s\S]*?await finishContentJob\(contentKey, "parse", ok \? "done" : "failed"/);
  assert.match(status, /resolveAiContent\(probe\)/, "the same ownership / shared-access rule as POST");
});

test("the reader submits, polls, stops on close, and never re-pays for saved pages", () => {
  assert.match(recordsApiSrc, /export async function getExtractionStatus/);
  assert.match(recordsApiSrc, /\/api\/records\/extract\/status\?/);
  assert.match(extractPagesSrc, /if \(e\?\.status !== 409\) throw e;/, "409 → help finish the running batch, then submit");
  assert.match(extractPagesSrc, /if \(isCancelled\(\)\) return STOPPED;/);
  assert.match(extractPagesSrc, /EXTRACT_BATCH_DEADLINE_MS/, "bounded polling");
  assert.match(teachSessionSrc, /isCancelled: \(\) => !aliveRef\.current/, "polling stops when the reader closes");
  assert.match(teachSessionSrc, /const toSend = rendered\.filter\(\(p\) => !have\.has\(p\.pageNumber\)\)/, "a retry only sends missing pages");
  assert.match(teachSessionSrc, /contentKey: record\.contentKey \|\| null/, "shared files extract under their content key");
});

test("page sizes ride the extraction: real points/pixels stored, 0-1000 boxes map back", async () => {
  const { boxToPageCoords } = await import("./extractLib.js");
  assert.deepEqual(boxToPageCoords([100, 500, 900, 1000], { width: 612, height: 792, unit: "pt" }), { x1: 61.2, y1: 396, x2: 550.8, y2: 792, unit: "pt" });
  assert.equal(boxToPageCoords([0, 0, 10, 10], null), null, "unknown size → null, never a guess");
  // The reader sends the real size; the route validates it, the job keeps it, the save stores it.
  assert.match(extractPagesSrc, /width: Math\.round\(base\.width \* 100\) \/ 100, height: Math\.round\(base\.height \* 100\) \/ 100, unit: 'pt'/);
  assert.match(extractPagesSrc, /unit: 'px'/);
  assert.match(routesSrc, /function pageSizeOf\(p\)/);
  assert.match(routesSrc, /size: entry\.size \|\| null/);
  assert.match(libSrc, /\.\.\.\(size \? \{ width: size\.width, height: size\.height, unit: size\.unit \} : \{\}\)/);
  assert.match(libSrc, /select\("page_number, markdown, blocks, model, width, height, unit, updated_at"\)/);
  const migration = read("../../migrations/2026-content-page-size.sql");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS width\s+NUMERIC/);
  assert.match(migration, /unit IN \('pt', 'px'\)/);
});

test("the extracted-markdown layer is safe to enable on large files", () => {
  assert.match(blockLayerSrc, /const inkCache = new WeakMap/, "ink line detection is cached per extraction");
  assert.match(blockLayerSrc, /const layoutCache = new WeakMap/, "line layout is cached per extraction");
  assert.match(blockLayerSrc, /surface\.width \|\| surface\.naturalWidth/, "an evicted canvas never poisons the cache");
  assert.match(blockLayerSrc, /bySize\.has\(sizeKey\)/, "a repaint reuses the stored ink lines");
  assert.match(pdfPagesSrc, /\{near && wrapW > 0 && \(hasText === false/, "the markdown layer mounts only near the viewport");
  assert.match(pdfPagesSrc, /setNear\(false\);\s+\/\/ the extracted text layer unmounts with the canvas/, "distant pages unmount it");
  assert.match(pdfPagesSrc, /const blockList = useMemo\(/, "the block array is stable across scroll renders");
  assert.doesNotMatch(pdfPagesSrc, /selectionOverlay\/>/, "pdf.js stays the default selectable layer");
});

test("PHARM.D topics share one extraction key and pass the access rule", () => {
  const pharmd = read("../pharmd/routes.js");
  assert.match(pharmd, /contentKey: pharmdContentKey\(t\)/, "topics hand back the versioned shared key");
  assert.match(pharmd, /file_hash: t\.file_hash/, "the client can derive the key");
  assert.match(read("../../lib/contentKey.js"), /export const PHARMD_PREFIX = "pharmd:"/, "one definition of the PHARM.D key space");
  assert.match(routesSrc, /parsePharmdKey\(contentKey\)/, "access parses the versioned key");
  assert.match(routesSrc, /contentKey\.startsWith\(PHARMD_PREFIX\)\) return resolvePharmdContent/, "pharmd keys resolve as shared content");
  assert.match(routesSrc, /from\("pharmd_topics"\)/, "the topic row is the authority for the file");
  // One reader: the PHARM.D adapter hands the shared reader a document SOURCE.
  assert.match(pharmdReaderSrc, /RecordTeachSession/, "the topic opens the Library reader");
  assert.match(pharmdReaderSrc, /contentKey: topic\.contentKey/, "the shared key rides on the source");
  assert.match(pharmdReaderSrc, /fileUrl: topic\.file_url/, "the catalogue file rides on the source");
});

test("a heavy PDF opens before every page is read; selection stays on the PDF layer", () => {
  const addRecord = read("../../../akoro-learner/src/components/dashboard/AddRecordModal.jsx");
  assert.match(pdfPagesSrc, /EAGER_TEXT_PAGES/, "text is read for the opening pages first");
  assert.match(pdfPagesSrc, /textsReady/, "the full read finishes in the background");
  assert.match(pdfPagesSrc, /new Array\(pdf\.numPages\)\.fill\(''\)/, "page indexes are stable while text fills in");
  assert.match(pdfPagesSrc, /DOC_CACHE_BYTES_MAX/, "the document cache is bounded by bytes");
  assert.match(extractPagesSrc, /\(\{ pdf \} = await loadPdfDocument/, "the PDF opens once for text and rasterising");
  assert.match(extractPagesSrc, /looksScanned\(texts\)/, "text PDFs still skip the paid parse");
  assert.match(extractPagesSrc, /p\.model !== 'pdf-text'/, "model pages replace the free pdf-text pages");
  assert.doesNotMatch(teachSessionSrc, /selectionOverlay\/>/, "text PDFs keep the pdf.js selectable layer");
  assert.match(readerSrc, /bestRatio = 0\.12/, "a tall page still selects in the pager");
  assert.match(readerSrc, /setCurrentPage\(targetPage\)/, "a citation jump selects its page at once");
  assert.match(pdfPagesSrc, /akoro:reader-textlayer/, "a page can build its text layer without painting");
  assert.match(pdfPagesSrc, /const buildLayer = async/, "layer building is width-aware and on demand");
  assert.match(readerSrc, /buildSkippedLayers\(\)/, "a citation jump builds the layers it skipped");
  assert.match(readerSrc, /Math\.min\(currentPage, targetPage\)/, "only the skipped range is built");
  assert.doesNotMatch(addRecord, /records\.mine/, "the upload sheet no longer lists My records");
  assert.doesNotMatch(addRecord, /deleteRecord|setRecordProgress/, "the removed history took its handlers with it");
});
