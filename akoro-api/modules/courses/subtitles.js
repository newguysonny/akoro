/**
 * routes/subtitles.js  —  Piabam Video Subtitles & Captions
 *
 * Handles:
 *   - Upload .vtt or .srt caption files for a video
 *   - List subtitles for a video
 *   - Set default subtitle language
 *   - Delete a subtitle track
 *
 * .srt files are auto-converted to .vtt on upload (browser-native format).
 *
 * Usage in app.js:
 *   import subtitlesRouter from "./routes/subtitles.js";
 *   app.use("/api", subtitlesRouter);
 */

import { Router }                         from "express";
import multer                             from "multer";
import { S3Client, PutObjectCommand,
         DeleteObjectCommand }            from "@aws-sdk/client-s3";
import { body, validationResult }         from "express-validator";
import db                                 from "../../db.js";
import { authenticateToken, requireRole } from "../auth/index.js";
import config                             from "../../config/index.js";
import { r2Send } from "../../lib/r2Breaker.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res201 = (res, data)            => res.status(201).json({ success: true,  data });
const res204 = (res)                  => res.status(204).send();
const res400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
const res403 = (res, msg)             => res.status(403).json({ success: false, message: msg });
const res404 = (res, msg)             => res.status(404).json({ success: false, message: msg });

/**
 * The video's course must be the caller's (or the caller an admin) — the same
 * rule the upload uses; changing or deleting a track used to need only the
 * instructor role (Phase 15 item 6).
 */
async function guardVideoOwner(req, res, videoId) {
  const { data: video } = await db.from("videos")
    .select("id, courses(instructor_id)").eq("id", videoId).maybeSingle();
  if (!video) { res404(res, "Video not found"); return false; }
  if (req.user.role !== "admin" && video.courses?.instructor_id !== req.user.id) { res403(res, "You do not own this video"); return false; }
  return true;
}

const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ success: false, message: "Validation failed", errors: errors.array({ onlyFirstError: true }) });
  next();
};

// ─── R2 client ────────────────────────────────────────────────────────────────

const r2 = new S3Client({
  region:      "auto",
  endpoint:    `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey },
});

const uploadVttToR2 = async (vttContent, key) => {
  await r2Send(r2, new PutObjectCommand({
    Bucket:      config.r2.bucketName,
    Key:         key,
    Body:        Buffer.from(vttContent, "utf-8"),
    ContentType: "text/vtt",
    ACL:         "public-read",
    CacheControl: "public, max-age=31536000",
  }));
  return `${config.r2.publicUrl}/${key}`;
};

const deleteFromR2 = async (key) => {
  await r2Send(r2, new DeleteObjectCommand({ Bucket: config.r2.bucketName, Key: key }));
};

// ─── SRT → VTT converter ─────────────────────────────────────────────────────

/**
 * convertSrtToVtt
 * Converts an SRT subtitle string to WebVTT format.
 * VTT is the standard format supported by all HTML5 video players.
 *
 * SRT format:
 *   1
 *   00:00:01,000 --> 00:00:04,000
 *   Hello world
 *
 * VTT format:
 *   WEBVTT
 *
 *   00:00:01.000 --> 00:00:04.000
 *   Hello world
 */
const convertSrtToVtt = (srtContent) => {
  const vtt = srtContent
    .trim()
    // Replace comma decimal separator with period (SRT → VTT time format)
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
    // Remove sequence numbers (lines that are just digits)
    .replace(/^\d+\r?\n/gm, "")
    .trim();

  return `WEBVTT\n\n${vtt}`;
};

// ─── Multer — caption file upload ─────────────────────────────────────────────

const captionUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },  // 5MB max — captions are tiny text files
  fileFilter: (_req, file, cb) => {
    const allowed = ["text/vtt", "text/plain", "application/octet-stream"];
    const ext     = file.originalname.split(".").pop().toLowerCase();
    if (["vtt", "srt"].includes(ext) || allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only .vtt and .srt caption files are supported"), false);
    }
  },
}).single("caption");

// ─── Handlers ─────────────────────────────────────────────────────────────────

const handlers = {

  /**
   * GET /api/videos/:videoId/subtitles
   * List all subtitle tracks for a video.
   */
  list: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("video_subtitles")
      .select("id, language, label, file_url, is_default, created_at")
      .eq("video_id", req.params.videoId)
      .order("is_default", { ascending: false });

    if (error) throw new Error(error.message);
    res200(res, data ?? [], { total: data?.length ?? 0 });
  }),

  /**
   * POST /api/videos/:videoId/subtitles
   * Upload a caption file (.vtt or .srt) for a video.
   * .srt files are converted to .vtt automatically.
   *
   * Multipart fields:
   *   caption   file    — the .vtt or .srt file
   *   language  string  — BCP-47 language code e.g. "en", "fr", "yo"
   *   label     string  — display label e.g. "English", "Français", "Yoruba"
   *   is_default boolean — whether to set as the default track
   */
  upload: (req, res, next) => {
    captionUpload(req, res, async (err) => {
      if (err) return next(err);

      const { videoId }              = req.params;
      const { language, label, is_default = "false" } = req.body;

      if (!req.file)  return res400(res, "No caption file received");
      if (!language)  return res400(res, "language is required (e.g. 'en', 'fr', 'yo')");
      if (!label)     return res400(res, "label is required (e.g. 'English', 'Yoruba')");

      // Verify instructor owns the course this video belongs to
      const { data: video } = await db
        .from("videos")
        .select("id, course_id, courses(instructor_id)")
        .eq("id", videoId)
        .single();

      if (!video) return res404(res, "Video not found");

      if (req.user.role !== "admin" &&
          video.courses?.instructor_id !== req.user.id) {
        return res403(res, "You do not own this video");
      }

      // Convert .srt to .vtt if needed
      const ext        = req.file.originalname.split(".").pop().toLowerCase();
      let vttContent   = req.file.buffer.toString("utf-8");
      if (ext === "srt") {
        vttContent = convertSrtToVtt(vttContent);
      } else if (!vttContent.trimStart().startsWith("WEBVTT")) {
        return res400(res, "File does not appear to be a valid VTT file. Expected 'WEBVTT' header.");
      }

      // Upload to R2
      let fileUrl = `/api/videos/${videoId}/subtitles/${language}.vtt`;  // dev fallback
      if (config.r2.enabled) {
        const r2Key = `subtitles/${video.course_id}/${videoId}/${language}.vtt`;
        fileUrl     = await uploadVttToR2(vttContent, r2Key);
      }

      // If setting as default, unset other defaults first
      if (is_default === "true" || is_default === true) {
        await db.from("video_subtitles")
          .update({ is_default: false })
          .eq("video_id", videoId);
      }

      // Upsert — allow re-uploading an improved translation for the same language
      const { data, error } = await db
        .from("video_subtitles")
        .upsert({
          video_id:   videoId,
          language,
          label,
          file_url:   fileUrl,
          is_default: is_default === "true" || is_default === true,
        }, { onConflict: "video_id,language" })
        .select()
        .single();

      if (error) throw new Error(error.message);
      res201(res, data);
    });
  },

  /**
   * PATCH /api/videos/:videoId/subtitles/:language/default
   * Set a subtitle track as the default for the video.
   */
  setDefault: asyncHandler(async (req, res) => {
    const { videoId, language } = req.params;
    if (!(await guardVideoOwner(req, res, videoId))) return;

    // Unset all current defaults
    await db.from("video_subtitles")
      .update({ is_default: false })
      .eq("video_id", videoId);

    // Set the new default
    const { data, error } = await db
      .from("video_subtitles")
      .update({ is_default: true })
      .eq("video_id", videoId)
      .eq("language", language)
      .select()
      .single();

    if (error || !data) return res404(res, `No subtitle track found for language: ${language}`);
    res200(res, data);
  }),

  /**
   * DELETE /api/videos/:videoId/subtitles/:language
   * Delete a subtitle track.
   */
  delete: asyncHandler(async (req, res) => {
    const { videoId, language } = req.params;
    if (!(await guardVideoOwner(req, res, videoId))) return;

    const { data: subtitle } = await db
      .from("video_subtitles")
      .select("id, file_url")
      .eq("video_id", videoId)
      .eq("language", language)
      .single();

    if (!subtitle) return res404(res, "Subtitle track not found");

    // Delete from R2 if hosted there
    if (config.r2.enabled && subtitle.file_url.includes(config.r2.publicUrl)) {
      const key = subtitle.file_url.replace(`${config.r2.publicUrl}/`, "");
      await deleteFromR2(key).catch((e) =>
        console.warn("[subtitles] R2 delete failed:", e.message)
      );
    }

    await db.from("video_subtitles").delete().eq("id", subtitle.id);
    res204(res);
  }),

  /**
   * GET /api/videos/:videoId/subtitles/:language.vtt
   * Dev-only: serve VTT content directly (when R2 not configured).
   * In production, VTT files are served directly from R2/CDN.
   */
  serveDev: asyncHandler(async (req, res) => {
    if (config.r2.enabled) return res400(res, "Use the R2 CDN URL in production");

    const { data: subtitle } = await db
      .from("video_subtitles")
      .select("file_url")
      .eq("video_id", req.params.videoId)
      .eq("language", req.params.language)
      .single();

    if (!subtitle) return res404(res, "Subtitle not found");

    // In dev mode file_url is a local path placeholder — return 404
    res404(res, "Configure R2 to serve subtitle files");
  }),
};

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

router.get   ("/videos/:videoId/subtitles",                        authenticateToken, handlers.list);
router.post  ("/videos/:videoId/subtitles",                        authenticateToken, requireRole(["instructor", "admin"]), handlers.upload);
router.patch ("/videos/:videoId/subtitles/:language/default",      authenticateToken, requireRole(["instructor", "admin"]), handlers.setDefault);
router.delete("/videos/:videoId/subtitles/:language",              authenticateToken, requireRole(["instructor", "admin"]), handlers.delete);
router.get   ("/videos/:videoId/subtitles/:language.vtt",          handlers.serveDev);

export default router;
