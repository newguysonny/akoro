/**
 * stream.js  —  Piabam Video Upload & Streaming router
 *
 * Runs on: Railway (API server) — NO FFmpeg required here
 *
 * Option A flow:
 *   1. Instructor uploads video → Railway receives it in memory
 *   2. Railway uploads raw source to R2 staging bucket
 *      (courses/<courseId>/videos/<videoId>/source.mp4)
 *   3. Railway drops a BullMQ job with the R2 source key
 *   4. Worker downloads source from R2, encodes, re-uploads HLS, deletes source
 *
 * Why Option A over writing to TEMP_DIR:
 *   - Railway has no persistent disk — temp files vanish on restart
 *   - R2 staging survives Railway restarts, deploys, and crashes
 *   - Worker can run on any VPS anywhere without a shared filesystem
 *   - R2 → Hetzner download is fast (~15s) vs Railway → Hetzner (~60-120s)
 *
 * Usage in app.js:
 *   import streamRouter from "./routes/stream.js";
 *   app.use("/api/stream", streamRouter);
 *
 * ─── Sections ────────────────────────────────────────────────────────────────
 *  § IMPORTS
 *  § CONFIG
 *  § VIDEO STORE         in-memory — swap for Postgres
 *  § HELPERS
 *  § MULTER              memory-storage, 50 GB cap
 *  § R2 CLIENT           staging upload + signed URLs + HLS delete
 *  § BULLMQ PRODUCER     drops encode jobs into Redis queue
 *  § STREAM HANDLERS     upload, status, watch, delete, internal callbacks
 *  § ROUTER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Environment variables (.env):
 *   REDIS_URL
 *   INTERNAL_SECRET      shared secret for worker callback endpoints
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET_NAME
 *   R2_PUBLIC_URL        e.g. https://cdn.akoro.app
 */

// ─── § IMPORTS ────────────────────────────────────────────────────────────────

import { Router }                         from "express";
import multer                             from "multer";
import { Queue }                          from "bullmq";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
}                                         from "@aws-sdk/client-s3";
import { getSignedUrl }                   from "@aws-sdk/s3-request-presigner";
import path                               from "path";
import { fileURLToPath }                  from "url";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { r2Send } from "../../lib/r2Breaker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── § CONFIG ─────────────────────────────────────────────────────────────────

const R2_BUCKET  = process.env.R2_BUCKET_NAME ?? "";
const R2_PUBLIC  = process.env.R2_PUBLIC_URL  ?? "";
const R2_ENABLED = !!(process.env.R2_ACCESS_KEY_ID && R2_BUCKET);

// ─── § VIDEO STORE ────────────────────────────────────────────────────────────
// Swap array + helpers for Postgres queries without touching anything else.

let _videos   = [];
const now     = () => new Date().toISOString();

const VideoStore = {
  list:   (courseId) => _videos.filter((v) => v.courseId === courseId),
  get:    (id)       => _videos.find((v) => v.id === id) ?? null,
  create: (data)     => { _videos.push(data); return data; },
  update: (id, data) => {
    const i = _videos.findIndex((v) => v.id === id);
    if (i === -1) return null;
    _videos[i] = { ..._videos[i], ...data, id, updatedAt: now() };
    return _videos[i];
  },
  delete: (id) => {
    const i = _videos.findIndex((v) => v.id === id);
    if (i === -1) return false;
    _videos.splice(i, 1);
    return true;
  },
};

// ─── § HELPERS ────────────────────────────────────────────────────────────────

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res202 = (res, data)            => res.status(202).json({ success: true,  data });
const res400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
const res403 = (res, msg)             => res.status(403).json({ success: false, message: msg });
const res404 = (res, msg)             => res.status(404).json({ success: false, message: msg });

// ─── § MULTER ─────────────────────────────────────────────────────────────────
// Memory storage — buffer goes straight to R2, never written to Railway disk.
// 50 GB limit supports 4K source files.

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ALLOWED = [
      "video/mp4", "video/quicktime", "video/x-msvideo",
      "video/webm", "video/x-matroska", "video/mpeg",
    ];
    ALLOWED.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error(`Unsupported video type: ${file.mimetype}`), false);
  },
});

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
    ".mp4":  "video/mp4",
    ".mov":  "video/quicktime",
    ".webm": "video/webm",
    ".jpg":  "image/jpeg",
    ".png":  "image/png",
  }[ext] ?? "application/octet-stream";
};

/**
 * uploadSourceToR2
 * Uploads the raw video buffer to R2 under a private staging key.
 * Key: courses/<courseId>/videos/<videoId>/source<ext>
 * No ACL — private object, accessed only via signed URL by the worker.
 * Returns the R2 object key.
 */
const uploadSourceToR2 = async (buffer, courseId, videoId, ext) => {
  const key = `courses/${courseId}/videos/${videoId}/source${ext}`;
  await r2Send(r2, new PutObjectCommand({
    Bucket:      R2_BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: getContentType(`source${ext}`),
    // Private — no ACL. Worker downloads via signed URL.
  }));
  return key;
};

/**
 * generateSignedSourceUrl
 * Creates a 1-hour presigned GET URL so the worker can download the source.
 * Called once per job via GET /internal/source-url/:videoId.
 */
const generateSignedSourceUrl = async (sourceKey) => {
  const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: sourceKey });
  return getSignedUrl(r2, cmd, { expiresIn: 3600 }); // 1 hour
};

/**
 * deleteR2Prefix
 * Deletes all R2 objects under a prefix.
 * Covers both staging source and all encoded HLS files in one call.
 */
const deleteR2Prefix = async (prefix) => {
  const { Contents } = await r2Send(r2, 
    new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix })
  );
  if (!Contents?.length) return;
  await Promise.all(
    Contents.map((obj) =>
      r2Send(r2, new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: obj.Key }))
    )
  );
};

// ─── § BULLMQ PRODUCER ────────────────────────────────────────────────────────
// Only adds jobs — never processes them. Worker.js is the consumer.

const encodingQueue = new Queue("video-encoding", {
  connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" },
  defaultJobOptions: {
    attempts:         3,
    backoff:          { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail:     { count: 200 },
  },
});

// ─── § STREAM HANDLERS ────────────────────────────────────────────────────────

const streamHandlers = {

  /**
   * POST /api/stream/upload
   *
   * Option A steps:
   *   1. Receive video buffer in memory (multer)
   *   2. Upload raw source to R2 staging  → private key stored on video record
   *   3. Create video record (status: queued)
   *   4. Queue BullMQ job with sourceKey
   *   5. Return 202 — encoding is fully async on the worker
   */
  upload: asyncHandler(async (req, res) => {
    const {
      courseId,
      title,
      description = null,
      orderIndex  = 0,
      isPreview   = false,
    } = req.body;

    if (!req.file) return res400(res, "No video file received");
    if (!courseId) return res400(res, "courseId is required");
    if (!title)    return res400(res, "title is required");
    if (!R2_ENABLED)
      return res400(res, "R2 is not configured — set R2_ACCESS_KEY_ID and R2_BUCKET_NAME in .env");

    const videoId = crypto.randomUUID();
    const ext     = path.extname(req.file.originalname) || ".mp4";

    // Step 1 — stage source on R2
    console.log(`[stream] ⬆️  Staging source on R2  videoId=${videoId}  size=${(req.file.size / 1024 / 1024).toFixed(1)}MB`);
    const sourceKey = await uploadSourceToR2(req.file.buffer, courseId, videoId, ext);
    console.log(`[stream] ✅ Source staged  key=${sourceKey}`);

    // Step 2 — create video record
    VideoStore.create({
      id:               videoId,
      courseId,
      title,
      description,
      orderIndex:       Number(orderIndex),
      isPreview:        isPreview === "true" || isPreview === true,
      videoUrl:         null,
      hlsPath:          null,
      sourceKey,               // R2 key for the raw source — worker fetches via signed URL
      variants:         null,
      duration:         null,
      fileSize:         req.file.size,
      encodingStatus:   "queued",
      encodingProgress: 0,
      createdAt:        now(),
      updatedAt:        now(),
    });

    // Step 3 — queue encoding job
    const job = await encodingQueue.add("encode", {
      videoId,
      courseId,
      sourceKey,             // worker uses this — no file paths, no shared disk
      originalName: req.file.originalname,
    });

    console.log(`[stream] 📤 Job queued  videoId=${videoId}  jobId=${job.id}`);

    res202(res, {
      videoId,
      jobId:          job.id,
      encodingStatus: "queued",
      message:        "Source staged on R2. Encoding queued — poll /api/stream/status/:videoId for progress.",
    });
  }),

  /**
   * GET /api/stream/status/:videoId
   * Poll from the frontend to track encoding progress.
   * Returns live queue state alongside the stored record.
   */
  status: asyncHandler(async (req, res) => {
    const video = VideoStore.get(req.params.videoId);
    if (!video) return res404(res, `Video ${req.params.videoId} not found`);

    const jobs      = await encodingQueue.getJobs(["active", "waiting", "failed"]);
    const activeJob = jobs.find((j) => j.data?.videoId === req.params.videoId);

    res200(res, {
      videoId:          video.id,
      title:            video.title,
      encodingStatus:   video.encodingStatus,
      encodingProgress: video.encodingProgress,
      videoUrl:         video.videoUrl,
      duration:         video.duration,
      variants:         video.variants ? JSON.parse(video.variants) : null,
      queueState:       activeJob?.state        ?? null,
      queueAttempts:    activeJob?.attemptsMade ?? null,
    });
  }),

  /**
   * GET /api/stream/videos/:videoId
   * Returns the CDN stream URL for the video player.
   * Only works once encoding is complete.
   */
  watch: asyncHandler(async (req, res) => {
    const video = VideoStore.get(req.params.videoId);
    if (!video) return res404(res, "Video not found");

    if (video.encodingStatus !== "completed")
      return res400(res, `Video not ready — status: ${video.encodingStatus}`);

    res200(res, {
      videoId:      video.id,
      title:        video.title,
      description:  video.description,
      url:          video.videoUrl,     // Cloudflare R2 CDN master.m3u8
      duration:     video.duration,
      isPreview:    video.isPreview,
      lastPosition: 0,                 // swap: ProgressStore.get(req.user.id, videoId)
    });
  }),

  /**
   * DELETE /api/stream/videos/:videoId
   * Deletes the video record and ALL R2 objects for this video
   * (source staging file + all encoded HLS segments in one prefix wipe).
   */
  delete: asyncHandler(async (req, res) => {
    const video = VideoStore.get(req.params.videoId);
    if (!video) return res404(res, "Video not found");

    if (R2_ENABLED) {
      // Wipe entire video prefix — source + HLS in one shot
      const videoPrefix = `courses/${video.courseId}/videos/${video.id}`;
      await deleteR2Prefix(videoPrefix).catch((e) =>
        console.warn(`[stream] ⚠️  R2 delete failed  prefix=${videoPrefix}:`, e.message)
      );
      console.log(`[stream] 🗑  R2 objects deleted  prefix=${videoPrefix}`);
    }

    VideoStore.delete(video.id);
    res200(res, { message: `Video ${video.id} deleted` });
  }),

  /**
   * GET /api/stream/courses/:courseId/videos
   * Lists videos for a course.
   * Students only see completed; instructors/admin see all statuses.
   */
  listByCourse: asyncHandler(async (req, res) => {
    const videos  = VideoStore.list(req.params.courseId);
    const visible = req.user?.role === "student"
      ? videos.filter((v) => v.encodingStatus === "completed")
      : videos;
    res200(res, visible, { total: visible.length });
  }),

  /**
   * GET /api/stream/internal/source-url/:videoId
   * Worker calls this once per job to get a 1-hour signed URL for the source file.
   * Protected by x-internal-secret header — not a public endpoint.
   */
  getSourceUrl: asyncHandler(async (req, res) => {
    if (req.headers["x-internal-secret"] !== process.env.INTERNAL_SECRET)
      return res403(res, "Forbidden");

    const video = VideoStore.get(req.params.videoId);
    if (!video?.sourceKey) return res404(res, "Source file not found");

    const signedUrl = await generateSignedSourceUrl(video.sourceKey);
    console.log(`[stream] 🔑 Signed URL issued  videoId=${req.params.videoId}`);
    res200(res, { signedUrl, sourceKey: video.sourceKey });
  }),

  /**
   * POST /api/stream/internal/update
   * Worker calls this to push encoding progress and final status back to the API.
   * Protected by x-internal-secret header — not a public endpoint.
   *
   * Body: { videoId, encodingStatus?, encodingProgress?, videoUrl?, hlsPath?,
   *         duration?, fileSize?, variants?, errorMessage? }
   */
  internalUpdate: asyncHandler(async (req, res) => {
    if (req.headers["x-internal-secret"] !== process.env.INTERNAL_SECRET)
      return res403(res, "Forbidden");

    const { videoId, ...data } = req.body;
    if (!videoId) return res400(res, "videoId is required");

    const updated = VideoStore.update(videoId, data);
    if (!updated) return res404(res, `Video ${videoId} not found`);

    console.log(`[stream] 📥 Worker update  videoId=${videoId}  status=${data.encodingStatus ?? `${data.encodingProgress}%`}`);
    res200(res, updated);
  }),
};

export { VideoStore };

// ─── § ROUTER ─────────────────────────────────────────────────────────────────

const router = Router();

// Instructor / admin — upload + manage
router.post  ("/upload",                       authenticateToken, requireRole(["instructor", "admin"]), upload.single("video"), streamHandlers.upload);
router.get   ("/status/:videoId",              authenticateToken, requireRole(["instructor", "admin"]), streamHandlers.status);
router.delete("/videos/:videoId",              authenticateToken, requireRole(["instructor", "admin"]), streamHandlers.delete);

// Any authenticated user — watch
router.get("/videos/:videoId",                 authenticateToken, streamHandlers.watch);
router.get("/courses/:courseId/videos",        authenticateToken, streamHandlers.listByCourse);

// Internal — worker callbacks (no JWT, protected by x-internal-secret header)
router.get ("/internal/source-url/:videoId",   streamHandlers.getSourceUrl);
router.post("/internal/update",                streamHandlers.internalUpdate);

export default router;

/**
 * ── Full Option A data flow ───────────────────────────────────────────────────
 *
 *  Instructor                Railway (stream.js)            Redis           Worker (worker.js)          R2
 *  ──────────                ───────────────────            ─────           ──────────────────          ──
 *  POST /upload ──────────►  multer (memory)
 *                            uploadSourceToR2() ──────────────────────────────────────────────────► source.mp4 (private)
 *                            VideoStore.create()
 *                            encodingQueue.add() ────────► job{sourceKey}
 *                            202 ◄──────────────
 *                                                           job ◄────────── Worker picks up job
 *                                                                           GET /internal/source-url
 *                            generateSignedUrl() ◄──────────────────────── x-internal-secret
 *                            signedUrl ──────────────────────────────────►
 *                                                                           fetch(signedUrl) ────────► download source.mp4
 *                                                                           FFmpeg encode
 *                                                                           uploadDirToR2() ─────────► master.m3u8 + .ts files (public)
 *                                                                           deleteR2Source() ────────► delete source.mp4
 *                                                                           POST /internal/update
 *                            VideoStore.update() ◄──────────────────────── { videoUrl, status: completed }
 *
 *  Student polls status ──► GET /status/:videoId → encodingProgress 0→100
 *  Student watches ───────► GET /videos/:videoId → { url: "https://cdn.akoro.app/..." }
 *                            Player fetches master.m3u8 directly from R2/CDN
 *
 * ── Database table (Postgres) ─────────────────────────────────────────────────
 *
 * CREATE TABLE videos (
 *   id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   course_id         UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 *   title             TEXT NOT NULL,
 *   description       TEXT,
 *   order_index       INT NOT NULL DEFAULT 0,
 *   is_preview        BOOLEAN NOT NULL DEFAULT false,
 *   video_url         TEXT,
 *   hls_path          TEXT,
 *   source_key        TEXT,          -- R2 staging key, nulled after encode
 *   variants          JSONB,
 *   duration          NUMERIC(10,3),
 *   file_size         BIGINT,
 *   encoding_status   TEXT NOT NULL DEFAULT 'queued'
 *                       CHECK (encoding_status IN ('queued','encoding','completed','failed')),
 *   encoding_progress INT NOT NULL DEFAULT 0,
 *   error_message     TEXT,
 *   created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
 *   updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
 * );
 *
 * CREATE INDEX ON videos (course_id);
 * CREATE INDEX ON videos (encoding_status);
 */
