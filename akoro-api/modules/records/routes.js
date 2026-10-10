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
 *   GET    /api/records/discover     → the Contents/Materials feed —
 *                                       every learner's uploads + pasted
 *                                       notes, Premium subscribers' stay
 *                                       private; METADATA only, no
 *                                       presigning (bytes cost nothing
 *                                       until someone opens a record)
 *   GET    /api/records/discover/:id/open → presign a discovered upload,
 *                                       or return a paste's full text —
 *                                       one call per open
 *   PATCH  /api/records/:id          → progress (10 on first open, 100
 *                                       on mark-done — self-reported)
 *   DELETE /api/records/:id          → row + best-effort R2 object
 *   GET    /api/records/:id/file     → 302 to a presigned download
 *   GET    /api/records/folders      → my folders, newest first
 *   POST   /api/records/folders      → create one (name, description,
 *                                       visibility, coverKey) — covers
 *                                       presign via /upload-url with
 *                                       purpose 'folder-cover'
 *   PATCH  /api/records/folders/:id  → rename / re-describe / visibility
 *   DELETE /api/records/folders/:id  → row + best-effort cover object
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
import {
  recordsExtractionEnabled, parsePageRunAsync, getParseJob, settleParseJob, saveExtractionPage, getExtraction,
  claimContentJob, finishContentJob, updateContentJob, getContentJob,
  MAX_PAGES_PER_REQUEST, MAX_RECORD_PAGES, MAX_IMAGE_B64_CHARS,
} from "./extractLib.js";
import {
  avEnabled, transcribeRecord, getTranscript, replaceTranscript,
  avKindOf, autoTranscribeContent, autoTranscribeEnabled,
} from "./avTranscribeLib.js";
import { indexRecord, indexByContentKey, searchRecordChunks } from "./searchLib.js";
import {
  ASK_LIMITS, gatherPassages, buildAskMessages, extractCitations, loadAskHistory, saveAskTurn,
} from "./askLib.js";
import { openai, OPENAI_MODEL } from "../../lib/aiModel.js";
import { activePremiumUserIds, resolveContentAccess, resolveAskTargetFor } from "./access.js";

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

/* Folders — the shelf's organization layer (created from the
   "Add to library" sheet). A cover rides the SAME presigned storage
   pipeline as record files, just image-only and small. */
const MAX_FOLDERS        = 50;
const MAX_FOLDER_NAME    = 100;
const MAX_FOLDER_DESC    = 500;
const MAX_COVER_BYTES    = 5 * 1024 * 1024;

/* Folder items — what "Add to folder" puts inside. One item may land
   in several folders at once (the page multi-selects), so the add is
   a bulk write over the user's own folder ids. */
const MAX_FOLDER_ITEMS   = 200;
const ITEM_TYPES         = new Set(["record", "pharmd_topic", "lesson", "library"]);
const ITEM_KINDS         = new Set(["pdf", "audio", "video", "image", "text", "link", "paste", "blog", "course", "topic"]);

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
//   body.purpose: 'record' (default) | 'folder-cover' — a cover is
//   image-only and capped at 5 MB, but otherwise rides the exact same
//   presigned-PUT pipeline (R2, or the Supabase fallback where 5 MB is
//   already the bucket's hard cap, so the cover always fits).
router.post("/upload-url", authenticateToken, asyncHandler(async (req, res) => {
  const { name, mime, size } = req.body || {};
  const purpose = req.body?.purpose === "folder-cover" ? "folder-cover" : "record";
  if (!name || !String(name).trim()) return res400(res, "A file name is required.");
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return res400(res, "A file size is required.");
  if (purpose === "folder-cover") {
    if (!/^image\//.test(String(mime || ""))) return res400(res, "Folder covers must be images.");
    if (bytes > MAX_COVER_BYTES) return res400(res, "Folder covers are capped at 5 MB.");
  } else {
    if (bytes > MAX_FILE_BYTES) return res400(res, "Files are capped at 500 MB.");
    if (!detectType(mime, name)) return res400(res, "Only PDFs, text files, images, audio or video can be uploaded.");
    // No R2 on this deployment? Files up to 5 MB ride the Supabase Storage
    // fallback (same signed-PUT protocol — the API still never proxies the
    // bytes); larger ones honestly need R2.
    if (!recordsStorageEnabled() && bytes > MAX_FALLBACK_FILE_BYTES) {
      return res503(res, "This deployment has no R2 file storage yet — files up to 5 MB upload to the built-in Supabase storage; larger ones need the R2_* variables.");
    }
  }

  const { uploadUrl, fileKey, store } = await createPresignedUpload(String(name).trim(), mime, req.user.id, { sizeBytes: bytes });
  res200(res, { uploadUrl, fileKey, store });
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
  // Semantic search index — the name always, pasted text too. Fire-and-forget:
  // an embedding hiccup must not fail a create; the sweeper repairs gaps.
  void indexRecord({
    userId, recordId: data.id, name: data.name, contentKey: data.file_key,
    pasteText: data.kind === "paste" ? data.content : null,
  });
  // "Always extract": an audio/video upload transcribes ITSELF, right now —
  // the transcript (and its search chunks) simply exist before anyone opens
  // the record. Claim-first, so this and the explicit route are one job.
  if (data.kind === "upload" && data.file_key && avEnabled() && autoTranscribeEnabled() && avKindOf(data.mime, data.name)) {
    void createPresignedDownload(data.file_key, { downloadName: data.name })
      .then((fileUrl) => autoTranscribeContent({
        userId, contentKey: data.file_key, name: data.name, mime: data.mime, fileUrl,
      }))
      .catch(() => {});
  }
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

// ─── GET /api/records/search?q= — semantic library search ──────────────────
// Hybrid RRF (vector + lexical) over the learner's OWN chunks — see
// 2026-record-search.sql. Degrades to lexical-only when embeddings are
// unavailable; never searches anyone else's library.
router.get("/search", authenticateToken, asyncHandler(async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res400(res, "A search query is required.");
  try {
    const results = await searchRecordChunks({
      userId: req.user.id, q,
      limit: Number(req.query.limit) || 12,
    });
    res200(res, { results, query: q });
  } catch (err) {
    console.warn("[record-search] search failed:", String(err?.message || err).slice(0, 160));
    res200(res, { results: [], query: q, error: "Search is unavailable right now." });
  }
}));

/* ── The Contents/Materials discovery feed (Discover hub, higher-ed) ────────
   Everyone's uploaded material — videos, audio, PDFs, images, text files
   and pasted notes — discoverable by the whole community, with the one
   exception the product draws: uploads owned by PREMIUM subscribers never
   appear (their material stays private to them; see access.js). */

// ─── GET /api/records/discover — the feed list ─────────────────────────────
// METADATA ONLY: browsing the feed costs this API no storage calls — no
// presigned URLs are minted until a learner opens one record. Paste rows
// carry a short preview; the full text rides on /discover/:id/open.
router.get("/discover", authenticateToken, asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 80, 1), 100);
  const premiumIds = await activePremiumUserIds();
  // ?q= — database search across the record's name and (for pastes) its
  // text (PostgREST or-ilike; term sanitised for the grammar).
  const term = String(req.query.q ?? "").replace(/[,()%\\]/g, " ").trim().slice(0, 80);

  let query = edu().from("records")
    .select("id, user_id, kind, name, mime, size, duration, file_key, content, created_at")
    .in("kind", ["upload", "paste"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (premiumIds.length) query = query.not("user_id", "in", `(${premiumIds.join(",")})`);
  if (term) query = query.or(`name.ilike.%${term}%,content.ilike.%${term}%`);
  const { data: rows, error } = await query;
  if (error) throw error;

  // Legacy detail-only uploads (no file_key) can't be opened by anyone.
  const openable = (rows || []).filter((r) => r.kind === "paste" || r.file_key);

  const ownerIds = [...new Set(openable.map((r) => r.user_id).filter(Boolean))];
  const owners = new Map();
  if (ownerIds.length) {
    const { data: users } = await edu().from("users").select("id, full_name").in("id", ownerIds);
    for (const u of users || []) owners.set(u.id, u.full_name || "Learner");
  }

  res200(res, openable.map((r) => ({
    id: r.id,
    ownerId: r.user_id,
    ownerName: owners.get(r.user_id) || "Learner",
    kind: r.kind,
    name: r.name,
    mime: r.mime || "",
    size: r.size || 0,
    duration: r.duration ?? null,
    fileType: r.kind === "upload" ? detectType(r.mime || "", r.name || "") : "note",
    contentPreview: r.kind === "paste" ? String(r.content || "").slice(0, 280) : "",
    createdAt: r.created_at,
  })));
}));

// ─── GET /api/records/discover/:id/open — open one discovered record ───────
// One call per open: presign an upload's file (with its download name), or
// hand back a paste's full text. Premium-owned records answer 404 — they
// were never in the feed, and a guessed or stale id must not leak them.
router.get("/discover/:id/open", authenticateToken, asyncHandler(async (req, res) => {
  const { data: r, error } = await edu().from("records")
    .select("id, user_id, kind, name, file_key, content")
    .eq("id", req.params.id).maybeSingle();
  if (error || !r || !["upload", "paste"].includes(r.kind)) return res404(res, "Record not found.");
  if (r.kind === "upload" && !r.file_key) return res400(res, "This record has no saved file.");
  const premiumIds = await activePremiumUserIds();
  if (premiumIds.includes(r.user_id)) return res404(res, "Record not found.");
  if (r.kind === "paste") return res200(res, { content: r.content || "" });
  const url = await createPresignedDownload(r.file_key, { downloadName: r.name })
    .catch((err) => {
      console.error("[records] discover presign failed:", err?.message || err);
      return null;
    });
  if (!url) return res503(res, "Could not sign that file — try again.");
  res200(res, { url, contentKey: r.file_key });   // the shared AI cache key
}));

/* ── Folders — the shelf's organization layer ─────────────────────────────
   The create flow ships first ("Add to library" → Create a folder);
   putting items INTO folders lands next. visibility is stored as the
   learner chose it — 'public' folders get their browsing surface when
   the shared library ships, nothing pretends they're browsable today. */
const folderToApi = async (f, itemCount = 0) => ({
  id: f.id,
  name: f.name,
  description: f.description || "",
  visibility: f.visibility,
  itemCount,
  coverUrl: f.cover_key
    ? await createPresignedDownload(f.cover_key).catch(() => null)  // a storage hiccup degrades the cover, never the list
    : null,
  createdAt: f.created_at,
});

/* Item counts for a learner's folders in one query (the folder list
   renders them; a folder holds ≤ 200 items so this stays small). */
async function folderItemCounts(userId) {
  const { data } = await edu().from("library_folder_items")
    .select("folder_id").eq("user_id", userId);
  const counts = new Map();
  for (const row of data || []) counts.set(row.folder_id, (counts.get(row.folder_id) || 0) + 1);
  return counts;
}

/* Validate + normalize an item payload shared by the add route.
   Returns { error } or the row fields (without folder_id/user_id). */
function normalizeItemPayload(body = {}) {
  const itemType = String(body.itemType || "").trim();
  if (!ITEM_TYPES.has(itemType)) return { error: `itemType must be one of: ${[...ITEM_TYPES].join(", ")}.` };
  const itemRef = String(body.itemRef || "").trim();
  if (!itemRef || itemRef.length > 200) return { error: "itemRef is required (≤ 200 characters)." };
  const title = String(body.title || "").trim();
  if (!title || title.length > 255) return { error: "A title is required (≤ 255 characters)." };
  const sub = String(body.sub || "").trim().slice(0, 255) || null;
  const kind = String(body.kind || "").trim().slice(0, 50) || null;
  if (kind && !ITEM_KINDS.has(kind)) return { error: `kind must be one of: ${[...ITEM_KINDS].join(", ")}.` };
  const link = String(body.link || "").trim();
  if (link && !/^\/[a-zA-Z0-9\-_/]*$/.test(link)) return { error: "link must be an in-app path starting with /." };
  return { row: { item_type: itemType, item_ref: itemRef, title, sub, kind, link: link || null } };
}

// ─── GET /api/records/folders — my folders, newest first ───────────────────
router.get("/folders", authenticateToken, asyncHandler(async (req, res) => {
  const { data, error } = await edu().from("library_folders")
    .select("*").eq("user_id", req.user.id)
    .order("created_at", { ascending: false }).limit(MAX_FOLDERS);
  if (error) throw error;
  const counts = await folderItemCounts(req.user.id).catch(() => new Map());
  res200(res, await Promise.all((data || []).map((f) => folderToApi(f, counts.get(f.id) || 0))));
}));

// ─── POST /api/records/folders — create one ────────────────────────────────
router.post("/folders", authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const body = req.body || {};

  const name = String(body.name || "").trim();
  if (!name) return res400(res, "A folder name is required.");
  if (name.length > MAX_FOLDER_NAME) return res400(res, "Folder names are capped at 100 characters.");
  const description = String(body.description || "").trim();
  if (description.length > MAX_FOLDER_DESC) return res400(res, "Descriptions are capped at 500 characters.");
  const visibility = body.visibility === "public" ? "public" : "private";

  // A cover, when given, must be the learner's own freshly-uploaded image.
  let coverKey = String(body.coverKey || "").trim();
  if (coverKey) {
    if (!ownsRecordFileKey(coverKey, userId)) return res403(res, "That cover image does not belong to you.");
    coverKey = coverKey.slice(0, 500);
  } else {
    coverKey = null;
  }

  const { count } = await edu().from("library_folders").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if ((count || 0) >= MAX_FOLDERS) return res400(res, `You already have ${MAX_FOLDERS} folders — that's the cap.`);

  const { data, error } = await edu().from("library_folders")
    .insert({ user_id: userId, name, description: description || null, cover_key: coverKey, visibility })
    .select().single();
  if (error) {
    if (/duplicate key|unique/i.test(String(error.message || ""))) {
      return res400(res, "You already have a folder with that name.");
    }
    throw error;
  }
  res201(res, await folderToApi(data));
}));

// ─── PATCH /api/records/folders/:id — rename (and re-describe/re-visibility) ─
router.patch("/folders/:id", authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { data: existing } = await edu().from("library_folders")
    .select("id, user_id").eq("id", req.params.id).maybeSingle();
  if (!existing) return res404(res, "Folder not found.");
  if (existing.user_id !== userId) return res403(res, "Not your folder.");

  const patch = { updated_at: new Date().toISOString() };
  if (req.body?.name !== undefined) {
    const name = String(req.body.name || "").trim();
    if (!name) return res400(res, "A folder name is required.");
    if (name.length > MAX_FOLDER_NAME) return res400(res, "Folder names are capped at 100 characters.");
    patch.name = name;
  }
  if (req.body?.description !== undefined) {
    const description = String(req.body.description || "").trim();
    if (description.length > MAX_FOLDER_DESC) return res400(res, "Descriptions are capped at 500 characters.");
    patch.description = description || null;
  }
  if (req.body?.visibility !== undefined) {
    patch.visibility = req.body.visibility === "public" ? "public" : "private";
  }

  const { data, error } = await edu().from("library_folders")
    .update(patch).eq("id", req.params.id).select().single();
  if (error) {
    if (/duplicate key|unique/i.test(String(error.message || ""))) {
      return res400(res, "You already have a folder with that name.");
    }
    throw error;
  }
  res200(res, await folderToApi(data));
}));

// ─── DELETE /api/records/folders/:id — row + best-effort cover object ───────
router.delete("/folders/:id", authenticateToken, asyncHandler(async (req, res) => {
  const { data: existing } = await edu().from("library_folders")
    .select("id, user_id, cover_key").eq("id", req.params.id).maybeSingle();
  if (!existing) return res404(res, "Folder not found.");
  if (existing.user_id !== req.user.id) return res403(res, "Not your folder.");

  const { error } = await edu().from("library_folders").delete().eq("id", req.params.id);
  if (error) throw error;
  void removeRecordFile(existing.cover_key);  // best-effort — the row is gone either way
  res.status(200).json({ success: true, data: { id: req.params.id } });
}));

/* ── Folder items ──────────────────────────────────────────────────────────
   Anything can land in a folder: a record, a Pharm.D topic, a course
   lesson, a library shelf item. The display snapshot (title, sub,
   kind, link) is stored at ADD time — the folder page renders without
   re-querying every surface, and an item keeps its shape even if the
   source row later changes. */

// ─── GET /api/records/folders/:id/items — the folder's contents ────────────
router.get("/folders/:id/items", authenticateToken, asyncHandler(async (req, res) => {
  const { data: existing } = await edu().from("library_folders")
    .select("id, user_id").eq("id", req.params.id).maybeSingle();
  if (!existing) return res404(res, "Folder not found.");
  if (existing.user_id !== req.user.id) return res403(res, "Not your folder.");

  const { data, error } = await edu().from("library_folder_items")
    .select("id, item_type, item_ref, title, sub, kind, link, created_at")
    .eq("folder_id", req.params.id)
    .order("created_at", { ascending: false }).limit(MAX_FOLDER_ITEMS);
  if (error) throw error;
  res200(res, (data || []).map((it) => ({
    id: it.id, itemType: it.item_type, itemRef: it.item_ref,
    title: it.title, sub: it.sub || "", kind: it.kind || "topic",
    link: it.link || null, createdAt: it.created_at,
  })));
}));

// ─── POST /api/records/folders/items — add one thing to N folders ──────────
// The Add-to-folder page multi-selects folders for a single item, so the
// write is bulk over the learner's own folder ids. Idempotent per folder
// (UNIQUE (folder_id, item_type, item_ref) + upsert-on-conflict).
router.post("/folders/items", authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const body = req.body || {};

  const folderIds = [...new Set(Array.isArray(body.folderIds) ? body.folderIds.map(String) : [])];
  if (!folderIds.length) return res400(res, "Pick at least one folder.");
  if (folderIds.length > MAX_FOLDERS) return res400(res, "Too many folders selected.");

  const { error: itemErr, row } = normalizeItemPayload(body);
  if (itemErr) return res400(res, itemErr);

  // Every target folder must be the learner's own.
  const { data: owned } = await edu().from("library_folders")
    .select("id, name").eq("user_id", userId).in("id", folderIds);
  const ownedIds = new Set((owned || []).map((f) => f.id));
  if (ownedIds.size !== folderIds.length) return res403(res, "One of those folders isn't yours.");

  for (const folderId of folderIds) {
    // Respect the per-folder cap on every target.
    const { count } = await edu().from("library_folder_items")
      .select("id", { count: "exact", head: true }).eq("folder_id", folderId);
    if ((count || 0) >= MAX_FOLDER_ITEMS) {
      return res400(res, `A folder is full (${MAX_FOLDER_ITEMS} items) — remove one first.`);
    }
    const { error } = await edu().from("library_folder_items")
      .upsert({ folder_id: folderId, user_id: userId, ...row }, { onConflict: "folder_id,item_type,item_ref" });
    if (error) throw error;
  }
  const names = (owned || []).map((f) => f.name);
  res201(res, { added: folderIds.length, folders: names });
}));

/* ─── AI extraction (hanji-parse-4b on RunPod) — scanned PDFs & images ──────
 *
 * The READER rasterizes pages client-side (pdf.js / the loaded image) and
 * posts them here in ≤8-page batches; each page runs one /runsync call on
 * the parse worker, and results land in edu.content_parses — keyed by the
 * STORAGE FILE KEY. A learner's own upload has a user-scoped key (privacy
 * inherits); a SHARED file (discovery) has one key, so it is parsed ONCE
 * and every later opener reads the same rows for free.
 *
 * Identity: { recordId } (your record) or { contentKey } (a shared file's
 * storage key — verified with the exact access rule the discovery feed
 * uses). A single-flight claim (edu.content_jobs) keeps concurrent
 * first-opens from double-spending: the loser gets 409 + the job row and
 * polls instead.
 *
 *   POST /api/records/extract              { recordId|contentKey, pages:≤8 }
 *   GET  /api/records/extract/:recordId    cached extraction (your record)
 *   GET  /api/records/extract/content/:key cached extraction (shared file)
 *
 * NOTE: registered before the generic /:id routes below. Body limit is
 * raised app-wide (app.js) — page JPEGs ride the JSON body, base64'd.
 */
const okExtract = (res, data) => res.json({ success: true, data });

/* recordId | contentKey → { contentKey, name } | { status, message }. */
async function resolveAiContent(req) {
  return resolveContentAccess({ userId: req.user.id, recordId: req.body?.recordId, contentKey: req.body?.contentKey });
}

/*
 * POST /extract — SUBMIT a batch (≤8 rendered pages) and return at once.
 * Each page becomes one async RunPod job; the job ids ride the single-flight
 * claim's result, and GET /extract/status collects them. A GPU page used to
 * ride this request via /runsync — up to 8 × 150 s — past Cloudflare's
 * ~100 s cut, which killed long batches with an HTML error page.
 */
router.post("/extract", authenticateToken, asyncHandler(async (req, res) => {
  if (!recordsExtractionEnabled()) {
    return res.status(501).json({ success: false, error: "Text extraction isn't configured on this deployment yet." });
  }
  const id = await resolveAiContent(req);
  if (id.error !== undefined || id.status) return res.status(id.status).json({ success: false, message: id.message });
  const { contentKey } = id;

  const pages = Array.isArray(req.body?.pages) ? req.body.pages : [];
  if (!pages.length) return res400(res, "Send at least one rendered page.");
  if (pages.length > MAX_PAGES_PER_REQUEST) return res400(res, `Send at most ${MAX_PAGES_PER_REQUEST} pages per request.`);

  // Validate EVERY page before claiming: a 400 after the claim used to leave
  // the file locked as "running" for 10 minutes (everyone else got 409).
  const work = [];
  for (const p of pages) {
    const pageNumber = Number(p?.pageNumber);
    const imageBase64 = typeof p?.imageBase64 === "string" ? p.imageBase64 : "";
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > MAX_RECORD_PAGES) {
      return res400(res, `Page numbers must be 1-${MAX_RECORD_PAGES}.`);
    }
    if (!imageBase64) return res400(res, `Page ${pageNumber} has no image.`);
    if (imageBase64.length > MAX_IMAGE_B64_CHARS) {
      return res400(res, `Page ${pageNumber}'s image is too large — re-render it smaller.`);
    }
    work.push({ pageNumber, b64: imageBase64.replace(/^data:[^,]*,/, "") });   // tolerate data: URIs
  }

  // Single flight: only one batch runs per file; latecomers poll.
  const claimed = await claimContentJob(contentKey, "parse", req.user.id);
  if (!claimed) {
    return res.status(409).json({ success: false, error: "This file is being extracted right now — the shared result will appear in a moment.", job: await getContentJob(contentKey, "parse") });
  }

  const submittedAt = new Date().toISOString();
  const jobs = [];
  let submitError = null;
  for (const { pageNumber, b64 } of work) {
    try {
      const { jobId } = await parsePageRunAsync({ imageBase64: b64 });
      jobs.push({ pageNumber, jobId, state: "pending" });
    } catch (err) {
      submitError = { pageNumber, error: String(err?.message || err).slice(0, 200) };
      break;   // the endpoint is refusing work — don't keep hammering it
    }
  }
  if (!jobs.length) {
    await finishContentJob(contentKey, "parse", "failed", { error: submitError?.error || "Submit failed" });
    return res.status(502).json({ success: false, error: submitError?.error || "The parse worker did not accept the pages — try again." });
  }
  await updateContentJob(contentKey, "parse", { mode: "async", submittedAt, jobs });
  res.status(202).json({
    success: true,
    data: {
      contentKey,
      pending: jobs.map((j) => j.pageNumber),
      ...(submitError ? { failed: [submitError] } : {}),
    },
  });
}));

/*
 * GET /extract/status?recordId=|contentKey= — collect the batch POST
 * /extract submitted. Each poll checks the still-pending jobs on RunPod,
 * saves the pages that finished, and releases the claim once every page
 * is settled (so the reader can send the next batch). Any authorised
 * opener may poll — a shared file's latecomer finishes the batch for all.
 */
router.get("/extract/status", authenticateToken, asyncHandler(async (req, res) => {
  if (!recordsExtractionEnabled()) {
    return res.status(501).json({ success: false, error: "Text extraction isn't configured on this deployment yet." });
  }
  const probe = { ...req, body: { recordId: req.query.recordId, contentKey: req.query.contentKey } };
  const id = await resolveAiContent(probe);
  if (id.status) return res.status(id.status).json({ success: false, message: id.message });
  const { contentKey } = id;

  const job = await getContentJob(contentKey, "parse");
  const batch = job?.result?.mode === "async" && Array.isArray(job.result.jobs) ? job.result : null;
  if (!batch) {
    return okExtract(res, { contentKey, running: job?.status === "running", done: job?.status !== "running", pages: [], failed: [], pending: [] });
  }

  const saved = [];
  let changed = false;
  for (const entry of batch.jobs) {
    if (entry.state !== "pending") continue;
    let polled;
    try { polled = await getParseJob({ jobId: entry.jobId }); }
    catch { continue; }   // a status hiccup — try again on the next poll
    const settled = settleParseJob(polled, { submittedAt: batch.submittedAt });
    if (settled.state === "pending") continue;
    changed = true;
    if (settled.state === "saved") {
      await saveExtractionPage({ contentKey, pageNumber: entry.pageNumber, blocks: settled.blocks, markdown: settled.markdown, model: settled.model });
      entry.state = settled.blank ? "blank" : "saved";
      saved.push({ pageNumber: entry.pageNumber, markdown: settled.markdown, model: settled.model, blocks: settled.blocks, blank: settled.blank });
    } else {
      entry.state = "failed";
      entry.error = settled.error;
      if (settled.rawPreview) entry.rawPreview = settled.rawPreview;
    }
  }

  const pending = batch.jobs.filter((j) => j.state === "pending").map((j) => j.pageNumber);
  const failed  = batch.jobs.filter((j) => j.state === "failed").map(({ pageNumber, error, rawPreview }) => ({ pageNumber, error, ...(rawPreview ? { rawPreview } : {}) }));
  const done = pending.length === 0;
  if (done) {
    const ok = batch.jobs.filter((j) => j.state === "saved" || j.state === "blank").length;
    await finishContentJob(contentKey, "parse", ok ? "done" : "failed", { ...batch, pages: ok });
  } else if (changed) {
    await updateContentJob(contentKey, "parse", batch);
  }
  // Search index for the pages this poll saved — never blocks the reply.
  if (saved.length) void indexByContentKey({ contentKey, pages: saved });
  okExtract(res, { contentKey, done, pages: saved, pending, failed });
}));

router.get("/extract/:recordId", authenticateToken, asyncHandler(async (req, res) => {
  const recordId = String(req.params.recordId || "");
  if (!/^[0-9a-f-]{36}$/i.test(recordId)) return res400(res, "A recordId is required.");
  const { data: rec, error } = await edu().from("records")
    .select("file_key").eq("id", recordId).eq("user_id", req.user.id).maybeSingle();
  if (error) throw error;
  if (!rec) return res.status(404).json({ success: false, message: "Record not found." });
  okExtract(res, rec.file_key ? await getExtraction(rec.file_key) : { pages: [], markdown: "" });
}));

router.get("/extract/content/:key", authenticateToken, asyncHandler(async (req, res) => {
  const contentKey = String(req.params.key || "");
  if (!contentKey) return res400(res, "A content key is required.");
  const probe = { ...req, body: { contentKey } };
  const id = await resolveAiContent(probe);
  if (id.status) return res.status(id.status).json({ success: false, message: id.message });
  okExtract(res, await getExtraction(id.contentKey));
}));

// ─── Ask: questions about ONE document, answered with citations ─────────────
/*
 * recordId (the learner's own record — any kind) | contentKey (a shared
 * file, the same access rule extraction uses) → the record whose search
 * chunks answer: { recordId, ownerId, contentKey, name } or { status, message }.
 */
async function resolveAskTarget(req, src) {
  return resolveAskTargetFor({ userId: req.user.id, recordId: src?.recordId, contentKey: src?.contentKey });
}

const cleanSelection = (sel) => {
  const text = typeof sel?.text === "string" ? sel.text.trim().slice(0, ASK_LIMITS.MAX_SELECTION_CHARS) : "";
  if (!text) return null;
  const pageNumber = Number(sel?.pageNumber);
  return { text, ...(Number.isInteger(pageNumber) && pageNumber >= 1 ? { pageNumber } : {}) };
};

/*
 * POST /api/records/ask[?stream=1] { recordId | contentKey, question, selection? }
 * Streams the answer as `delta` events, then `done` with the citations the
 * answer used ([n] → page + bbox, or a recording moment). The turn is saved
 * to the learner's private thread for this document.
 */
router.post("/ask", authenticateToken, asyncHandler(async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question) return res400(res, "Ask a question.");
  if (question.length > ASK_LIMITS.MAX_QUESTION_CHARS) return res400(res, `Keep the question under ${ASK_LIMITS.MAX_QUESTION_CHARS} characters.`);
  const selection = cleanSelection(req.body?.selection);
  const target = await resolveAskTarget(req, req.body);
  if (target.status) return res.status(target.status).json({ success: false, message: target.message });

  const wantsStream = req.query.stream === "1";
  const send = (event, data) => {
    if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  let heartbeat = null;
  if (wantsStream) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders?.();
    heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(": ping\n\n"); }, 20_000);
    heartbeat.unref?.();
    res.on("close", () => clearInterval(heartbeat));
    send("status", { step: "search", label: "Searching this document…" });
  }
  const fail = (status, message) => {
    if (wantsStream) { send("error", { error: message }); clearInterval(heartbeat); return res.end(); }
    return res.status(status).json({ success: false, message });
  };

  try {
    const [history, { passages, indexed }] = await Promise.all([
      loadAskHistory({ userId: req.user.id, recordId: target.recordId, limit: ASK_LIMITS.HISTORY_TURNS * 2 }).catch(() => []),
      gatherPassages({ target, question, selection, search: searchRecordChunks }),
    ]);
    if (!indexed && !selection) {
      return fail(409, "This document isn't searchable yet — extract its text (or transcribe the recording) first, then ask again.");
    }
    if (wantsStream) send("status", { step: "answer", label: "Writing the answer…", passages: passages.length });

    const messages = buildAskMessages({ docName: target.name, passages, question, history });
    let answer = "";
    if (wantsStream) {
      const stream = await openai.chat.completions.create({ model: OPENAI_MODEL, temperature: 0.2, max_tokens: 900, messages, stream: true });
      for await (const chunk of stream) {
        if (res.destroyed) break;   // the learner left; usage so far is still metered
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) { answer += delta; send("delta", { text: delta }); }
      }
    } else {
      const completion = await openai.chat.completions.create({ model: OPENAI_MODEL, temperature: 0.2, max_tokens: 900, messages });
      answer = completion.choices?.[0]?.message?.content?.trim() || "";
    }
    answer = answer.trim() || "I couldn't produce an answer from this document — try rephrasing the question.";
    const { citations } = extractCitations(answer, passages);

    let messageId = null;
    try {
      ({ assistantMessageId: messageId } = await saveAskTurn({ userId: req.user.id, recordId: target.recordId, question, selection, answer, citations }));
    } catch (e) {
      console.warn("[records-ask] saving the turn failed:", String(e?.message || e).slice(0, 160));
    }
    const payload = { answer, citations, messageId, passages: passages.length };
    if (wantsStream) { send("done", payload); clearInterval(heartbeat); return res.end(); }
    return res.json({ success: true, data: payload });
  } catch (err) {
    console.warn("[records-ask] failed:", String(err?.message || err).slice(0, 200));
    if (err?.name === "InsufficientCoins") return fail(402, "You're out of AI credit — top up to keep asking.");
    return fail(502, "Couldn't answer right now — try again in a moment.");
  }
}));

/* GET /api/records/ask/history?recordId=|contentKey= — the learner's thread. */
router.get("/ask/history", authenticateToken, asyncHandler(async (req, res) => {
  const target = await resolveAskTarget(req, req.query);
  if (target.status) return res.status(target.status).json({ success: false, message: target.message });
  const messages = await loadAskHistory({ userId: req.user.id, recordId: target.recordId });
  res.json({ success: true, data: { messages } });
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

/* ── Course-video transcription target ───────────────────────────────────────
 * A lesson's video_url (often a presigned, expiring HLS stream) transcribes
 * into the SAME shared cache a record uses, keyed `lesson:<id>` — one
 * transcription per lesson for everyone, claimed once. Access mirrors
 * GET /api/lessons/:id exactly: instructors/admins, active enrollees, and
 * preview lessons. */
async function resolveLessonContent(lessonId, user, { requireVideo = true } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(lessonId)) return { status: 400, message: "A valid lessonId is required." };
  const { data: lesson, error } = await db.from("lessons")
    .select("id, title, video_url, is_preview, course_modules ( course_id )")
    .eq("id", lessonId).maybeSingle();
  if (error) throw error;
  if (!lesson) return { status: 404, message: "Lesson not found." };
  if (requireVideo && !lesson.video_url) return { status: 400, message: "This lesson has no video to transcribe yet." };

  if (!lesson.is_preview && !["instructor", "admin"].includes(user.role)) {
    const courseId = lesson.course_modules?.course_id;
    const { data: enrollment } = await db.from("enrollments")
      .select("id").eq("user_id", user.id).eq("course_id", courseId).eq("status", "active").maybeSingle();
    if (!enrollment) return { status: 403, message: "Enrol in this course to use this lesson." };
  }
  return {
    contentKey: `lesson:${lesson.id}`,
    name: lesson.title,
    mime: "video/mp4",
    fileUrl: lesson.video_url,
  };
}

/* ─── Audio/video transcription (ffmpeg 16k-mono → Deepgram, scene frames
 * → captions) — the Fortizo §5 lane ─────────────────────────────────────────
 *
 *   POST /api/records/transcribe            { recordId } → job started
 *   GET  /api/records/transcribe/:recordId  { job, transcript }
 *
 * The job downloads the ORIGINAL via presigned URL, extracts audio at the
 * STT-native rate (16 kHz mono — never the raw video), transcribes with
 * nova-2 (diarized, paragraph-timestamped), samples scene-change frames
 * for slide captions, and writes edu.content_transcripts (delete-then-
 * insert — re-running is idempotent). One job per record at a time.
 */
const avJobs = new Map();   // recordId → { running, startedAt, finishedAt, log, result }
const avJobSnapshot = (j) => j && ({
  running: j.running, startedAt: j.startedAt, finishedAt: j.finishedAt,
  log: j.log.slice(-60), result: j.result,
});

router.post("/transcribe", authenticateToken, asyncHandler(async (req, res) => {
  if (!avEnabled()) {
    return res.status(501).json({ success: false, error: "Transcription isn't configured on this deployment yet." });
  }
  // Two target kinds share this lane: a library record (recordId/contentKey —
  // the file downloads via presigned URL) and a course lesson (lessonId — the
  // stream URL is already fetchable, HLS included; ffmpeg reads it directly).
  const lessonId = String(req.body?.lessonId || "");
  let target;
  if (lessonId) {
    target = await resolveLessonContent(lessonId, req.user);
    if (target.status) return res.status(target.status).json({ success: false, message: target.message });
  } else {
    const id = await resolveAiContent(req);
    if (id.status) return res.status(id.status).json({ success: false, message: id.message });
    target = { ...id, fileUrl: await createPresignedDownload(id.contentKey, { downloadName: id.name }) };
  }
  const { contentKey, name: recName, fileUrl } = target;

  const mime = target.mime || "";
  const avKind = /^video\//.test(mime) || /\.(mp4|m4v|mov|webm|mkv)$/i.test(recName || "") ? "video"
    : /^audio\//.test(mime) || /\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(recName || "") ? "audio" : null;
  if (!avKind) return res400(res, "Only audio and video records transcribe.");

  // Cross-instance single flight (edu.content_jobs) — a shared recording
  // is transcribed ONCE no matter who opens it first.
  const claimed = await claimContentJob(contentKey, "av", req.user.id);
  if (!claimed) {
    return res.status(409).json({ success: false, error: "This recording is being transcribed right now — the shared transcript will appear in a moment.", job: await getContentJob(contentKey, "av") });
  }
  const job = { running: true, startedAt: new Date().toISOString(), finishedAt: null, log: [], result: null };
  avJobs.set(contentKey, job);
  transcribeRecord({
    userId: req.user.id, contentKey, recordName: recName, kind: avKind, fileUrl,
    onLog: (line) => job.log.push(line),
  })
    .then((result) => {
      job.result = result;
      // Search index (owner's record; lesson keys resolve to no record and
      // are skipped) — never blocks the job's completion.
      void indexByContentKey({ contentKey, segments: result.segments });
      return finishContentJob(contentKey, "av", "done", { segments: result.segments });
    })
    .catch((err) => {
      job.log.push(`[av] FAILED: ${String(err?.message || err).slice(0, 220)}`);
      job.result = { ok: false, error: String(err?.message || err).slice(0, 220) };
      return finishContentJob(contentKey, "av", "failed", { error: String(err?.message || err).slice(0, 200) });
    })
    .finally(() => { job.running = false; job.finishedAt = new Date().toISOString(); });

  res.json({ success: true, data: { job: avJobSnapshot(job), kind: avKind } });
}));

router.get("/transcribe/lesson/:lessonId", authenticateToken, asyncHandler(async (req, res) => {
  const target = await resolveLessonContent(String(req.params.lessonId || ""), req.user, { requireVideo: false });
  if (target.status) return res.status(target.status).json({ success: false, message: target.message });
  res.json({ success: true, data: {
    job: avJobSnapshot(avJobs.get(target.contentKey) || null) || await getContentJob(target.contentKey, "av"),
    transcript: await getTranscript(target.contentKey),
  } });
}));

router.get("/transcribe/:recordId", authenticateToken, asyncHandler(async (req, res) => {
  const recordId = String(req.params.recordId || "");
  if (!/^[0-9a-f-]{36}$/i.test(recordId)) return res400(res, "A recordId is required.");
  const { data: rec, error } = await edu().from("records")
    .select("file_key").eq("id", recordId).eq("user_id", req.user.id).maybeSingle();
  if (error) throw error;
  if (!rec) return res.status(404).json({ success: false, message: "Record not found." });
  res.json({ success: true, data: {
    job: avJobSnapshot(avJobs.get(rec.file_key) || null),
    transcript: rec.file_key ? await getTranscript(rec.file_key) : { segments: [], text: "" },
  } });
}));

router.get("/transcribe/content/:key", authenticateToken, asyncHandler(async (req, res) => {
  const contentKey = String(req.params.key || "");
  if (!contentKey) return res400(res, "A content key is required.");
  const probe = { ...req, body: { contentKey } };
  const id = await resolveAiContent(probe);
  if (id.status) return res.status(id.status).json({ success: false, message: id.message });
  res.json({ success: true, data: {
    job: avJobSnapshot(avJobs.get(id.contentKey) || null) || await getContentJob(id.contentKey, "av"),
    transcript: await getTranscript(id.contentKey),
  } });
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
