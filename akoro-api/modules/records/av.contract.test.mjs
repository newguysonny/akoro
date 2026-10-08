/**
 * modules/records/av.contract.test.mjs
 *
 * Guards the audio/video transcription lane (ffmpeg 16k-mono → Deepgram →
 * edu.record_transcripts → the reader's transcript panel):
 *   • the pure shaping behaves (scene-time parsing, segment shaping with
 *     diarized paragraphs + frame captions, grounding text);
 *   • the ffmpeg contract carries the §5 optimizations (16 kHz mono,
 *     scene-change sampling, never a fixed interval);
 *   • the routes authenticate, check ownership, 501 honestly when
 *     Deepgram isn't configured, and 409 on a running job;
 *   • the migration is registered and follows the learner-data rules;
 *   • the reader offers transcription, grounds from the transcript, and
 *     lists segments with click-to-seek.
 *
 * Everything runs offline — no ffmpeg, no Deepgram, no network.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

const [routesSrc, libSrc, appSrc, manifest, migration, envExample, deepgramSrc,
  teachSessionSrc, readerSrc, teachModalSrc, playerSrc, recordsApiSrc] = await Promise.all([
  read("routes.js"),
  read("avTranscribeLib.js"),
  read("../../app.js"),
  read("../../migrations/manifest.json"),
  read("../../migrations/2026-record-transcripts.sql"),
  read("../../.env.example"),
  read("../voice/deepgram.js"),
  read("../../../akoro-learner/src/components/library/RecordTeachSession.jsx"),
  read("../../../akoro-learner/src/components/teaching/SessionReaderModal.jsx"),
  read("../../../akoro-learner/src/components/teaching/TeachAgentModal.jsx"),
  read("../../../akoro-learner/src/components/library/MediaPlayer.jsx"),
  read("../../../akoro-learner/src/services/recordsApi.js"),
]);

const { parseSceneTimes, shapeSegments, transcriptText } = await import("./avTranscribeLib.js");

/* ── pure shaping ──────────────────────────────────────────────────────── */

test("parseSceneTimes reads ffmpeg showinfo stamps out of stderr", () => {
  const stderr = `[Parsed_showinfo_1 @ 0x…] n:   0 pts:  51200 pts_time:5.12\n` +
    `frame=2 fps=0.0 q=-0.0 size=N/A time=00:00:11.40 bitrate=N/A speed=212x\n` +
    `[Parsed_showinfo_1 @ 0x…] n:   1 pts: 261120 pts_time:26.112`;
  assert.deepEqual(parseSceneTimes(stderr), [5.12, 26.112]);
  assert.deepEqual(parseSceneTimes("no stamps here"), []);
  assert.deepEqual(parseSceneTimes(null), []);
});

test("shapeSegments: diarized paragraphs become speech rows in time order", () => {
  const rows = shapeSegments({
    paragraphs: [
      { speaker: 1, start: 12.4, end: 20.1, sentences: ["Today we cover osmosis."] },
      { speaker: 0, start: 0.0,  end: 12.0, sentences: ["Good morning, class.", "Open page forty."] },
    ],
    fullText: "Good morning, class. Open page forty. Today we cover osmosis.",
    duration: 20.1,
    frames: [],
    model: "deepgram/nova-2",
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, "speech");
  assert.equal(rows[0].start_ms, 0);
  assert.equal(rows[0].speaker, "Speaker 1");
  assert.equal(rows[1].speaker, "Speaker 2");
  assert.match(rows[1].text, /osmosis/);
  assert.equal(rows[0].model, "deepgram/nova-2");
});

test("shapeSegments: short clips fall back to one segment; frames land as visual rows", () => {
  const rows = shapeSegments({
    paragraphs: [],
    fullText: "Just one line.",
    duration: 3.2,
    frames: [{ tSec: 8.5, caption: "Mitosis — stage overview" }],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].text, "Just one line.");
  assert.equal(rows[0].end_ms, 3200);
  assert.equal(rows[1].kind, "visual");
  assert.equal(rows[1].start_ms, 8500);
  assert.equal(transcriptText(rows).split("\n\n").length, 2);
});

test("shapeSegments: nothing in, nothing out — the job reports it honestly", () => {
  assert.deepEqual(shapeSegments({ paragraphs: [], fullText: "", frames: [] }), []);
  assert.equal(transcriptText([]), "");
});

/* ── the ffmpeg + deepgram contract ────────────────────────────────────── */

test("the ffmpeg calls carry the §5 optimizations", () => {
  assert.match(libSrc, /"-ar", "16000"/, "16 kHz — the rate STT is built around");
  assert.match(libSrc, /"-ac", "1"/, "mono");
  assert.match(libSrc, /"-vn"/, "no video stream on the audio lane");
  assert.match(libSrc, /gt\(scene,\$\{threshold\}\)/, "frames sample at SCENE CHANGES");
  assert.doesNotMatch(libSrc, /fps=1\/\d+/, "never a fixed sampling interval");
  assert.match(libSrc, /FFMPEG_PATH/, "the worker.js ffmpeg convention is reused");
  assert.match(libSrc, /from "\.\.\/voice\/deepgram\.js"/, "the existing Deepgram client is reused");
  assert.match(libSrc, /transcribeFileDeepgram/, "nova-2 file transcription with diarization");
  assert.match(libSrc, /parsePageOnRunpod/, "slide captions default to OUR OWN parse worker");
  assert.match(libSrc, /recursive: true, force: true/, "the temp dir is removed at the end");
  assert.match(libSrc, /const db = await dbLazy\(\)/, "persistence loads the db lazily (test-importable)");
});

test("deepgram is asked for diarized, paragraph-shaped transcripts", () => {
  assert.match(deepgramSrc, /diarize:\s*true/, "speaker labels on");
  assert.match(deepgramSrc, /paragraphs:\s*true/, "natural-pause paragraphs (never fixed-window slicing)");
  assert.match(deepgramSrc, /utterances:\s*true/);
});

/* ── routes + migration + env ──────────────────────────────────────────── */

test("the transcribe routes authenticate, own-check, gate and single-run", () => {
  const postIdx = routesSrc.indexOf('router.post("/transcribe"');
  const fileIdx = routesSrc.indexOf('router.get("/:id/file"');
  assert.ok(postIdx !== -1, "the POST /transcribe route exists");
  assert.ok(postIdx < fileIdx, "registered before the generic /:id routes");
  assert.match(routesSrc, /router\.post\("\/transcribe", authenticateToken/);
  assert.match(routesSrc, /router\.get\("\/transcribe\/:recordId", authenticateToken/);
  assert.match(routesSrc, /rec\.user_id !== req\.user\.id/, "ownership checked before any bytes move");
  assert.match(routesSrc, /avEnabled\(\)/, "the enabled gate exists");
  assert.match(routesSrc, /Transcription isn't configured/, "the honest 501");
  assert.match(routesSrc, /409/, "a running job can't double-start");
  assert.match(routesSrc, /createPresignedDownload\(rec\.file_key/, "the original downloads via presigned URL");
  assert.match(routesSrc, /Only audio and video records transcribe/, "audio/video kinds only");
  assert.match(appSrc, /from "\.\/modules\/records\/routes\.js"|recordsModule/, "records module is mounted");
});

test("the migration exists, is registered, and follows the learner-data rules", () => {
  assert.match(manifest, /2026-record-transcripts\.sql/, "registered in the manifest");
  assert.match(migration, /REFERENCES public\.users\(id\) ON DELETE CASCADE/, "rows die with their learner");
  assert.match(migration, /REFERENCES edu\.records\(id\) ON DELETE CASCADE/, "rows die with their record");
  assert.match(migration, /kind IN \('speech', 'visual'\)/, "the two segment kinds");
  assert.match(migration, /record_transcripts_record_idx/, "the (record_id, start_ms) index for time-order reads");
});

test("the env contract is documented", () => {
  assert.match(envExample, /AV_FRAME_PROVIDER/);
  assert.match(envExample, /AV_MAX_FRAMES/);
  assert.match(envExample, /AV_SCENE_THRESHOLD/);
  assert.match(libSrc, /AV_FRAME_PROVIDER/, "and read by the lib");
});

/* ── the reader ────────────────────────────────────────────────────────── */

test("the reader offers transcription, grounds from it, and lists segments with click-to-seek", () => {
  assert.match(teachSessionSrc, /startRecordTranscription/, "the offer starts the job");
  assert.match(teachSessionSrc, /getRecordTranscriptionStatus/, "the job is polled");
  assert.match(teachSessionSrc, /Transcribe this recording\?/, "the av offer overlay exists");
  assert.match(teachSessionSrc, /getRecordTranscript\(record\.id\)/, "the cache is consulted before spending money");
  assert.match(teachSessionSrc, /setAvTranscript/, "the transcript state feeds grounding + the panel");
  assert.match(teachSessionSrc, /transcript: avTranscript/, "the content carries it to the reader");
  assert.match(teachModalSrc, /transcript: content\.transcript \|\| null/, "TeachAgentModal forwards it");
  assert.match(readerSrc, /transcript = null/, "the reader accepts it");
  assert.match(readerSrc, /seekTo\?\.\(\(s\.startMs \|\| 0\) \/ 1000\)/, "a segment click seeks the recording");
  assert.match(readerSrc, /SLIDE/, "visual (frame-caption) rows are labelled");
  assert.match(playerSrc, /const seekTo = useCallback/, "the player exposes an absolute seek");
  assert.match(recordsApiSrc, /\/api\/records\/transcribe\//, "the service seam points at the new routes");
});
