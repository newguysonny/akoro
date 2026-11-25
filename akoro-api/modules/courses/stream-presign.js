/**
 * modules/courses/stream-presign.js — direct-to-R2 course-video uploads.
 *
 * The old `POST /api/stream/upload` put the whole file in the API's memory
 * (multer) before R2. That is a 512 MB-instance OOM waiting for a real
 * lecture recording. This router hands the instructor a presigned PUT:
 *
 *   1. POST /api/stream/upload-url     → { uploadUrl, videoId, headers }
 *   2. PUT  <uploadUrl>                (bytes go browser → R2, never the API)
 *   3. POST /api/stream/upload-complete → HEAD the object, create/dispatch
 *
 * The legacy multipart route still exists for tiny files, but this is the
 * lane large sources use.
 */
import { Router } from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { HeadObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { authenticateToken, requireRole } from "../auth/index.js";
import { canManageCourse } from "./courseAccess.js";
import { VideoStore } from "./video-store.js";
import { dispatchEncode } from "./encodeDispatch.js";
import { enqueueMediaEncode, mediaQueueEnabled } from "./mediaEncodeQueue.js";
import { r2Send } from "../../lib/r2Breaker.js";

export const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;   // 2 GB, same as before
export const MAX_INLINE_BYTES = 64 * 1024 * 1024;         // legacy multipart only
const SOURCE_URL_TTL = 6 * 60 * 60;   // 2 GB on a slow line outlasts 15 minutes

export const ALLOWED_VIDEO_MIME = new Set([
  "video/mp4", "video/quicktime", "video/x-msvideo",
  "video/webm", "video/x-matroska", "video/mpeg",
]);

const EXT_BY_MIME = {
  "video/mp4":       ".mp4",
  "video/quicktime": ".mov",
  "video/x-msvideo": ".avi",
  "video/webm":      ".webm",
  "video/x-matroska": ".mkv",
  "video/mpeg":      ".mpeg",
};
const ALLOWED_EXT = new Set([".mp4", ".mov", ".avi", ".webm", ".mkv", ".mpeg", ".mpg"]);

/** Keep only the original extension when it is a video one; otherwise use the MIME's. */
export function sourceExt(fileName, mime) {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  return ALLOWED_EXT.has(ext) ? ext : (EXT_BY_MIME[mime] || ".mp4");
}

export function sourceKeyFor({ courseId, videoId, fileName, mime }) {
  return `courses/${courseId}/videos/${videoId}/source${sourceExt(fileName, mime)}`;
}

/**
 * makeStreamUploadRouter — the factory keeps the R2 client and encode queue
 * owned by stream.js, so there is one Redis connection and one S3 client.
 */
export function makeStreamUploadRouter({ r2, bucket, encodingQueue }) {
  const router = Router();
  const storageReady = !!(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && bucket);

  const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
  const res200 = (res, data, meta = {}) => res.status(200).json({ success: true, data, ...meta });
  const res201 = (res, data) => res.status(201).json({ success: true, data });
  const res202 = (res, data) => res.status(202).json({ success: true, data });
  const res400 = (res, msg) => res.status(400).json({ success: false, message: msg });
  const res403 = (res, msg) => res.status(403).json({ success: false, message: msg });
  const res404 = (res, msg) => res.status(404).json({ success: false, message: msg });
  const res413 = (res, msg) => res.status(413).json({ success: false, message: msg });

  const failed = (videoId, message) => VideoStore.update(videoId, {
    encodingStatus: "failed",
    errorMessage: String(message || "Upload could not be completed.").slice(0, 500),
  });

  router.post("/upload-url", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(async (req, res) => {
    const {
      courseId, title, description = null, orderIndex = 0, isPreview = false,
      fileName, mime, size,
    } = req.body || {};

    if (!storageReady) return res400(res, "R2 is not configured — set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME in .env");
    if (!courseId) return res400(res, "courseId is required");
    if (!title) return res400(res, "title is required");
    if (!fileName) return res400(res, "fileName is required");
    if (!ALLOWED_VIDEO_MIME.has(String(mime || ""))) {
      return res400(res, `Unsupported video type: ${mime || "unknown"}`);
    }

    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes <= 0) return res400(res, "size must be a positive number of bytes");
    if (bytes > MAX_SOURCE_BYTES) {
      return res413(res, `Video is too large (${Math.ceil(bytes / 1024 / 1024)} MB; limit ${MAX_SOURCE_BYTES / 1024 / 1024} MB)`);
    }
    if (!(await canManageCourse(req.user, courseId))) return res403(res, "You do not own this course");

    const videoId = randomUUID();
    const sourceKey = sourceKeyFor({ courseId, videoId, fileName, mime });
    const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({
      Bucket: bucket,
      Key: sourceKey,
      ContentType: mime,
      ContentLength: bytes,       // signed: a different body size is rejected
    }), { expiresIn: SOURCE_URL_TTL });

    await VideoStore.create({
      id: videoId,
      courseId,
      title,
      description,
      orderIndex: Number(orderIndex) || 0,
      isPreview: isPreview === true || isPreview === "true",
      sourceKey,
      fileSize: bytes,
      encodingStatus: "queued",
      encodingProgress: 0,
    });

    console.log(`[stream] 🔗 Direct upload URL  videoId=${videoId}  size=${(bytes / 1024 / 1024).toFixed(1)}MB`);
    res201(res, {
      videoId,
      sourceKey,
      uploadUrl,
      method: "PUT",
      headers: { "Content-Type": mime },
      expiresIn: SOURCE_URL_TTL,
    });
  }));

  router.post("/upload-complete", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(async (req, res) => {
    const { videoId } = req.body || {};
    if (!videoId) return res400(res, "videoId is required");

    const video = await VideoStore.get(videoId);
    if (!video) return res404(res, "Video not found");
    if (!(await canManageCourse(req.user, video.courseId))) return res403(res, "You do not own this video");

    // A retry after the worker already took the job is a success, not a duplicate.
    if (video.encodingStatus === "encoding" || video.encodingStatus === "completed") {
      return res200(res, { videoId, encodingStatus: video.encodingStatus, jobId: null });
    }

    const prefix = `courses/${video.courseId}/videos/${video.id}/`;
    if (!video.sourceKey || !video.sourceKey.startsWith(prefix)) {
      await failed(videoId, "The staged source key does not belong to this video.");
      return res400(res, "The staged source key does not belong to this video.");
    }

    let head;
    try {
      head = await r2Send(r2, new HeadObjectCommand({ Bucket: bucket, Key: video.sourceKey }));
    } catch {
      await failed(videoId, "No uploaded source was found in R2. PUT the file before completing the upload.");
      return res400(res, "No uploaded source was found in R2. PUT the file before completing the upload.");
    }

    const bytes = Number(head.ContentLength || 0);
    if (!bytes) {
      await failed(videoId, "The uploaded source is empty.");
      return res400(res, "The uploaded source is empty.");
    }
    if (bytes > MAX_SOURCE_BYTES) {
      await r2Send(r2, new DeleteObjectCommand({ Bucket: bucket, Key: video.sourceKey })).catch(() => {});
      await failed(videoId, "The uploaded source exceeded the 2 GB limit and was deleted.");
      return res413(res, "The uploaded source exceeded the 2 GB limit and was deleted.");
    }

    await VideoStore.update(videoId, {
      fileSize: bytes,
      encodingStatus: "queued",
      encodingProgress: 0,
      errorMessage: null,
    });

    let jobId = null;
    let via = "queue";
    try {
      if (mediaQueueEnabled()) {
        try {
          jobId = await enqueueMediaEncode({
            videoId, courseId: video.courseId, sourceKey: video.sourceKey, title: video.title,
          });
          via = "media-queue";
        } catch (queueErr) {
          console.warn("[stream] media queue unavailable, dispatching directly:", String(queueErr?.message || queueErr).slice(0, 160));
          jobId = await dispatchEncode({ videoId, courseId: video.courseId, sourceKey: video.sourceKey });
          via = "media-worker";
        }
      } else if (encodingQueue) {
        const job = await encodingQueue.add("encode", {
          videoId,
          courseId: video.courseId,
          sourceKey: video.sourceKey,
          originalName: video.title,
        });
        jobId = job.id;
      } else {
        jobId = await dispatchEncode({ videoId, courseId: video.courseId, sourceKey: video.sourceKey });
        via = "media-worker";
      }
    } catch (err) {
      console.error("[stream] media worker dispatch failed:", String(err?.message || err).slice(0, 200));
      await failed(videoId, `Encoding could not be dispatched: ${String(err?.message || err).slice(0, 160)}`);
      return res202(res, {
        videoId,
        jobId: null,
        encodingStatus: "failed",
        message: "Source uploaded, but the encoder is unreachable right now — re-upload to retry.",
      });
    }

    console.log(`[stream] 📤 Direct upload complete  videoId=${videoId}  jobId=${jobId}  via=${via}`);
    res202(res, {
      videoId,
      jobId,
      encodingStatus: "queued",
      via,
      message: `Source uploaded. Encoding ${via === "media-worker" ? "dispatched to the media worker" : "queued for the encoder"} — poll /api/stream/status/${videoId} for progress.`,
    });
  }));

  return router;
}

export default makeStreamUploadRouter;
