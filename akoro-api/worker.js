/**
 * worker.js  —  Piabam Encoding Worker
 *
 * Runs on: VPS (Hetzner / DigitalOcean) — requires FFmpeg
 * Does NOT run on Railway.
 *
 * Start:
 *   node worker.js
 *
 * Scale by running the same file on more servers:
 *   Server A:  node worker.js
 *   Server B:  node worker.js   ← same file, same .env REDIS_URL
 *   Server C:  node worker.js   ← BullMQ distributes jobs automatically
 *
 * Option A flow (no shared disk needed):
 *   1. Pick up job from Redis queue
 *   2. Ask API for a signed R2 URL  →  GET /internal/source-url/:videoId
 *   3. Download source video from R2 signed URL  →  local /tmp
 *   4. Run FFmpeg  →  multi-resolution HLS in local /encoded
 *   5. Upload all HLS files to R2 public prefix
 *   6. Delete the R2 staging source file
 *   7. Call API back  →  POST /internal/update  (status + CDN URL)
 *   8. Clean up local temp + encoded files
 *
 * ─── Sections ────────────────────────────────────────────────────────────────
 *  § IMPORTS
 *  § CONFIG
 *  § R2 CLIENT           download source + upload HLS + delete staging
 *  § FFMPEG              probe + multi-resolution HLS encode
 *  § API CALLBACKS       getSourceUrl + updateVideoStatus
 *  § WORKER              BullMQ consumer
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Install on VPS:
 *   sudo apt update && sudo apt install -y ffmpeg
 *   node --version   # must be 18+
 *   npm install
 *   cp .env.example .env   # fill in REDIS_URL, API_BASE_URL, INTERNAL_SECRET, R2_*
 *   node worker.js
 *
 * Environment variables (.env):
 *   REDIS_URL              redis://default:password@host:6379
 *   API_BASE_URL           https://api.akoro.app
 *   INTERNAL_SECRET        same value as API server
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET_NAME
 *   R2_PUBLIC_URL          https://cdn.akoro.app
 *   FFMPEG_PATH            default: ffmpeg
 *   FFPROBE_PATH           default: ffprobe
 *   WORKER_CONCURRENCY     default: 1
 *   TEMP_DIR               default: ./temp
 */

// ─── § IMPORTS ────────────────────────────────────────────────────────────────

import "dotenv/config";
import { Worker, QueueEvents }  from "bullmq";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
}                               from "@aws-sdk/client-s3";
import { exec }                 from "child_process";
import { promisify }            from "util";
import fs                       from "fs/promises";
import { createWriteStream }    from "fs";
import path                     from "path";
import { fileURLToPath }        from "url";
import https                    from "https";
import http                     from "http";
import { workerJob }              from "./lib/workerLog.js";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── § CONFIG ─────────────────────────────────────────────────────────────────

const FFMPEG_PATH  = process.env.FFMPEG_PATH       ?? "ffmpeg";
const FFPROBE_PATH = process.env.FFPROBE_PATH      ?? "ffprobe";
const TEMP_DIR     = process.env.TEMP_DIR          ?? path.join(__dirname, "temp");
const ENCODED_DIR  = path.join(__dirname, "encoded");
const CONCURRENCY  = parseInt(process.env.WORKER_CONCURRENCY ?? "1", 10);
const API_BASE_URL = process.env.API_BASE_URL      ?? "http://localhost:4000";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? "";

const R2_BUCKET  = process.env.R2_BUCKET_NAME ?? "";
const R2_PUBLIC  = process.env.R2_PUBLIC_URL  ?? "";
const R2_ENABLED = !!(process.env.R2_ACCESS_KEY_ID && R2_BUCKET);

const REDIS_CONN = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };

// Stand-down switch for per-command-billed Redis: set VIDEO_WORKER_ENABLED=false
// and the worker exits before opening any Redis connection (zero commands).
if (String(process.env.VIDEO_WORKER_ENABLED ?? "true").trim().toLowerCase() === "false") {
  console.log("[worker] VIDEO_WORKER_ENABLED=false — standing down (no Redis connection)");
  process.exit(0);
}

// Ensure local dirs exist
await fs.mkdir(TEMP_DIR,    { recursive: true });
await fs.mkdir(ENCODED_DIR, { recursive: true });

// ─── § R2 CLIENT ──────────────────────────────────────────────────────────────

const r2 = new S3Client({
  region:      "auto",
  endpoint:    `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID     ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  },
});

const getContentType = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  return {
    ".m3u8": "application/vnd.apple.mpegurl",
    ".ts":   "video/MP2T",
    ".json": "application/json",
    ".jpg":  "image/jpeg",
    ".png":  "image/png",
  }[ext] ?? "application/octet-stream";
};

/**
 * downloadFromSignedUrl
 * Downloads a file from any HTTPS URL (the R2 signed URL) to a local path.
 * Uses native http/https so no extra dependencies are needed.
 */
const downloadFromSignedUrl = (signedUrl, destPath) =>
  new Promise((resolve, reject) => {
    const proto  = signedUrl.startsWith("https") ? https : http;
    const file   = createWriteStream(destPath);
    let received = 0;

    proto.get(signedUrl, (res) => {
      const total = parseInt(res.headers["content-length"] ?? "0", 10);
      res.on("data", (chunk) => {
        received += chunk.length;
        if (total) process.stdout.write(
          `\r[worker] ⬇️  Downloading source  ${((received / total) * 100).toFixed(1)}%   `
        );
      });
      res.pipe(file);
      file.on("finish", () => { process.stdout.write("\n"); file.close(resolve); });
    }).on("error", (err) => { fs.unlink(destPath).catch(() => {}); reject(err); });
  });

/**
 * uploadDirToR2
 * Uploads every file in localDir to R2 under r2Prefix (public-read).
 * Returns the public master.m3u8 CDN URL.
 */
const uploadDirToR2 = async (localDir, r2Prefix) => {
  const files = await fs.readdir(localDir);

  await Promise.all(files.map(async (file) => {
    const content = await fs.readFile(path.join(localDir, file));
    await r2.send(new PutObjectCommand({
      Bucket:      R2_BUCKET,
      Key:         `${r2Prefix}/${file}`,
      Body:        content,
      ContentType: getContentType(file),
      ACL:         "public-read",   // students stream directly from CDN
    }));
    process.stdout.write(`[worker] ☁️  Uploaded  ${r2Prefix}/${file}\n`);
  }));

  return `${R2_PUBLIC}/${r2Prefix}/master.m3u8`;
};

/**
 * deleteR2Object
 * Deletes the staging source file from R2 after successful encode + upload.
 * Keeps R2 storage lean — only final HLS files are retained.
 */
const deleteR2Object = async (key) => {
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  console.log(`[worker] 🗑  Deleted staging source  key=${key}`);
};

// ─── § FFMPEG ─────────────────────────────────────────────────────────────────

const BASE_VARIANTS = [
  { name: "360p",  resolution: "640x360",   bitrate: "800k",   maxrate: "1000k",  bufsize: "1600k",  profile: "main", level: "3.1" },
  { name: "480p",  resolution: "854x480",   bitrate: "1500k",  maxrate: "2000k",  bufsize: "3200k",  profile: "main", level: "3.1" },
  { name: "720p",  resolution: "1280x720",  bitrate: "2500k",  maxrate: "3500k",  bufsize: "5600k",  profile: "high", level: "4.0" },
  { name: "1080p", resolution: "1920x1080", bitrate: "5000k",  maxrate: "7000k",  bufsize: "11200k", profile: "high", level: "4.2" },
];
const VARIANT_4K = {
  name: "2160p", resolution: "3840x2160",
  bitrate: "12000k", maxrate: "16000k", bufsize: "25600k",
  profile: "high", level: "5.1",
};

/**
 * probeVideo
 * ffprobe the source file and return key metadata.
 * Returns { width, height, frameRate, duration, fileSize }
 */
const probeVideo = async (inputPath) => {
  const { stdout } = await execAsync(
    `${FFPROBE_PATH} -v quiet -print_format json -show_streams -show_format "${inputPath}"`
  );
  const info        = JSON.parse(stdout);
  const vs          = info.streams.find((s) => s.codec_type === "video");
  const [num, den]  = (vs.avg_frame_rate ?? "30/1").split("/").map(Number);
  const stats       = await fs.stat(inputPath);

  return {
    width:     vs.width,
    height:    vs.height,
    frameRate: den ? num / den : 30,
    duration:  parseFloat(info.format.duration ?? "0"),
    fileSize:  stats.size,
  };
};

/**
 * encodeToHLS
 * Encodes the source into adaptive HLS at multiple resolutions.
 *
 * Rules:
 *   - Never upscales — skips variants wider than the source
 *   - Adds 4K only when source height >= 2160
 *   - 6-second segments — good seek granularity / CDN object balance
 *   - Calls onProgress(0-100) after each variant
 *
 * Returns { masterPlaylistPath, variants[], duration, fileSize }
 */
const encodeToHLS = async (inputPath, outputDir, videoId, onProgress) => {
  const { width, height, frameRate, duration, fileSize } = await probeVideo(inputPath);
  const gopSize  = Math.floor(frameRate * 4);
  const variants = height >= 2160 ? [...BASE_VARIANTS, VARIANT_4K] : [...BASE_VARIANTS];

  await fs.mkdir(outputDir, { recursive: true });

  const encoded = [];

  for (let i = 0; i < variants.length; i++) {
    const v    = variants[i];
    const [vW] = v.resolution.split("x").map(Number);

    if (vW > width) {
      console.log(`[worker] ⏭  Skip ${v.name} — source ${width}px wide`);
      continue;
    }

    console.log(`[worker] 🎬 Encoding ${v.name}  videoId=${videoId}  (${i + 1}/${variants.length})`);
    await onProgress(Math.floor(((i) / variants.length) * 85));

    const cmd = [
      FFMPEG_PATH, "-y",
      "-i",                `"${inputPath}"`,
      "-c:v",              "libx264",
      "-preset",           "medium",
      "-profile:v",        v.profile,
      "-level:v",          v.level,
      "-b:v",              v.bitrate,
      "-maxrate",          v.maxrate,
      "-bufsize",          v.bufsize,
      "-s",                v.resolution,
      "-c:a",              "aac",
      "-b:a",              "128k",
      "-ac",               "2",
      "-g",                gopSize,
      "-keyint_min",       gopSize,
      "-sc_threshold",     "0",
      "-force_key_frames", `"expr:gte(t,n_forced*4)"`,
      "-hls_time",         "6",
      "-hls_list_size",    "0",
      "-hls_flags",        "independent_segments",
      "-hls_segment_filename", `"${outputDir}/${v.name}_%03d.ts"`,
      `"${outputDir}/${v.name}.m3u8"`,
    ].join(" ");

    await execAsync(cmd);
    encoded.push(v);
    console.log(`[worker] ✅ ${v.name} done`);
  }

  // Master playlist
  const masterPath = path.join(outputDir, "master.m3u8");
  const lines = ["#EXTM3U", "#EXT-X-VERSION:6", ""];
  for (const v of encoded) {
    const bw = parseInt(v.bitrate) * 1000 + 128_000;
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bw},RESOLUTION=${v.resolution},FRAME-RATE=${frameRate.toFixed(3)}`);
    lines.push(`${v.name}.m3u8`);
    lines.push("");
  }
  await fs.writeFile(masterPath, lines.join("\n"));

  // Metadata sidecar
  await fs.writeFile(path.join(outputDir, "metadata.json"), JSON.stringify({
    duration, resolution: `${width}x${height}`, frameRate,
    variants: encoded.map((v) => v.name), encodedAt: new Date().toISOString(),
  }, null, 2));

  await onProgress(90);
  return { masterPlaylistPath: masterPath, variants: encoded.map((v) => v.name), duration, fileSize };
};

// ─── § API CALLBACKS ──────────────────────────────────────────────────────────

const internalHeaders = {
  "Content-Type":      "application/json",
  "x-internal-secret": INTERNAL_SECRET,
};

/**
 * getSourceUrl
 * Asks the API server for a 1-hour signed R2 URL to download the source video.
 */
const getSourceUrl = async (videoId) => {
  const res = await fetch(`${API_BASE_URL}/api/stream/internal/source-url/${videoId}`, {
    headers: internalHeaders,
  });
  if (!res.ok) throw new Error(`getSourceUrl failed ${res.status}: ${await res.text()}`);
  const { data } = await res.json();
  return data; // { signedUrl, sourceKey }
};

/**
 * updateVideoStatus
 * Pushes encoding progress or final status back to the API server.
 * The API updates the video record in its store / DB.
 */
const updateVideoStatus = async (videoId, data) => {
  const res = await fetch(`${API_BASE_URL}/api/stream/internal/update`, {
    method:  "POST",
    headers: internalHeaders,
    body:    JSON.stringify({ videoId, ...data }),
  });
  if (!res.ok) throw new Error(`updateVideoStatus failed ${res.status}: ${await res.text()}`);
  return res.json();
};

// ─── § WORKER ─────────────────────────────────────────────────────────────────

const worker = new Worker(
  "video-encoding",

  async (job) => {
    const { videoId, courseId, sourceKey } = job.data;
    console.log(`\n[worker] 🚀 Job started  videoId=${videoId}  jobId=${job.id}`);

    // Notify API: encoding started
    await updateVideoStatus(videoId, { encodingStatus: "encoding", encodingProgress: 0 });

    const jobTempDir  = path.join(TEMP_DIR, videoId);
    const outputDir   = path.join(ENCODED_DIR, `video_${videoId}`);
    await fs.mkdir(jobTempDir,  { recursive: true });
    await fs.mkdir(outputDir,   { recursive: true });

    // ── Step 1: Get signed URL from API ──────────────────────────────────
    console.log(`[worker] 🔑 Requesting signed URL  videoId=${videoId}`);
    const { signedUrl } = await getSourceUrl(videoId);

    // ── Step 2: Download source from R2 ──────────────────────────────────
    const ext        = path.extname(sourceKey) || ".mp4";
    const sourcePath = path.join(jobTempDir, `source${ext}`);
    console.log(`[worker] ⬇️  Downloading source from R2  videoId=${videoId}`);
    await downloadFromSignedUrl(signedUrl, sourcePath);
    console.log(`[worker] ✅ Source downloaded  path=${sourcePath}`);

    await updateVideoStatus(videoId, { encodingProgress: 5 });

    // ── Step 3: Encode to HLS ─────────────────────────────────────────────
    const onProgress = async (pct) => {
      await job.updateProgress(pct);
      await updateVideoStatus(videoId, { encodingProgress: pct }).catch(() => {});
    };

    const result = await encodeToHLS(sourcePath, outputDir, videoId, onProgress);
    console.log(`[worker] 🎞  Encoding complete  variants=${result.variants.join(",")}`);

    // ── Step 4: Upload HLS to R2 (public) ────────────────────────────────
    const r2Prefix = `courses/${courseId}/videos/${videoId}/hls`;
    console.log(`[worker] ☁️  Uploading HLS to R2  prefix=${r2Prefix}`);
    await updateVideoStatus(videoId, { encodingProgress: 92 });

    const videoUrl = await uploadDirToR2(outputDir, r2Prefix);
    console.log(`[worker] ✅ HLS uploaded  url=${videoUrl}`);

    // ── Step 5: Delete R2 staging source ─────────────────────────────────
    await deleteR2Object(sourceKey);

    // ── Step 6: Notify API — completed ───────────────────────────────────
    await updateVideoStatus(videoId, {
      encodingStatus:   "completed",
      encodingProgress: 100,
      videoUrl,
      hlsPath:          r2Prefix,
      duration:         result.duration,
      fileSize:         result.fileSize,
      variants:         JSON.stringify(result.variants),
      sourceKey:        null,   // clear staging key — source is deleted
    });

    // ── Step 7: Clean up local files ─────────────────────────────────────
    await fs.rm(jobTempDir, { recursive: true, force: true });
    await fs.rm(outputDir,  { recursive: true, force: true });

    console.log(`[worker] 🏁 Job complete  videoId=${videoId}  url=${videoUrl}\n`);
    return { videoUrl, variants: result.variants };
  },

  {
    connection:  REDIS_CONN,
    concurrency: CONCURRENCY,
    // Per-command-billed Redis (Upstash): an idle worker with stock defaults
    // burns ~40-80k commands/day (5s poll timeouts, 30s stalled scans, 30s
    // lock renewals). Same treatment as the battle worker: block longer,
    // scan stalled jobs far less often.
    drainDelay:  60,                            // seconds the idle poll blocks
    settings:    { stalledInterval: 300_000 },  // 5 min between stalled scans
  }
);

// ── Event listeners ────────────────────────────────────────────────────────────

worker.on("active",    (job) =>
  console.log(`[worker] ▶️  Active   jobId=${job.id}  videoId=${job.data.videoId}`)
);
worker.on("completed", (job, result) => {
  console.log(`[worker] ✅ Complete  jobId=${job.id}  url=${result.videoUrl}`);
  workerJob("video-encoding", "done", job, { videoId: job.data?.videoId });
});
worker.on("failed",    async (job, err) => {
  console.error(`[worker] ❌ Failed   jobId=${job?.id}  videoId=${job?.data?.videoId}  error=${err.message}`);
  workerJob("video-encoding", "failed", job, { videoId: job?.data?.videoId, error: err?.message });
  if (job?.data?.videoId) {
    await updateVideoStatus(job.data.videoId, {
      encodingStatus: "failed",
      errorMessage:   err.message,
    }).catch(() => {});
  }
});
worker.on("error",     (err) =>
  console.error("[worker] ⚠️  Worker error:", err.message)
);

// ── Queue event monitor ────────────────────────────────────────────────────────

const queueEvents = new QueueEvents("video-encoding", { connection: REDIS_CONN });
queueEvents.on("waiting",  ({ jobId })       => console.log(`[worker] ⏳ Waiting   jobId=${jobId}`));
queueEvents.on("progress", ({ jobId, data }) => console.log(`[worker] 📊 Progress  jobId=${jobId}  ${data}%`));
queueEvents.on("stalled",  ({ jobId })       => console.log(`[worker] 🔄 Stalled   jobId=${jobId} — retrying`));

// ── Startup banner ────────────────────────────────────────────────────────────

console.log(`
🔧  Piabam Encoding Worker
──────────────────────────────────────────────────
    Queue:        video-encoding
    Redis:        ${process.env.REDIS_URL ?? "redis://localhost:6379"}
    Concurrency:  ${CONCURRENCY} job(s) in parallel
    FFmpeg:       ${FFMPEG_PATH}
    R2:           ${R2_ENABLED ? `enabled → ${R2_BUCKET}` : "disabled (R2 vars not set)"}
    API callback: ${API_BASE_URL}

    Flow:
      Redis job → GET /internal/source-url → download from R2
      → FFmpeg encode → upload HLS to R2 → delete staging source
      → POST /internal/update → done

    Waiting for jobs...
──────────────────────────────────────────────────
`);

// ── Graceful shutdown ─────────────────────────────────────────────────────────

const shutdown = async (signal) => {
  console.log(`\n[worker] ${signal} — finishing current job then shutting down...`);
  await worker.close();
  await queueEvents.close();
  console.log("[worker] Shutdown complete");
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
