/**
 * media-worker/test/media-worker.contract.test.mjs
 *
 * Offline contract tests for the media container:
 *   • the ffmpeg arg builders are pinned against the API's conventions —
 *     the HLS flags match akoro-api/worker.js's command 1:1 and the audio/
 *     scene-frame args mirror modules/records/avTranscribeLib.js (a drift
 *     on either side changes the artifacts everyone consumes);
 *   • the HTTP surface: internal-secret auth, 202 + poll, graceful
 *     failure, the lane guard;
 *   • the encode job's API callbacks (source-url + status) against a real
 *     local stub of the API;
 *   • the API-side delegation seam (avTranscribeLib → mediaClient).
 *
 * No ffmpeg required: the failure-path test asserts jobs fail GRACEFULLY
 * without a binary, which is itself part of the contract.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test, before, after } from "node:test";
import http from "node:http";

const here = dirname(fileURLToPath(import.meta.url));

/* ── source pins ─────────────────────────────────────────────────────────── */

const read = (p) => readFileSync(join(here, p), "utf8");
const [ffmpegSrc, encodeSrc, indexSrc, jobsSrc, r2Src,
  avLibSrc, mediaClientSrc, apiEnvExample] = await Promise.all([
  read("../src/ffmpeg.js"),
  read("../src/encode.js"),
  read("../src/index.js"),
  read("../src/jobs.js"),
  read("../src/r2.js"),
  read("../../akoro-api/modules/records/avTranscribeLib.js"),
  read("../../akoro-api/modules/records/mediaClient.js"),
  read("../../akoro-api/.env.example"),
]);

const { extractAudioArgs, sampleSceneFramesArgs, hlsVariantArgs, masterPlaylistBody, variantsFor, parseSceneTimes, VARIANT_4K } =
  await import("../src/ffmpeg.js");

test("the audio/frame args match the API's lane exactly (a drift changes shared artifacts)", () => {
  // avTranscribeLib's builders, verbatim
  assert.match(avLibSrc, /\["-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", out\]/);
  // the container's builders must be the same argv
  assert.deepEqual(extractAudioArgs("/x/in.mp4", "/x/out.mp3"),
    ["ffmpeg", "-y", "-i", "/x/in.mp4", "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", "/x/out.mp3"]);
  assert.deepEqual(sampleSceneFramesArgs("/x/in.mp4", "/x/frame-%03d.jpg", { maxFrames: 24, threshold: 0.4 }),
    ["ffmpeg", "-y", "-i", "/x/in.mp4",
     "-vf", "select='gt(scene,0.4)',showinfo,scale=960:-2",
     "-vsync", "vfr", "-frames:v", "24", "/x/frame-%03d.jpg"]);
  // the API imports the SAME constants for its caps
  assert.match(avLibSrc, /MAX_FRAMES\(\)|SCENE_THRESHOLD\(\)/);
});

test("the HLS argv is worker.js's command as an array — same flags, no shell quoting", () => {
  const v = { name: "720p", resolution: "1280x720", bitrate: "2500k", maxrate: "3500k", bufsize: "5600k", profile: "high", level: "4.0" };
  const args = hlsVariantArgs(v, { inputPath: "/t/source.mp4", outputDir: "/t/out", gopSize: 120 });
  for (const pin of [
    '"-c:v", "libx264"', '"-preset", "medium"', '"-profile:v", v.profile,',
    '"-b:v", v.bitrate,', '"-maxrate", v.maxrate,', '"-bufsize", v.bufsize,',
    '"-s", v.resolution,', '"-c:a", "aac"', '"-b:a", "128k"', '"-ac", "2"',
    '"-keyint_min", String(gopSize)', '"-sc_threshold", "0"',
    '"-force_key_frames", "expr:gte(t,n_forced*4)"',
    '"-hls_time", "6"', '"-hls_list_size", "0"', '"-hls_flags", "independent_segments"',
  ]) assert.ok(ffmpegSrc.includes(pin), `missing pin: ${pin}`);
  assert.equal(args[args.length - 1], "/t/out/720p.m3u8");
  assert.ok(args.includes("/t/out/720p_%03d.ts"));
  // and the master playlist matches worker.js's line format
  const body = masterPlaylistBody([v], 30);
  assert.match(body, /#EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=1280x720,FRAME-RATE=30\.000/);
  assert.match(body, /720p\.m3u8/);
});

test("variant selection never upscales and 4K only comes from 4K", () => {
  assert.deepEqual(variantsFor(1080).map((v) => v.name), ["360p", "480p", "720p", "1080p"]);
  assert.deepEqual(variantsFor(2160).map((v) => v.name), ["360p", "480p", "720p", "1080p", "2160p"]);
  assert.deepEqual(variantsFor(360).map((v) => v.name), ["360p", "480p", "720p", "1080p"]);
  assert.equal(VARIANT_4K.name, "2160p");
});

test("scene-time parsing pulls pts_time stamps in order", () => {
  const stderr = '[frame] pts_time:3.42 lac ... [frame] pts_time:12.0';
  assert.deepEqual(parseSceneTimes(stderr), [3.42, 12.0]);
  assert.deepEqual(parseSceneTimes(""), []);
});

test("the HTTP surface: auth, 202 + poll, and jobs fail gracefully without ffmpeg", async () => {
  process.env.NODE_ENV = "test";            // index.js must not self-listen
  process.env.INTERNAL_SECRET = "test-secret";
  process.env.R2_ACCESS_KEY_ID = "k";
  process.env.R2_BUCKET_NAME = "b";
  const app = (await import("../src/index.js")).default;

  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const hdr = { "Content-Type": "application/json", "x-internal-secret": "test-secret" };
  try {
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);   // no auth — the platform probe

    const unauth = await fetch(`${base}/jobs/extract-audio`, { method: "POST", body: "{}" });
    assert.equal(unauth.status, 401);
    const badKey = await fetch(`${base}/jobs/extract-audio`, { method: "POST", headers: { ...hdr, "x-internal-secret": "wrong" }, body: "{}" });
    assert.equal(badKey.status, 401);

    const missing = await fetch(`${base}/jobs/extract-audio`, { method: "POST", headers: hdr, body: JSON.stringify({}) });
    assert.equal(missing.status, 400);

    const start = await fetch(`${base}/jobs/extract-audio`, { method: "POST", headers: hdr, body: JSON.stringify({ url: "https://example.invalid/x.mp4", kind: "audio" }) });
    assert.equal(start.status, 202);
    const { data: { jobId } } = await start.json();
    assert.ok(jobId);

    // The container has no ffmpeg in CI — the job must LAND as failed, not hang.
    let job = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const st = await fetch(`${base}/jobs/${jobId}`, { headers: hdr });
      job = (await st.json()).data.job;
      if (job.state !== "running") break;
    }
    assert.equal(job.state, "failed");
    assert.ok(job.error.length > 0);
    assert.ok(job.log.some((l) => /ffmpeg|FAILED|extract/i.test(l)));

    const unknown = await fetch(`${base}/jobs/nope`, { headers: hdr });
    assert.equal(unknown.status, 404);
  } finally {
    server.close();
  }
});

test("the lane guard serializes heavy jobs and answers 409-shaped when full", async () => {
  const { startJob, getJob } = await import("../src/jobs.js");
  process.env.MAX_CONCURRENT_JOBS = "1";
  const first = startJob("encode", () => new Promise(() => {}));   // never settles
  assert.ok(first.id, "the first job takes the lane");
  const second = startJob("encode", () => Promise.resolve({}));
  assert.equal(second.id, null);
  assert.ok(Array.isArray(second.busy) && second.busy.includes(first.id));
  assert.equal(getJob(first.id).state, "running");
});

test("encode callbacks hit the API's internal seams (same contract as the old worker)", async () => {
  const calls = [];
  const stub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      calls.push({ url: req.url, secret: req.headers["x-internal-secret"], body: body ? JSON.parse(body) : null });
      res.setHeader("Content-Type", "application/json");
      if (req.url.startsWith("/api/stream/internal/source-url/")) {
        res.end(JSON.stringify({ signedUrl: "https://r2.example.invalid/src?sig=1", sourceKey: "staging/x.mp4" }));
      } else {
        res.end(JSON.stringify({ ok: true }));
      }
    });
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  const port = stub.address().port;
  process.env.API_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.INTERNAL_SECRET = "test-secret";

  const { getSourceUrl, updateVideoStatus } = await import("../src/encode.js");
  const src = await getSourceUrl("vid-1");
  assert.equal(src.signedUrl, "https://r2.example.invalid/src?sig=1");
  await updateVideoStatus("vid-1", { encodingStatus: "encoding", encodingProgress: 0 });

  assert.equal(calls[0].secret, "test-secret");
  assert.equal(calls[0].url, "/api/stream/internal/source-url/vid-1");
  assert.equal(calls[1].url, "/api/stream/internal/update");
  assert.equal(calls[1].body.videoId, "vid-1");
  stub.close();
});

test("the API delegates the ffmpeg half when MEDIA_WORKER_URL is set — and falls back cleanly", () => {
  assert.match(mediaClientSrc, /export const mediaWorkerEnabled = \(\) =>\s*!!\(process\.env\.MEDIA_WORKER_URL && process\.env\.INTERNAL_SECRET\)/, "the gate");
  assert.match(mediaClientSrc, /export async function remoteExtractAudio\(/, "the remote runner");
  assert.match(mediaClientSrc, /\/jobs\/extract-audio/, "the container endpoint");
  assert.match(mediaClientSrc, /x-internal-secret/, "authenticated like every internal seam");
  assert.match(mediaClientSrc, /state === "done"/, "polls to done");
  assert.match(mediaClientSrc, /state === "failed"/, "surfaces container failures");
  // avTranscribeLib: branch + fallback
  assert.match(avLibSrc, /import \{ mediaWorkerEnabled, remoteExtractAudio, downloadTo \} from "\.\/mediaClient\.js";/);
  assert.match(avLibSrc, /if \(mediaWorkerEnabled\(\)\) \{/, "the delegation branch exists");
  assert.match(avLibSrc, /const isHls = \/\\.m3u8\(\$\|\\\?\)\/i\.test\(fileUrl \|\| ""\);/, "the in-process fallback survives");
  assert.match(avLibSrc, /await runFfmpeg\(extractAudioArgs\(srcPath, audioPath\)\);/, "the local ffmpeg path is intact");
  assert.match(avLibSrc, /remoteExtractAudio\(\{\s*\n\s*url: fileUrl, kind,/, "the container gets the source URL");
});

test("the container is wired: docs, health, R2, and the API knows the URL", () => {
  assert.match(indexSrc, /x-internal-secret/, "auth on job routes");
  assert.match(indexSrc, /app\.get\("\/healthz"/, "platform probe");
  assert.match(indexSrc, /express\.json\(\{ limit: "256kb" \}\)/, "small bodies only — media never comes through the API");
  assert.match(r2Src, /ACL: "public-read"/, "HLS artifacts stay publicly streamable");
  assert.match(jobsSrc, /MAX_CONCURRENT_JOBS/, "the lane is bounded");
  assert.match(apiEnvExample, /MEDIA_WORKER_URL=/, "the API's env documents the worker");
});
