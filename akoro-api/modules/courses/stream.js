/**
 * stream.js  —  Piabam Video Upload & Streaming router
 *
 * Runs on: Railway (API server) — NO FFmpeg required here
 *
 * Source upload:
 *   1. Instructor asks POST /upload-url → presigned PUT to R2
 *   2. Browser PUTs the file straight to R2 (never through the API)
 *   3. POST /upload-complete HEADs the object and dispatches the encode
 *   The legacy multipart /upload remains for ≤64 MB compatibility.
 *
 * Why R2 staging:
 *   - Render has no persistent disk — temp files vanish on restart
 *   - R2 staging survives restarts, deploys, and crashes
 *   - Worker can run on any VPS anywhere without a shared filesystem
 *   - R2 → container download is fast
 *
 * Usage in app.js:
 *   import streamRouter from "./routes/stream.js";
 *   app.use("/api/stream", streamRouter);
 *
 * ─── Sections ────────────────────────────────────────────────────────────────
 *  § IMPORTS
 *  § CONFIG
 *  § HELPERS
 *  § MULTER              legacy inline path (≤64 MB)
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
import { authenticateToken, requireRole } from "../auth/index.js";
import db                                 from "../../db.js";
import { autoTranscribeContent }          from "../records/index.js";
import { mediaWorkerEnabled }             from "../records/index.js";
import { dispatchEncode }                 from "./encodeDispatch.js";
import { enqueueMediaEncode }             from "./mediaEncodeQueue.js";
import { VideoStore }                     from "./video-store.js";
import { canManageCourse }                from "./courseAccess.js";
import makeStreamUploadRouter, {
  MAX_INLINE_BYTES,
  ALLOWED_VIDEO_MIME,
}                                         from "./stream-presign.js";
import { r2Send } from "../../lib/r2Breaker.js";
import { requireSharedSecret }            from "../../lib/safeCompare.js";

// ─── § CONFIG ─────────────────────────────────────────────────────────────────

const R2_BUCKET  = process.env.R2_BUCKET_NAME ?? "";
const R2_ENABLED = !!(process.env.R2_ACCESS_KEY_ID && R2_BUCKET);

// ─── § HELPERS ────────────────────────────────────────────────────────────────

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res202 = (res, data)            => res.status(202).json({ success: true,  data });
const res400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
const res403 = (res, msg)             => res.status(403).json({ success: false, message: msg });
// Worker-only routes: x-internal-secret must equal INTERNAL_SECRET (constant-time).
// Unset secret → 503, never open; missing or wrong header → 403. True when let through.
const internalGuard = (req, res) => { let ok = false; requireSharedSecret("INTERNAL_SECRET")(req, res, () => { ok = true; }); return ok; };
const res404 = (res, msg)             => res.status(404).json({ success: false, message: msg });

// ─── § MULTER ─────────────────────────────────────────────────────────────────
// Legacy inline path — capped small. Real course videos use the presigned
// direct-to-R2 lane (POST /upload-url + PUT + POST /upload-complete).

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_INLINE_BYTES },
  fileFilter: (_req, file, cb) => {
    ALLOWED_VIDEO_MIME.has(file.mimetype)
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
 * Creates a 6-hour presigned GET URL so the worker can download the source.
 * A 2 GB source on a slow container link can outlast a 1-hour URL.
 * Called once per job via GET /internal/source-url/:videoId.
 */
const generateSignedSourceUrl = async (sourceKey) => {
  const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: sourceKey });
  return getSignedUrl(r2, cmd, { expiresIn: 6 * 60 * 60 });
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
  for (let i = 0; i < Contents.length; i += 16) {
    await Promise.all(
      Contents.slice(i, i + 16).map((obj) =>
        r2Send(r2, new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: obj.Key }))
      )
    );
  }
};

// ─── § BULLMQ PRODUCER ────────────────────────────────────────────────────────
// Only adds jobs — never processes them. Worker.js is the consumer.

// Encode dispatch — the media container (media-worker/) when MEDIA_WORKER_URL
// is set: the video never passes through this server or its Redis. The BullMQ
// queue below is the fallback (byte-for-byte the original path) and is only
// constructed when no container is configured — container mode opens no
// Redis lane for encoding at all.
const encodingQueue = mediaWorkerEnabled() ? null : new Queue("video-encoding", {
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
   * POST /api/stream/upload  (legacy inline path, ≤ MAX_INLINE_BYTES)
   *
   *   1. Receive the small video buffer in memory (multer)
   *   2. Upload raw source to R2 staging
   *   3. Create the Postgres video row (status: queued)
   *   4. Queue/dispatch the encode
   *   5. Return 202 — encoding is fully async
   *
   * Large sources use /upload-url + PUT + /upload-complete instead.
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
    if (!(await canManageCourse(req.user, courseId))) return res403(res, "You do not own this course");

    const videoId = crypto.randomUUID();
    const ext     = path.extname(req.file.originalname) || ".mp4";

    // Step 1 — stage source on R2
    console.log(`[stream] ⬆️  Staging source on R2  videoId=${videoId}  size=${(req.file.size / 1024 / 1024).toFixed(1)}MB`);
    const sourceKey = await uploadSourceToR2(req.file.buffer, courseId, videoId, ext);
    console.log(`[stream] ✅ Source staged  key=${sourceKey}`);

    // Step 2 — create video record
    await VideoStore.create({
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
    });

    // Step 3 — dispatch the encode. Container mode: one HTTPS call; the
    // bytes go container ↔ R2 and never through this server. If the
    // container can't take the job, the record says FAILED (honest) rather
    // than sitting "queued" forever — re-uploading is the retry.
    let jobId = null;
    let via = "queue";
    if (mediaWorkerEnabled()) {
      try {
        jobId = await enqueueMediaEncode({ videoId, courseId, sourceKey, title });
        via = "media-queue";
        console.log(`[stream] 📥 Job queued for fan-out  videoId=${videoId}  jobId=${jobId}`);
      } catch (queueErr) {
        // Redis/misconfig: fall back to the legacy one-container call.
        console.warn("[stream] media queue unavailable, dispatching directly:", String(queueErr?.message || queueErr).slice(0, 160));
        try {
          jobId = await dispatchEncode({ videoId, courseId, sourceKey });
          via = "media-worker";
          console.log(`[stream] 📤 Job dispatched to media worker  videoId=${videoId}  jobId=${jobId}`);
        } catch (err) {
          console.error(`[stream] media worker dispatch failed:`, String(err?.message || err).slice(0, 200));
          await VideoStore.update(videoId, {
            encodingStatus: "failed",
            errorMessage: `Encoding could not be dispatched: ${String(err?.message || err).slice(0, 160)}`,
          });
          return res202(res, {
            videoId,
            jobId: null,
            encodingStatus: "failed",
            message: "Source staged, but the encoder is unreachable right now — re-upload to retry.",
          });
        }
      }
    } else if (encodingQueue) {
      const job = await encodingQueue.add("encode", {
        videoId,
        courseId,
        sourceKey,             // worker uses this — no file paths, no shared disk
        originalName: req.file.originalname,
      });
      jobId = job.id;
      console.log(`[stream] 📤 Job queued (bullmq)  videoId=${videoId}  jobId=${jobId}`);
    } else {
      try {
        jobId = await dispatchEncode({ videoId, courseId, sourceKey });
        via = "media-worker";
      } catch (err) {
        console.error(`[stream] media worker dispatch failed:`, String(err?.message || err).slice(0, 200));
        await VideoStore.update(videoId, {
          encodingStatus: "failed",
          errorMessage: `Encoding could not be dispatched: ${String(err?.message || err).slice(0, 160)}`,
        });
        return res202(res, {
          videoId,
          jobId: null,
          encodingStatus: "failed",
          message: "Source staged, but the encoder is unreachable right now — re-upload to retry.",
        });
      }
    }

    res202(res, {
      videoId,
      jobId,
      encodingStatus: "queued",
      via,
      message: `Source staged on R2. Encoding ${via === "media-worker" ? "dispatched to the media worker" : "queued for the encoder"} — poll /api/stream/status/:videoId for progress.`,
    });
  }),

  /**
   * GET /api/stream/status/:videoId
   * Poll from the frontend to track encoding progress.
   * Returns live queue state alongside the stored record.
   */
  status: asyncHandler(async (req, res) => {
    const video = await VideoStore.get(req.params.videoId);
    if (!video) return res404(res, `Video ${req.params.videoId} not found`);

    let activeJob = null;
    if (encodingQueue) {
      const jobs = await encodingQueue.getJobs(["active", "waiting", "failed"]);
      activeJob = jobs.find((j) => j.data?.videoId === req.params.videoId) ?? null;
    }

    res200(res, {
      videoId:          video.id,
      title:            video.title,
      encodingStatus:   video.encodingStatus,
      encodingProgress: video.encodingProgress,
      videoUrl:         video.videoUrl,
      duration:         video.duration,
      variants:         video.variants ?? null,
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
    const video = await VideoStore.get(req.params.videoId);
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
    const video = await VideoStore.get(req.params.videoId);
    if (!video) return res404(res, "Video not found");
    if (!(await canManageCourse(req.user, video.courseId))) return res403(res, "You do not own this course");

    if (R2_ENABLED) {
      // Wipe entire video prefix — source + HLS in one shot
      const videoPrefix = `courses/${video.courseId}/videos/${video.id}`;
      await deleteR2Prefix(videoPrefix).catch((e) =>
        console.warn(`[stream] ⚠️  R2 delete failed  prefix=${videoPrefix}:`, e.message)
      );
      console.log(`[stream] 🗑  R2 objects deleted  prefix=${videoPrefix}`);
    }

    await VideoStore.delete(video.id);
    res200(res, { message: `Video ${video.id} deleted` });
  }),

  /**
   * GET /api/stream/courses/:courseId/videos
   * Lists videos for a course.
   * Students only see completed; instructors/admin see all statuses.
   */
  listByCourse: asyncHandler(async (req, res) => {
    const videos  = await VideoStore.list(req.params.courseId);
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
    if (!internalGuard(req, res)) return;

    const video = await VideoStore.get(req.params.videoId);
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
    if (!internalGuard(req, res)) return;

    const { videoId, ...data } = req.body;
    if (!videoId) return res400(res, "videoId is required");

    const updated = await VideoStore.update(videoId, data);
    if (!updated) return res404(res, `Video ${videoId} not found`);

    console.log(`[stream] 📥 Worker update  videoId=${videoId}  status=${data.encodingStatus ?? `${data.encodingProgress}%`}`);

    // "Always extract" — the moment the encode lands in the bucket, the video
    // transcribes itself (shared lesson:<id> key). If a lesson already points
    // at this exact URL it is found and queued; if the lesson is written
    // later, the lesson hooks fire then. Either way: at most one job, and the
    // reader's manual offer remains as the retry. Never blocks the response.
    if (data.encodingStatus === "completed" && updated.videoUrl) {
      try {
        const { data: lesson } = await db.from("lessons")
          .select("id, title, video_url").eq("video_url", updated.videoUrl).limit(1).maybeSingle();
        if (lesson) {
          void autoTranscribeContent({
            userId: null,
            contentKey: `lesson:${lesson.id}`,
            name: lesson.title,
            mime: "video/mp4",
            fileUrl: updated.videoUrl,
          });
        }
      } catch (e) {
        console.warn("[stream] auto-transcribe lookup skipped:", String(e?.message || e).slice(0, 140));
      }
    }

    res200(res, updated);
  }),
};

export { VideoStore };

// ─── § ROUTER ─────────────────────────────────────────────────────────────────

const router = Router();

// Direct-to-R2 lane: /upload-url + /upload-complete (large sources).
router.use(makeStreamUploadRouter({ r2, bucket: R2_BUCKET, encodingQueue }));

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
 * ── Direct upload + encode flow ──────────────────────────────────────────────
 *
 *  Instructor                         API (stream.js)              Postgres        R2 / encoder
 *  ──────────                         ───────────────              ────────        ────────────
 *  POST /upload-url ────────────────► canManageCourse
 *                                     VideoStore.create() ───────► videos
 *                                     presign PUT ─────────────────────────────────► source URL
 *  PUT source ─────────────────────────────────────────────────────────────────────► source.mp4
 *  POST /upload-complete ───────────► HEAD source ─────────────────────────────────► source.mp4
 *                                     VideoStore.update() ───────► videos
 *                                     dispatch encode / queue ──────────────────────► media worker
 *  202 ◄─────────────────────────────
 *
 *  Worker: download source, FFmpeg HLS, upload segments to R2, delete source,
 *          POST /internal/update (same secret-guarded callbacks as before).
 *  Student: GET /status/:videoId (progress) → GET /videos/:videoId (stream URL).
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
