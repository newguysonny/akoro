/**
 * modules/courses/mediaEncodeQueue.js — the durable fan-out coordinator.
 *
 * Before this, an upload called POST /jobs/encode and either got a 202 or a
 * 409 "(lane busy) failed". This queue makes concurrency a scheduling
 * decision instead of a rejection:
 *
 *   upload → BullMQ "video-encode-fanout" → coordinator
 *     · POST /jobs/inspect on the planner container (ffprobe, variant list)
 *     · one POST /jobs/encode-variant per rendition, each on its own
 *       named container (video-<id>-360p, video-<id>-720p, …)
 *     · poll each container's job, then write hls/master.m3u8
 *
 * `MEDIA_ENCODE_VIDEOS` (default 2) is how many videos are in flight;
 * each fans out to ~4–5 variant containers. Combined with
 * `max_instances: 12`, two 4K videos fit. Every container still runs
 * exactly one heavy job (`MAX_CONCURRENT_JOBS=1`).
 *
 * Job data carries `plan` and per-variant `{container, jobId}` so a
 * BullMQ retry after an API restart resumes instead of restarting.
 */
import { Queue, Worker } from "bullmq";
import { PutObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { dispatchInspect, dispatchEncodeVariant, getEncodeJob, containerNameFor } from "./encodeDispatch.js";
import { VideoStore } from "./video-store.js";
import { r2Send } from "../../lib/r2Breaker.js";
import db from "../../db.js";
import { autoTranscribeContent } from "../records/index.js";

const QUEUE_NAME = "video-encode-fanout";
const R2_BUCKET = process.env.R2_BUCKET_NAME ?? "";
const R2_PUBLIC = String(process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, "");

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  },
});

export const mediaQueueEnabled = () =>
  !!(process.env.MEDIA_WORKER_URL && process.env.INTERNAL_SECRET);
export const mediaQueueWorkerReady = () => !!_worker;

const redisUrl = () => process.env.REDIS_URL ?? "redis://localhost:6379";
const queueConnection = () => ({ url: redisUrl(), maxRetriesPerRequest: 2, enableOfflineQueue: false });
const workerConnection = () => ({ url: redisUrl(), maxRetriesPerRequest: null });
let _queue = null;
let _worker = null;

export const MEDIA_ENCODE_VIDEOS = () =>
  Math.max(1, parseInt(process.env.MEDIA_ENCODE_VIDEOS ?? "2", 10) || 2);

function getQueue() {
  if (_queue) return _queue;
  _queue = new Queue(QUEUE_NAME, {
    connection: queueConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 20_000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
    },
  });
  return _queue;
}

/** A master playlist whose variant playlists live in <variant>/<variant>.m3u8. */
export function masterPlaylistBody(variants, frameRate) {
  const rate = Number(frameRate) || 30;
  const lines = ["#EXTM3U", "#EXT-X-VERSION:6", ""];
  for (const v of variants) {
    const bandwidth = parseInt(v.bitrate, 10) * 1000 + 128_000;
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${v.resolution},FRAME-RATE=${rate.toFixed(3)}`);
    lines.push(`${v.name}/${v.name}.m3u8`);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Enqueue one video. Idempotent per videoId: a waiting/active/delayed
 * duplicate returns the existing job; a completed/failed old job is
 * removed before re-adding (explicit user retry).
 */
export async function enqueueMediaEncode({ videoId, courseId, sourceKey, title = "" }) {
  if (!mediaQueueEnabled()) throw new Error("The media queue is not configured.");
  if (!mediaQueueWorkerReady()) throw new Error("The media queue worker is not running — using direct dispatch.");
  const queue = getQueue();
  const existing = await queue.getJob(String(videoId));
  if (existing) {
    const state = await existing.getState();
    if (["waiting", "active", "delayed", "prioritized"].includes(state)) return existing.id;
    await existing.remove().catch(() => {});
  }
  const job = await queue.add("video", { videoId, courseId, sourceKey, title }, { jobId: String(videoId) });
  return job.id;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function transcribeWhenLessonExists(videoUrl) {
  try {
    const { data: lesson } = await db.from("lessons")
      .select("id, title, video_url").eq("video_url", videoUrl).limit(1).maybeSingle();
    if (lesson) {
      void autoTranscribeContent({
        userId: null,
        contentKey: `lesson:${lesson.id}`,
        name: lesson.title,
        mime: "video/mp4",
        fileUrl: videoUrl,
      }).catch((err) => console.warn("[media-queue] auto-transcribe skipped:", String(err?.message || err).slice(0, 140)));
    }
  } catch (err) {
    console.warn("[media-queue] auto-transcribe lookup skipped:", String(err?.message || err).slice(0, 140));
  }
}

/** The queue processor — exported for a source-contract test. */
export async function processVideoJob(job) {
  const data = { ...job.data };
  const { videoId, courseId, sourceKey } = data;
  if (!videoId || !courseId || !sourceKey) throw new Error("A video job needs videoId, courseId and sourceKey.");

  const video = await VideoStore.get(videoId);
  if (!video) throw new Error(`Video ${videoId} no longer exists.`);
  if (video.encodingStatus === "completed") return { skipped: "completed" };

  await VideoStore.update(videoId, { encodingStatus: "encoding", encodingProgress: 2, errorMessage: null });

  // 1. Probe once and learn which renditions this source deserves.
  if (!data.plan) {
    data.plan = await dispatchInspect({ videoId, container: "planner" });
    await job.updateData(data);
  }
  const plan = data.plan;
  const variants = { ...(data.variants || {}) };

  // 2. Fan out: one named container per rendition. The updateData after each
  //    dispatch is the retry checkpoint (jobId + container survive a restart).
  for (const variant of plan.variants) {
    if (variants[variant.name]?.jobId) continue;
    const container = containerNameFor(videoId, variant.name);
    const jobId = await dispatchEncodeVariant({
      videoId, courseId, sourceKey, variant, frameRate: plan.frameRate, container,
    });
    variants[variant.name] = { container, jobId, state: "running" };
    data.variants = variants;
    await job.updateData(data);
  }

  // 3. Wait for every rendition. A lost/failed variant is cleared so the
  //    BullMQ retry re-dispatches only that rendition.
  for (;;) {
    let done = 0;
    for (const variant of plan.variants) {
      const state = variants[variant.name];
      if (state?.state === "completed") { done += 1; continue; }
      if (!state?.jobId) continue;

      let snapshot;
      try {
        snapshot = await getEncodeJob({ container: state.container, jobId: state.jobId });
      } catch (err) {
        if (err?.code === "JOB_NOT_FOUND") {
          variants[variant.name] = { ...state, jobId: null, state: "missing" };
          data.variants = variants;
          await job.updateData(data);
        }
        throw err;
      }

      if (!snapshot) {
        variants[variant.name] = { ...state, jobId: null, state: "missing" };
        data.variants = variants;
        await job.updateData(data);
        throw new Error(`Lost the ${variant.name} job state; re-dispatching.`);
      }

      if (snapshot.state === "done") {
        variants[variant.name] = { ...state, state: "completed", result: snapshot.result };
        data.variants = variants;
        await job.updateData(data);
        done += 1;
        const pct = Math.min(90, 5 + Math.round((done / plan.variants.length) * 85));
        await VideoStore.update(videoId, { encodingProgress: pct }).catch(() => {});
      } else if (snapshot?.state === "failed") {
        variants[variant.name] = { ...state, jobId: null, state: "failed" };
        data.variants = variants;
        await job.updateData(data);
        throw new Error(snapshot.error || `Variant ${variant.name} failed.`);
      }
    }
    if (done === plan.variants.length) break;
    await sleep(5000);
  }

  // 4. Finalise: master playlist, source cleanup, completion callback.
  if (!R2_BUCKET || !R2_PUBLIC) throw new Error("R2 is not configured for the media queue (bucket/public URL).");
  const hlsPath = `courses/${courseId}/videos/${videoId}/hls`;
  const masterKey = `${hlsPath}/master.m3u8`;
  await r2Send(r2, new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: masterKey,
    Body: masterPlaylistBody(plan.variants, plan.frameRate),
    ContentType: "application/vnd.apple.mpegurl",
    ACL: "public-read",
  }));
  const videoUrl = `${R2_PUBLIC}/${masterKey}`;

  await r2Send(r2, new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: sourceKey })).catch(() => {});

  await VideoStore.update(videoId, {
    encodingStatus: "completed",
    encodingProgress: 100,
    videoUrl,
    hlsPath,
    duration: plan.duration ?? null,
    fileSize: plan.fileSize || null,
    variants: plan.variants.map((v) => v.name),
    sourceKey: null,
    errorMessage: null,
  });

  await transcribeWhenLessonExists(videoUrl);
  console.log(`[media-queue] ✅ ${videoId} → ${videoUrl} (${plan.variants.map((v) => v.name).join(",")})`);
  return { videoUrl, variants: plan.variants.map((v) => v.name) };
}

/**
 * Start the coordinator. Called from lib/startWorkers after migrations, so
 * no worker can query a table before the deploy that creates it.
 */
export function startMediaEncodeWorker() {
  if (!mediaQueueEnabled() || !process.env.REDIS_URL) {
    if (mediaQueueEnabled()) console.warn("[media-queue] MEDIA_WORKER_URL set but REDIS_URL is missing — queue disabled");
    return null;
  }
  if (_worker) return _worker;

  _worker = new Worker(QUEUE_NAME, processVideoJob, {
    connection: workerConnection(),
    concurrency: MEDIA_ENCODE_VIDEOS(),
    lockDuration: 120_000,
    stalledInterval: 60_000,
    maxStalledCount: 3,   // survive Render auto-deploys during a long encode
  });

  _worker.on("failed", async (job, err) => {
    if (!job) return;
    const attempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade >= attempts) {
      await VideoStore.update(job.data.videoId, {
        encodingStatus: "failed",
        errorMessage: String(err?.message || err).slice(0, 500),
      }).catch(() => {});
    }
  });
  _worker.on("error", (err) => console.error("[media-queue] worker error:", String(err?.message || err).slice(0, 200)));
  console.log(`[media-queue] fan-out worker started (${MEDIA_ENCODE_VIDEOS()} videos concurrently, one job per container)`);
  return _worker;
}
