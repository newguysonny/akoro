/**
 * modules/courses/stream-encode-dispatch.contract.test.mjs
 *
 * Guards the encode-lane flip: when MEDIA_WORKER_URL is set, a course-video
 * upload is dispatched to the media container (POST /jobs/encode) and NO
 * BullMQ encode queue is opened — media moves container ↔ R2 and never
 * passes through the API. When unset, the BullMQ path survives unchanged.
 *
 * The container then drives the same /api/stream/internal/* callbacks the
 * old worker did, so status polling and the auto-transcribe hook are
 * untouched — those seams are pinned here too.
 *
 * Everything runs offline: the dispatch test runs against an in-process
 * stub container via injected fetch.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

const [streamSrc, mediaClientSrc, envExample, mwReadme, dispatchSrc, mediaQueueSrc] = await Promise.all([
  read("stream.js"),
  read("../records/mediaClient.js"),
  read("../../.env.example"),
  read("../../../media-worker/README.md"),
  read("encodeDispatch.js"),
  read("mediaEncodeQueue.js"),
]);

test("container mode enqueues the fan-out lane; the direct call remains a fallback", () => {
  assert.match(streamSrc, /import \{ mediaWorkerEnabled \}\s+from "\.\.\/records\/index\.js";/, "the shared gate (records' module entry)");
  assert.match(streamSrc, /import \{ enqueueMediaEncode \}\s+from "\.\/mediaEncodeQueue\.js";/, "the queue seam");
  assert.match(streamSrc, /import \{ dispatchEncode \}\s+from "\.\/encodeDispatch\.js";/, "direct dispatch survives as the fallback");
  assert.match(dispatchSrc, /export async function dispatchEncode\(/, "the legacy dispatch helper exists");
  assert.match(dispatchSrc, /export async function dispatchEncodeVariant\(/, "one variant per container");
  assert.match(dispatchSrc, /export async function dispatchInspect\(/, "the planner probe");
  assert.match(dispatchSrc, /export async function getEncodeJob\(/, "polling on the accepting container");
  assert.match(dispatchSrc, /instance=\$\{encodeURIComponent\(container\)\}/, "container names are routed, not collapsed to singleton");
  assert.match(streamSrc, /const encodingQueue = mediaWorkerEnabled\(\) \? null : new Queue\("video-encoding"/, "the old local queue is not opened when the container owns encode");
  assert.match(dispatchSrc, /\/jobs\/encode/, "the legacy endpoint");
  assert.match(dispatchSrc, /"x-internal-secret": process\.env\.INTERNAL_SECRET \?\? ""/, "authenticated like every internal seam");
  assert.match(dispatchSrc, /if \(res\.status === 409\) \{[\s\S]*?lane is busy/, "a busy lane fails loudly so the queue can retry");
  assert.match(dispatchSrc, /if \(!data\?\.jobId\) throw new Error\("The media worker did not return a job id\."\)/, "the container's job id is required");
});

test("the fan-out coordinator: one queue job per video, one container per variant", () => {
  assert.match(mediaQueueSrc, /const QUEUE_NAME = "video-encode-fanout"/, "durable queue name");
  assert.match(mediaQueueSrc, /new Queue\(QUEUE_NAME/, "durable queue");
  assert.match(mediaQueueSrc, /new Worker\(QUEUE_NAME, processVideoJob/, "the coordinator worker");
  assert.match(mediaQueueSrc, /MEDIA_ENCODE_VIDEOS/, "videos-in-flight is configurable");
  assert.match(mediaQueueSrc, /dispatchInspect\(\{ videoId, container: "planner" \}\)/, "ffprobe once");
  assert.match(mediaQueueSrc, /dispatchEncodeVariant\(\{[\s\S]*?container,/, "each variant gets its own container");
  assert.match(mediaQueueSrc, /job\.updateData\(data\)/, "retry checkpoints persist plan/job ids");
  assert.match(mediaQueueSrc, /getEncodeJob\(\{ container: state\.container, jobId: state\.jobId \}\)/, "poll the same container");
  assert.match(mediaQueueSrc, /masterPlaylistBody\(plan\.variants, plan\.frameRate\)/, "the coordinator writes the master");
  assert.match(mediaQueueSrc, /\$\{v\.name\}\/\$\{v\.name\}\.m3u8/, "nested variant playlists");
  assert.match(mediaQueueSrc, /encodingStatus: "completed"/, "final status");
});

test("the upload handler: container first, BullMQ fallback, honest failure", () => {
  assert.match(streamSrc, /if \(encodingQueue\) \{/, "the queue is the fallback branch");
  assert.match(streamSrc, /jobId = await dispatchEncode\(\{ videoId, courseId, sourceKey \}\);/, "container mode dispatches with the staged source key");
  assert.match(streamSrc, /via = "media-worker";/, "the response says which lane took the job");
  // a dispatch failure must not leave the record "queued" forever
  assert.match(streamSrc, /encodingStatus: "failed",\s*\n\s*errorMessage: `Encoding could not be dispatched/, "dispatch failure marks the record failed");
  assert.match(streamSrc, /re-upload to retry/, "…and says so to the instructor");
});

test("status polling degrades gracefully without the queue", () => {
  assert.match(streamSrc, /if \(encodingQueue\) \{\s*\n\s*const jobs = await encodingQueue\.getJobs/, "queue introspection only in fallback mode");
  assert.match(streamSrc, /queueState:\s*activeJob\?\.state\s*\?\? null/, "the response shape survives (null queue fields in container mode)");
});

test("the container's callbacks land on the same internal seams (nothing downstream changes)", () => {
  // the container calls these — guarded by x-internal-secret, as before
  assert.match(streamSrc, /getSourceUrl: asyncHandler\(async \(req, res\) => \{\s*\n\s*if \(!internalGuard\(req, res\)\) return;/, "source-url stays secret-guarded");
  assert.match(streamSrc, /internalUpdate: asyncHandler\(async \(req, res\) => \{\s*\n\s*if \(!internalGuard\(req, res\)\) return;/, "status update stays secret-guarded");
  assert.match(streamSrc, /const internalGuard = \(req, res\) => \{ let ok = false; requireSharedSecret\("INTERNAL_SECRET"\)/, "fails closed, constant-time");
  // and the completion hook still auto-transcribes the finished lesson
  assert.match(streamSrc, /data\.encodingStatus === "completed" && updated\.videoUrl/, "the always-extract hook still fires on completion");
});

test("the dispatch helper behaves against a real (stub) container", async () => {
  process.env.MEDIA_WORKER_URL = "https://mw.invalid";
  process.env.INTERNAL_SECRET = "test-secret";
  const { dispatchEncode } = await import("./encodeDispatch.js");

  const seen = [];
  const ok = async (url, init) => {
    seen.push({ url: String(url), secret: init?.headers?.["x-internal-secret"], body: JSON.parse(init?.body || "{}") });
    return new Response(JSON.stringify({ success: true, data: { jobId: "job-123" } }), {
      status: 202, headers: { "Content-Type": "application/json" },
    });
  };
  const jobId = await dispatchEncode({ videoId: "v1", courseId: "c1", sourceKey: "staging/v1.mp4" }, { fetchImpl: ok });
  assert.equal(jobId, "job-123");
  assert.equal(seen[0].url, "https://mw.invalid/jobs/encode");
  assert.equal(seen[0].secret, "test-secret");
  assert.deepEqual(seen[0].body, { videoId: "v1", courseId: "c1", sourceKey: "staging/v1.mp4" });

  const busy = async () => new Response(JSON.stringify({ error: "busy" }), { status: 409, headers: { "Content-Type": "application/json" } });
  await assert.rejects(() => dispatchEncode({ videoId: "v2", courseId: "c1", sourceKey: "s" }, { fetchImpl: busy }), /lane is busy/);

  const reject = async () => new Response(JSON.stringify({ error: "nope" }), { status: 500, headers: { "Content-Type": "application/json" } });
  await assert.rejects(() => dispatchEncode({ videoId: "v3", courseId: "c1", sourceKey: "s" }, { fetchImpl: reject }), /rejected the job \(500\)/);
});

test("the docs tell the operator the truth about standing the old worker down", () => {
  assert.match(envExample, /BOTH heavy lanes leave this server/, "the env documents encode + transcription delegation");
  assert.match(envExample, /VIDEO_WORKER_ENABLED=false/, "…and how to stand the BullMQ worker down");
  assert.match(mwReadme, /Encode lane.*flipped/, "the media-worker README records the flip");
  assert.match(mediaClientSrc, /MEDIA_WORKER_URL/, "the transcription lane's gate reads the same env");
});
