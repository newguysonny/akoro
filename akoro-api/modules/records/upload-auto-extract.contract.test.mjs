/**
 * modules/records/upload-auto-extract.contract.test.mjs
 *
 * Guards the "always extract" rule: a file's text exists BEFORE anyone
 * opens it. Whoever brings the file pays the one-time cost, in the
 * background, at the moment the file lands:
 *
 *   • learner A/V upload → POST /api/records fires the transcription;
 *   • learner PDF/image upload → the uploader's browser rasterizes and
 *     parses immediately, in the sheet (AddRecordModal → extractUpload),
 *     which shows progress and any failure with a retry;
 *   • course video → the lesson create/update hooks AND the encode
 *     worker's completion callback fire it for lesson:<id>.
 *
 * Every hook is claim-first (edu.content_jobs) so all of them collapsing
 * on one file is ONE job, and every hook fails without taking its
 * trigger's response down. The reader's manual offer remains as retry.
 *
 * Everything runs offline — no ffmpeg, no Deepgram, no RunPod, no browser.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

const [avLibSrc, routesSrc, lessonSrc, streamSrc, envExample,
  extractPagesSrc, modalSrc, manifest] = await Promise.all([
  read("avTranscribeLib.js"),
  read("routes.js") + read("service-records.js"),
  read("../courses/course-content.js"),
  read("../courses/stream.js"),
  read("../../.env.example"),
  read("../../../akoro-learner/src/components/library/extractPages.js"),
  read("../../../akoro-learner/src/components/dashboard/AddRecordModal.jsx"),
  read("../../migrations/manifest.json"),
]);

test("the engine: gated, claim-first, kind-checked, and it cannot throw", () => {
  assert.match(avLibSrc, /export function avKindOf\(/, "one pure kind check every hook shares");
  assert.match(avLibSrc, /export const autoTranscribeEnabled = \(\) => process\.env\.AUTO_TRANSCRIBE_UPLOADS !== "0"/, "ON by default; a deployment can opt out");
  assert.match(avLibSrc, /if \(!avEnabled\(\) \|\| !autoTranscribeEnabled\(\)\) return;/, "no Deepgram, no auto lane");
  assert.match(avLibSrc, /const claimed = await claimContentJob\(contentKey, "av", userId\);\n    if \(!claimed\) return;/, "claim-first — many triggers, ONE transcription");
  assert.match(avLibSrc, /export async function autoTranscribeContent\(/, "the engine exists");
  assert.match(avLibSrc, /} catch \(e\) \{\n    console\.warn\("\[av\] auto-transcribe skipped:/, "the engine itself never throws into its trigger");
  assert.match(avLibSrc, /await indexByContentKey\(\{ contentKey, segments: result\.segments \}\)/, "the finished transcript feeds the search index");
  assert.match(avLibSrc, /"failed", \{ error:/, "a failure marks the job failed — re-claimable, the reader's offer retries it");
});

test("learner A/V uploads transcribe themselves at registration", () => {
  const createIdx = routesSrc.indexOf("router.post(\"/\"");
  const hookIdx = routesSrc.indexOf("autoTranscribeContent({");
  assert.ok(createIdx !== -1 && hookIdx !== -1 && hookIdx > createIdx, "the hook runs from the create flow");
  assert.match(routesSrc, /data\.kind === "upload" && data\.file_key && avEnabled\(\) && autoTranscribeEnabled\(\) && avKindOf\(data\.mime, data\.name\)/, "only real uploads with an A/V lane, only when armed");
  assert.match(routesSrc, /createPresignedDownload\(data\.file_key, \{ downloadName: data\.name \}\)/, "the fresh file signs its own download");
  assert.match(routesSrc, /\.catch\(\(\) => \{\}\);/, "and it never fails the create");
});

test("course videos transcribe themselves wherever video_url lands", () => {
  // lesson create + update hooks
  assert.match(lessonSrc, /const fireLessonTranscription = \(lesson, userId\) => \{/, "the lesson hook helper exists");
  assert.match(lessonSrc, /fireLessonTranscription\(data, req\.user\?\.id\);\n    res201/, "a lesson created with a video queues its transcription");
  assert.match(lessonSrc, /if \(updates\.video_url !== undefined\) fireLessonTranscription\(data, req\.user\?\.id\);/, "setting/patching video_url queues it too");
  assert.match(lessonSrc, /contentKey: `lesson:\$\{lesson\.id\}`/, "the shared per-lesson cache key");
  assert.match(lessonSrc, /import \{ autoTranscribeContent \} from "\.\.\/records\/index\.js";/, "reuses the records lane — no second pipeline");
  // encode-completion callback
  assert.match(streamSrc, /data\.encodingStatus === "completed" && updated\.videoUrl/, "fires the moment the encode lands in the bucket");
  assert.match(streamSrc, /\.eq\("video_url", updated\.videoUrl\)/, "finds the lesson already pointing at this URL");
  assert.match(streamSrc, /void autoTranscribeContent\(\{\n            userId: null,/, "worker-triggered — no user to attribute (started_by is nullable)");
  assert.match(streamSrc, /auto-transcribe lookup skipped/, "a failed lookup never fails the worker's callback");
});

test("learner PDF/image uploads parse themselves in the uploader's browser", () => {
  assert.match(extractPagesSrc, /export async function extractUpload\(record, \{ onProgress, isCancelled \} = \{\}\)/, "the reported extractor exists");
  assert.match(extractPagesSrc, /export async function autoExtractUpload\(/, "and its silent wrapper");
  assert.match(extractPagesSrc, /record\.kind !== 'upload' \|\| !record\.fileUrl/, "only real uploads with a file");
  assert.match(extractPagesSrc, /const isPdf   = record\.mime === 'application\/pdf'/, "PDFs rasterize");
  assert.ok(extractPagesSrc.includes("const isImage = /^image\\//.test(record.mime || '')"), "images rasterize");
  assert.ok(extractPagesSrc.includes("const isPdf   = record.mime === 'application/pdf'"), "pdfs rasterize");
  assert.match(extractPagesSrc, /rasterizePdfPages\(pdf,/, "the reader's own rasterizer, reused");
  assert.match(extractPagesSrc, /runRecordExtraction\(\{\s*recordId: record\.id, pages,/, "the reader's own batcher, reused");
  assert.match(extractPagesSrc, /return \{ status: 'error', error: res\.error, done, total \}/, "a failure is REPORTED to the sheet");
  assert.match(extractPagesSrc, /\} catch \{ \/\* silent/, "fails silent — the reader's offer remains");
  assert.match(modalSrc, /const created = await createRecord\(\{ kind: 'upload'/, "the upload modal keeps the created record");
  assert.match(modalSrc, /void runExtract\(created\);/, "and fires extraction the moment it exists");
  assert.match(modalSrc, /import \{ extractUpload \} from '\.\.\/library\/extractPages\.js';/, "one pipeline, reused");
  assert.match(modalSrc, /Extraction didn't finish[\s\S]{0,1600}onClick=\{\(\) => runExtract\(ext\.record\)\}/, "a failure shows in the sheet, with a retry");
});

test("the opt-out is documented, and nothing new needs registering", () => {
  assert.match(envExample, /AUTO_TRANSCRIBE_UPLOADS=0 opts a deployment out/, "the env is documented");
  assert.match(envExample, /# AUTO_TRANSCRIBE_UPLOADS=1/, "…with its default");
  const parsed = JSON.parse(manifest);
  assert.ok(parsed.schema.includes("2026-content-cache.sql"), "no new tables — the cache and claims already exist");
});
