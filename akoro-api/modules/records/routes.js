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

/* ── The Contents/Materials discovery feed (Discover hub, higher-ed) ────────
   Everyone's uploaded material — videos, audio, PDFs, images, text files
   and pasted notes — discoverable by the whole community, with the one
   exception the product draws: uploads owned by PREMIUM subscribers never
   appear (their material stays private to them). */
async function activePremiumUserIds() {
  const { data: tierRows } = await edu().from("tiers")
    .select("id").eq("platform", "learner").eq("access", "paid").eq("name", "Premium").limit(1);
  const tierId = tierRows?.[0]?.id ?? null;
  if (!tierId) return [];
  const { data: subs } = await edu().from("subscriptions")
    .select("user_id").eq("tier_id", tierId).in("status", ["active", "trial", "trialing"]);
  return [...new Set((subs || []).map((s) => s.user_id).filter(Boolean))];
}

// ─── GET /api/records/discover — the feed list ─────────────────────────────
// METADATA ONLY: browsing the feed costs this API no storage calls — no
// presigned URLs are minted until a learner opens one record. Paste rows
// carry a short preview; the full text rides on /discover/:id/open.
router.get("/discover", authenticateToken, asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 80, 1), 100);
  const premiumIds = await activePremiumUserIds();

  let query = edu().from("records")
    .select("id, user_id, kind, name, mime, size, duration, file_key, content, created_at")
    .in("kind", ["upload", "paste"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (premiumIds.length) query = query.not("user_id", "in", `(${premiumIds.join(",")})`);
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
  res200(res, { url });
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
