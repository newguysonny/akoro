/**
 * modules/records/routes.js  —  Akoro Records Module (learner library)
 *
 * The learner's own shelf of study material on the Library page:
 * uploaded files (PDF / text / image / audio / video), saved links and
 * pasted text. The shelf started device-local (localStorage, details
 * only — the file's bytes were never kept, so nothing could actually be
 * opened). Records now live on the server and follow the learner across
 * devices:
 *
 *   POST   /api/records/upload-url   → presign an upload PUT — R2, or the
 *                                       Supabase Storage fallback for files
 *                                       ≤ 5 MB when R2 isn't configured
 *                                       (bytes still bypass this API)
 *   POST   /api/records              → register the record (upload after
 *                                       its PUT, or a link, or a paste)
 *   GET    /api/records              → my shelf, newest first; uploads
 *                                       carry a 6h presigned fileUrl
 *   PATCH  /api/records/:id          → progress (10 on first open, 100
 *                                       on mark-done — self-reported)
 *   DELETE /api/records/:id          → row + best-effort R2 object
 *   GET    /api/records/:id/file     → 302 to a presigned download
 *
 * A kind='upload' row with no file_key is a legacy device record whose
 * bytes were never captured — the list says so (fileMissing) so the
 * viewer can be honest instead of pretending.
 *
 * Usage in app.js:
 *   app.use("/api/records", standardLimit, recordsModule);
 */

import { Router }           from "express";
import db                   from "../../db.js";
import { authenticateToken } from "../auth/routes.js";
import {
  recordsStorageEnabled, createPresignedUpload, createPresignedDownload, removeRecordFile,
  ownsRecordFileKey, isFallbackFileKey, MAX_FALLBACK_FILE_BYTES,
} from "./lib/storage.js";

const router = Router();

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const edu = () => db.schema("edu");

const res200 = (res, data) => res.status(200).json({ success: true, data });
const res201 = (res, data) => res.status(201).json({ success: true, data });
const res400 = (res, msg)  => res.status(400).json({ success: false, message: msg });
const res403 = (res, msg)  => res.status(403).json({ success: false, message: msg });
const res404 = (res, msg)  => res.status(404).json({ success: false, message: msg });
const res503 = (res, msg)  => res.status(503).json({ success: false, message: msg || "File storage is not configured on this deployment — set the R2_* variables." });

const MAX_FILE_BYTES   = 500 * 1024 * 1024;  // 500 MB — matches the sheet's guard
const MAX_TEXT_CHARS   = 20_000;             // matches the sheet's counter
const MAX_RECORDS      = 200;                // a shelf, not an archive

/* ── What the viewer can actually open ──────────────────────────────────────
   Mirrors the app's picker: PDF, text, images, audio, video. Word docs are
   uploadable in the future but stay unopenable in v1 — the viewer says
   "download to view" instead of guessing. */
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|flac)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)$/i;
const TEXT_EXT  = /\.(txt|md|csv)$/i;

const detectType = (mime = "", name = "") => {
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (/^image\//.test(mime)) return "image";
  if (/^audio\//.test(mime) || AUDIO_EXT.test(name)) return "audio";
  if (/^video\//.test(mime) || VIDEO_EXT.test(name)) return "video";
  if (mime === "text/plain" || mime === "text/markdown" || mime === "text/csv" || TEXT_EXT.test(name)) return "text";
  return null;
};

/* Row → API shape. Uploads with bytes get a fresh presigned URL; legacy
   detail-only rows get fileMissing so the viewer explains itself. If the
   store can't sign one row's URL, that record degrades to "no saved
   file" — the shelf itself must never 500 on a storage hiccup. */
const toApi = async (r) => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  mime: r.mime || "",
  size: r.size || 0,
  duration: r.duration ?? null,
  progress: r.progress ?? 0,
  fileType: r.kind === "upload" ? detectType(r.mime || "", r.name || "") : null,
  fileMissing: r.kind === "upload" && !r.file_key,
  url: r.url || null,
  content: r.kind === "paste" ? (r.content || "") : undefined,
  fileUrl: r.kind === "upload" && r.file_key
    ? await createPresignedDownload(r.file_key).catch((err) => {
        console.error("[records] could not sign fileUrl:", err?.message || err);
        return null;
      })
    : null,
  createdAt: r.created_at,
  lastOpenedAt: r.last_opened_at || null,
});

// ─── POST /api/records/upload-url ───────────────────────────────────────────
router.post("/upload-url", authenticateToken, asyncHandler(async (req, res) => {
  const { name, mime, size } = req.body || {};
  if (!name || !String(name).trim()) return res400(res, "A file name is required.");
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return res400(res, "A file size is required.");
  if (bytes > MAX_FILE_BYTES) return res400(res, "Files are capped at 500 MB.");
  if (!detectType(mime, name)) return res400(res, "Only PDFs, text files, images, audio or video can be uploaded.");
  // No R2 on this deployment? Files up to 5 MB ride the Supabase Storage
  // fallback (same signed-PUT protocol — the API still never proxies the
  // bytes); larger ones honestly need R2.
  if (!recordsStorageEnabled() && bytes > MAX_FALLBACK_FILE_BYTES) {
    return res503(res, "This deployment has no R2 file storage yet — files up to 5 MB upload to the built-in Supabase storage; larger ones need the R2_* variables.");
  }

  const { uploadUrl, fileKey } = await createPresignedUpload(String(name).trim(), mime, req.user.id);
  res200(res, { uploadUrl, fileKey });
}));

// ─── POST /api/records — register upload / link / paste ─────────────────────
router.post("/", authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const body = req.body || {};
  const name = String(body.name || "").trim().slice(0, 255);

  const { count } = await edu().from("records").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if ((count || 0) >= MAX_RECORDS) return res400(res, "Your record shelf is full (200) — remove one to add another.");

  let row;
  if (body.kind === "upload") {
    const fileKey = String(body.fileKey || "");
    const legacy  = body.legacy === true;   // device record from before uploads kept bytes — details only
    const bytes   = Number(body.size) || 0;
    if (fileKey) {
      // The key must live under this learner's own prefix — anything else is
      // someone else's object (or no one's), in either store.
      if (!ownsRecordFileKey(fileKey, userId)) {
        return res403(res, "That file key does not belong to you.");
      }
      // The fallback bucket is hard-capped at 5 MB; a row must not claim a
      // file bigger than its store will actually hold.
      if (isFallbackFileKey(fileKey) && bytes > MAX_FALLBACK_FILE_BYTES) {
        return res400(res, "Files on the built-in Supabase storage are capped at 5 MB.");
      }
    } else if (!legacy) {
      return res400(res, "The upload did not finish — no file key to register.");
    }
    if (!name || (!legacy && bytes <= 0)) return res400(res, "File details are missing.");
    if (bytes > MAX_FILE_BYTES) return res400(res, "Files are capped at 500 MB.");
    if (!legacy && !detectType(body.mime, name)) return res400(res, "Only PDFs, text files, images, audio or video can be uploaded.");
    row = {
      user_id: userId, kind: "upload", name,
      mime: String(body.mime || "") || null, size: bytes,
      duration: Number.isFinite(Number(body.duration)) && Number(body.duration) > 0 ? Number(body.duration) : null,
      file_key: fileKey || null,
    };
  } else if (body.kind === "link") {
    const url = String(body.url || "").trim();
    if (!/^https?:\/\/\S+\.\S+/i.test(url)) return res400(res, "That link looks incomplete — include https://");
    let host = url;
    try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep raw */ }
    row = { user_id: userId, kind: "link", name: name || host.slice(0, 255), url: url.slice(0, 2000), size: 0 };
  } else if (body.kind === "paste") {
    const text = String(body.content || body.text || "").trim();
    if (!text) return res400(res, "Paste some text first.");
    if (text.length > MAX_TEXT_CHARS) return res400(res, "Pastes are capped at 20,000 characters.");
    row = {
      user_id: userId, kind: "paste",
      name: name || (text.slice(0, 60) + (text.length > 60 ? "…" : "")),
      content: text, size: text.length,
    };
  } else {
    return res400(res, "kind must be upload, link or paste.");
  }

  const { data, error } = await edu().from("records").insert(row).select().single();
  if (error) throw error;
  res201(res, await toApi(data));
}));

// ─── GET /api/records — my shelf ────────────────────────────────────────────
router.get("/", authenticateToken, asyncHandler(async (req, res) => {
  const { data, error } = await edu().from("records")
    .select("*").eq("user_id", req.user.id)
    .order("created_at", { ascending: false }).limit(MAX_RECORDS);
  if (error) throw error;
  res200(res, await Promise.all((data || []).map(toApi)));
}));

// ─── PATCH /api/records/:id — progress / last-opened ────────────────────────
router.patch("/:id", authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { data: existing } = await edu().from("records")
    .select("id, user_id").eq("id", req.params.id).maybeSingle();
  if (!existing) return res404(res, "Record not found.");
  if (existing.user_id !== userId) return res403(res, "Not your record.");

  const patch = { updated_at: new Date().toISOString() };
  if (req.body?.progress !== undefined) {
    const p = Number(req.body.progress);
    if (!Number.isInteger(p) || p < 0 || p > 100) return res400(res, "progress must be a whole number between 0 and 100.");
    patch.progress = p;
  }
  if (req.body?.lastOpened) patch.last_opened_at = new Date().toISOString();

  const { data, error } = await edu().from("records").update(patch).eq("id", req.params.id).select().single();
  if (error) throw error;
  res200(res, await toApi(data));
}));

// ─── DELETE /api/records/:id — row + best-effort object ─────────────────────
router.delete("/:id", authenticateToken, asyncHandler(async (req, res) => {
  const { data: existing } = await edu().from("records")
    .select("id, user_id, file_key").eq("id", req.params.id).maybeSingle();
  if (!existing) return res404(res, "Record not found.");
  if (existing.user_id !== req.user.id) return res403(res, "Not your record.");

  const { error } = await edu().from("records").delete().eq("id", req.params.id);
  if (error) throw error;
  void removeRecordFile(existing.file_key);  // best-effort — the row is gone either way
  res.status(200).json({ success: true, data: { id: req.params.id } });
}));

// ─── GET /api/records/:id/file — stable download seam (302 → presigned) ─────
// The viewer streams from the list's presigned fileUrl; this endpoint is the
// friendly "save a copy" link (cookies auth it, the store serves the bytes).
router.get("/:id/file", authenticateToken, asyncHandler(async (req, res) => {
  const { data: existing } = await edu().from("records")
    .select("id, user_id, file_key, name").eq("id", req.params.id).maybeSingle();
  if (!existing) return res404(res, "Record not found.");
  if (existing.user_id !== req.user.id) return res403(res, "Not your record.");
  if (!existing.file_key) return res400(res, "This record has no saved file — only its details were captured.");
  const url = await createPresignedDownload(existing.file_key, { downloadName: existing.name });
  res.redirect(302, url);
}));

export default router;
