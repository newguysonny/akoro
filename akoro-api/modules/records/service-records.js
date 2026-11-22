/**
 * modules/records/service-records.js — uploads, the learner's shelf, the
 * Discover feed, semantic search and the stable file seam.
 *
 * The router stays thin: every handler here owns the flow, while
 * store-records.js owns the Supabase queries and rules.js owns the caps and
 * pure decisions. Ownership checks are never skipped: uploads must own their
 * object key, and record/folder reads and writes are scoped to the caller.
 */
import {
  recordsStorageEnabled, createPresignedUpload, createPresignedDownload, removeRecordFile,
  ownsRecordFileKey, isFallbackFileKey, MAX_FALLBACK_FILE_BYTES, putRecordObject, readFileObject,
} from "./lib/storage.js";
import { renderPreview } from "./preview.js";
import { avEnabled, autoTranscribeContent, autoTranscribeEnabled, avKindOf } from "./avTranscribeLib.js";
import { indexRecord, searchRecordChunks } from "./searchLib.js";
import { activePremiumUserIds } from "./access.js";
import { storedTextKindOf, extractStoredText } from "./storedText.js";
import { getExtractEngine } from "./extractEngine.js";
import { startRecordScanExtraction } from "./extractOcr.js";
import {
  MAX_FILE_BYTES, MAX_TEXT_CHARS, MAX_RECORDS, MAX_COVER_BYTES,
  pageParams, encodeCursor, detectType,
} from "./rules.js";
import { res200, res201, res400, res403, res404, res422, res500, res503 } from "./http.js";
import * as store from "./store-records.js";

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
  hasPreview: !!r.preview_key,
  fileMissing: r.kind === "upload" && !r.file_key,
  url: r.url || null,
  content: r.kind === "paste" ? (r.content || "") : undefined,
  // A gathered content's citation map (marker → the original Discover
  // record), so the reader can open a citation's source and come back.
  sources: Array.isArray(r.sources) && r.sources.length ? r.sources : undefined,
  fileUrl: r.kind === "upload" && r.file_key
    ? await createPresignedDownload(r.file_key).catch((err) => {
        console.error("[records] could not sign fileUrl:", err?.message || err);
        return null;
      })
    : null,
  createdAt: r.created_at,
  lastOpenedAt: r.last_opened_at || null,
});

/* Render page 1 of a stored PDF and keep it as the record's preview.
   Server-side (pdfjs + napi canvas), so it works for uploads the browser sent
   straight to the store and for the backfill script alike. */
export async function generatePreviewForRecord(r, onError = null) {
  if (!r?.id) return null;
  // A pasted note has no file: its page is drawn from the text itself, the
  // same way a text upload is. Everything else needs the stored object.
  const isPaste = r.kind === "paste";
  if (!isPaste && !r.file_key) return null;
  try {
    let body, mime, name = r.name;
    if (isPaste) {
      body = Buffer.from(String(r.content || ""), "utf8");
      mime = "text/markdown";
    } else {
      const file = await readFileObject(r.file_key);
      body = file.body; mime = r.mime || file.contentType;
    }
    // PDF page, downscaled image, or a drawn page for text/markdown; anything
    // else (Office, audio, video) has no honest thumbnail without extra tools.
    const jpg = await renderPreview({ mime, name, body });
    if (!jpg) { onError?.(new Error("no preview for this file type")); return null; }
    const key = await putRecordObject({
      userId: r.user_id, name: `preview-${r.id}.jpg`,
      body: jpg, contentType: "image/jpeg", prefix: "previews",
    });
    const { error } = await store.setPreviewKey(r.id, key);
    if (error) { onError?.(new Error(error.message)); console.error("[records] preview key save failed:", error.message); return null; }
    return key;
  } catch (err) {
    console.error("[records] preview generate failed:", err?.message || err);
    onError?.(err);
    return null;
  }
}

/* The stored bytes of a record's file (diagnostics: engine comparison). */
export async function readRecordFileBytes(recordId) {
  const { data: r } = await store.getRecordWithFile(recordId);
  if (!r?.file_key) return null;
  const { body } = await readFileObject(r.file_key);
  return body;
}

/* POST /api/records/:id/preview — one JPEG of page 1.
   The reader already renders PDF pages with pdf.js, so the client makes the
   image and sends it here; the store keeps it under previews/. Cards then
   show the page instead of a file-type icon. */
export async function uploadPreview(req, res) {
  const { data: r } = await store.getRecordOwner(req.params.id);
  if (!r || r.user_id !== req.user.id) return res404(res, "Record not found.");
  const file = req.file;
  if (!file?.buffer?.length) return res400(res, "No preview image was uploaded.");
  if (!/^image\//.test(file.mimetype || "")) return res400(res, "A preview must be an image.");
  if (file.size > 512 * 1024) return res400(res, "Preview is too large.");
  try {
    const key = await putRecordObject({
      userId: req.user.id, name: `preview-${req.params.id}.jpg`,
      body: file.buffer, contentType: file.mimetype || "image/jpeg", prefix: "previews",
    });
    const { error: saveError } = await store.setPreviewKey(req.params.id, key);
    if (saveError) {
      console.error("[records] preview key save failed:", saveError.message);
      return res500(res, "The preview could not be saved.");
    }
    return res200(res, { previewKey: key });
  } catch (error) {
    return res400(res, error.message || "The preview could not be stored.");
  }
}

/* GET /api/records/:id/preview — the stored page image, through the API. */
export async function openPreview(req, res) {
  const { data: r } = await store.getRecordPreviewRow(req.params.id);
  if (!r || r.deleted_at || !r.preview_key) return res404(res, "No preview.");
  if (r.user_id !== req.user.id) {
    if (r.private) return res404(res, "Record not found.");
    const premiumIds = await activePremiumUserIds();
    if (premiumIds.includes(r.user_id)) return res404(res, "Record not found.");
  }
  const url = await createPresignedDownload(r.preview_key).catch((err) => {
    console.error("[records] preview presign failed:", err?.message || err);
    return null;
  });
  if (!url) return res503(res, "Could not load the preview.");
  return streamFromStore(res, url, { cache: "public, max-age=600" });
}

/* POST /api/records/:id/preview/generate — render page 1 from the stored file. */
export async function generatePreview(req, res) {
  const { data: r } = await store.getRecordOwner(req.params.id);
  if (!r || r.user_id !== req.user.id) return res404(res, "Record not found.");
  const row = (await store.getRecordWithFile(req.params.id)).data;
  if (!row?.file_key) return res400(res, "This record has no saved file.");
  const key = await generatePreviewForRecord(row);
  if (!key) return res422(res, "A preview could not be made for this file.");
  return res200(res, { previewKey: key });
}

/* POST /api/records/upload — the bytes come to us.
   The browser's normal path is a presigned PUT straight to the store. That
   needs bucket CORS, which R2 does not send by default: the PUT fails with a
   network error before any code can explain it. This endpoint accepts the
   same bytes over the API (which the app already reaches, CORS or not) and
   writes them with the server's own credentials. The client falls back to it
   only when the direct PUT fails, so production keeps the fast path. */
export async function uploadFile(req, res) {
  const file = req.file;
  if (!file?.buffer?.length) return res400(res, "No file was uploaded.");
  if (file.size > MAX_FILE_BYTES) return res400(res, "Files are capped at 500 MB.");
  const name = String(req.body?.name || file.originalname || "file").trim().slice(0, 255);
  const mime = String(req.body?.mime || file.mimetype || "");
  if (!detectType(mime, name)) {
    return res400(res, "Only PDFs, Word or PowerPoint files, text files, images, audio or video can be uploaded.");
  }
  const prefix = req.body?.purpose === "folder-cover" ? "covers" : "records";
  try {
    const fileKey = await putRecordObject({ userId: req.user.id, name, body: file.buffer, contentType: mime || "application/octet-stream", prefix });
    return res200(res, { fileKey, size: file.size, store: recordsStorageEnabled() ? "r2" : "supabase" });
  } catch (error) {
    return res400(res, error.message || "The file could not be stored.");
  }
}

// ─── POST /api/records/upload-url ───────────────────────────────────────────
//   body.purpose: 'record' (default) | 'folder-cover' — a cover is
//   image-only and capped at 5 MB, but otherwise rides the exact same
//   presigned-PUT pipeline (R2, or the Supabase fallback where 5 MB is
//   already the bucket's hard cap, so the cover always fits).
export async function createUploadUrl(req, res) {
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
    if (!detectType(mime, name)) return res400(res, "Only PDFs, Word or PowerPoint files, text files, images, audio or video can be uploaded.");
    // No R2 on this deployment? Files up to 5 MB ride the Supabase Storage
    // fallback (same signed-PUT protocol — the API still never proxies the
    // bytes); larger ones honestly need R2.
    if (!recordsStorageEnabled() && bytes > MAX_FALLBACK_FILE_BYTES) {
      return res503(res, "This deployment has no R2 file storage yet — files up to 5 MB upload to the built-in Supabase storage; larger ones need the R2_* variables.");
    }
  }

  const { uploadUrl, fileKey, store } = await createPresignedUpload(String(name).trim(), mime, req.user.id, { sizeBytes: bytes, origin: req.headers.origin || null });
  res200(res, { uploadUrl, fileKey, store });
}

// ─── POST /api/records — register upload / link / paste ─────────────────────
export async function createRecord(req, res) {
  const userId = req.user.id;
  const body = req.body || {};
  const name = String(body.name || "").trim().slice(0, 255);

  const { count } = await store.countRecords(userId);
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
    if (!legacy && !detectType(body.mime, name)) return res400(res, "Only PDFs, Word or PowerPoint files, text files, images, audio or video can be uploaded.");
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

  const { data, error } = await store.insertRecord(row);
  if (error) throw error;
  // Uploads get their page-1 preview now, off the request path: rendering a
  // page takes ~200 ms and the learner should not wait for a thumbnail.
  if ((data.kind === "upload" && data.file_key) || data.kind === "paste") {
    void generatePreviewForRecord(data).catch(() => {});
  }
  // Semantic search index — the name always, pasted text too. Fire-and-forget:
  // an embedding hiccup must not fail a create; the sweeper repairs gaps.
  void indexRecord({
    userId, recordId: data.id, name: data.name, contentKey: data.file_key,
    pasteText: data.kind === "paste" ? data.content : null,
    sourceType: data.kind, docAt: data.created_at || null,
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
  // A scan or image has no free text: on the OCR deployment start the
  // whole-document recognition NOW, so it finishes while the learner is still
  // landing in the reader instead of waiting for the "Read this PDF with AI?"
  // tap. The claim makes the browser's own run poll this job, not repeat it.
  if (data.kind === "upload" && data.file_key && !storedTextKindOf(data.mime, data.name)
      && (/pdf/i.test(data.mime || "") || /\.pdf$/i.test(data.name || "") || /^image\//i.test(data.mime || ""))
      && (await getExtractEngine()) === "ocr") {
    await startRecordScanExtraction({ userId, contentKey: data.file_key, name: data.name });
  }
  // Text the server can read for free — a PDF's text layer, a text file,
  // Word / PowerPoint — becomes the file's pages right away, so Ask and the
  // tools work from the start. (A scanned PDF claims nothing here: the
  // uploader's browser sends it to RunPod.)
  if (data.kind === "upload" && data.file_key && storedTextKindOf(data.mime, data.name)) {
    void createPresignedDownload(data.file_key, { downloadName: data.name })
      .then((fileUrl) => extractStoredText({
        userId, contentKey: data.file_key, name: data.name, mime: data.mime, fileUrl,
      }))
      .catch(() => {});
  }
  res201(res, await toApi(data));
}

// ─── GET /api/records — my shelf ────────────────────────────────────────────
export async function listShelf(req, res) {
  const { paged, limit, cursor } = pageParams(req, 12, 100);
  const { data, error } = await store.listRecords({ userId: req.user.id, limit: paged ? limit : MAX_RECORDS, cursor });
  if (error) throw error;
  const rows = data || [];
  if (!paged) return res200(res, await Promise.all(rows.map(toApi)));
  const { count } = await store.countShelf(req.user.id);
  return res200(res, {
    records: await Promise.all(rows.map(toApi)),
    total: count ?? rows.length,
    nextCursor: rows.length === limit ? encodeCursor(rows[rows.length - 1]) : null,
  });
}

// ─── GET /api/records/search?q= — semantic library search ──────────────────
// Hybrid RRF (vector + lexical) over the learner's OWN chunks — see
// 2026-record-search.sql. Degrades to lexical-only when embeddings are
// unavailable; never searches anyone else's library.
export async function searchShelf(req, res) {
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
}

/* ── The Contents/Materials discovery feed (Discover hub, higher-ed) ────────
   Everyone's uploaded material — videos, audio, PDFs, images, text files
   and pasted notes — discoverable by the whole community, with the one
   exception the product draws: uploads owned by PREMIUM subscribers never
   appear (their material stays private to them; see access.js). */

// ─── GET /api/records/discover — the feed list ─────────────────────────────
// METADATA ONLY: browsing the feed costs this API no storage calls — no
// presigned URLs are minted until a learner opens one record. Paste rows
// carry a short preview; the full text rides on /discover/:id/open.
export async function listDiscover(req, res) {
  // Paged mode (the Discover tab's scroll-to-fetch-more) is gated on
  // ?paged=1 / ?cursor= — NOT on ?limit, which legacy search passes use.
  const discoverPaged = req.query.paged !== undefined || req.query.cursor !== undefined;
  const { limit: pageLimit, cursor } = pageParams(req, 12, 100);
  const limit = discoverPaged ? pageLimit : Math.min(Math.max(parseInt(req.query.limit, 10) || 80, 1), 100);
  const premiumIds = await activePremiumUserIds();
  // ?q= — database search across the record's name and (for pastes) its
  // text (PostgREST or-ilike; term sanitised for the grammar).
  const term = String(req.query.q ?? "").replace(/[,()%\\]/g, " ").trim().slice(0, 80);

  const { data: rows, error } = await store.listDiscover({ limit, premiumIds, term, paged: discoverPaged, cursor });
  if (error) throw error;

  // Legacy detail-only uploads (no file_key) can't be opened by anyone.
  const openable = (rows || []).filter((r) => r.kind === "paste" || r.file_key);

  const ownerIds = [...new Set(openable.map((r) => r.user_id).filter(Boolean))];
  const owners = new Map();
  if (ownerIds.length) {
    const { data: users } = await store.listUserNames(ownerIds);
    for (const u of users || []) owners.set(u.id, u.full_name || "Learner");
  }

  const mapped = openable.map((r) => ({
    id: r.id,
    ownerId: r.user_id,
    ownerName: owners.get(r.user_id) || "Learner",
    kind: r.kind,
    name: r.name,
    mime: r.mime || "",
    size: r.size || 0,
    duration: r.duration ?? null,
    fileType: r.kind === "upload" ? detectType(r.mime || "", r.name || "") : "note",
    hasPreview: !!r.preview_key,
    contentPreview: r.kind === "paste" ? String(r.content || "").slice(0, 280) : "",
    createdAt: r.created_at,
  }));
  if (!discoverPaged) return res200(res, mapped);
  const { count } = await store.countDiscover({ premiumIds, term });
  return res200(res, {
    items: mapped,
    total: count ?? mapped.length,
    nextCursor: (rows || []).length === limit ? encodeCursor(rows[rows.length - 1]) : null,
  });
}

// ─── GET /api/records/discover/:id/open — open one discovered record ───────
// One call per open: presign an upload's file (with its download name), or
// hand back a paste's full text. Premium-owned records answer 404 — they
// were never in the feed, and a guessed or stale id must not leak them.
export async function openDiscover(req, res) {
  const { data: r, error } = await store.getDiscoverRecord(req.params.id);
  if (error || !r || r.deleted_at || !["upload", "paste"].includes(r.kind)) return res404(res, "Record not found.");
  if (r.private && r.user_id !== req.user.id) return res404(res, "Record not found.");
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
  // The app reads shared files through the API: a direct store URL has no
  // CORS in the browser on some deployments (R2), so a shared PDF would not
  // open even though the URL is valid.
  const base = `${req.protocol}://${req.get("host")}`;
  res200(res, { url: `${base}/api/records/discover/${r.id}/file?inline=1`, contentKey: r.file_key });
}

/* Pipe an object's bytes through the API (no storage CORS in the browser).
   Used by every file route; the store URL is fetched server-side. */
async function streamFromStore(res, url, { cache = "private, max-age=0, no-store" } = {}) {
  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) return res.status(502).json({ success: false, error: "Couldn't load the file." });
  res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
  const len = upstream.headers.get("content-length");
  if (len) res.setHeader("Content-Length", len);
  res.setHeader("Cache-Control", cache);
  const { Readable } = await import("node:stream");
  Readable.fromWeb(upstream.body).pipe(res);
}

/* GET /api/records/discover/:id/file — the same access rules as open, but
   the bytes come through the API so a shared document opens on a deployment
   whose bucket sends no CORS headers. */
export async function openDiscoverFile(req, res) {
  const { data: r, error } = await store.getDiscoverRecord(req.params.id);
  if (error || !r || r.deleted_at || !["upload", "paste"].includes(r.kind)) return res404(res, "Record not found.");
  if (r.private && r.user_id !== req.user.id) return res404(res, "Record not found.");
  if (r.kind !== "upload" || !r.file_key) return res404(res, "Record not found.");
  const premiumIds = await activePremiumUserIds();
  if (premiumIds.includes(r.user_id)) return res404(res, "Record not found.");
  const url = await createPresignedDownload(r.file_key, { downloadName: r.name })
    .catch((err) => {
      console.error("[records] discover file presign failed:", err?.message || err);
      return null;
    });
  if (!url) return res503(res, "Could not sign that file — try again.");
  if (req.query.inline === "1") return streamFromStore(res, url, { cache: "public, max-age=600" });
  return res.redirect(302, url);
}

// ─── PATCH /api/records/:id — progress / last-opened ────────────────────────
export async function patchRecord(req, res) {
  const userId = req.user.id;
  const { data: existing } = await store.getRecordOwner(req.params.id);
  if (!existing) return res404(res, "Record not found.");
  if (existing.user_id !== userId) return res403(res, "Not your record.");

  const patch = { updated_at: new Date().toISOString() };
  if (req.body?.progress !== undefined) {
    const p = Number(req.body.progress);
    if (!Number.isInteger(p) || p < 0 || p > 100) return res400(res, "progress must be a whole number between 0 and 100.");
    patch.progress = p;
  }
  if (req.body?.lastOpened) patch.last_opened_at = new Date().toISOString();
  if (req.body?.name !== undefined) {
    const name = String(req.body.name || "").trim().slice(0, 255);
    if (!name) return res400(res, "A file name is required.");
    patch.name = name;
  }

  const { data, error } = await store.updateRecord(req.params.id, patch);
  if (error) throw error;
  res200(res, await toApi(data));
}

// ─── DELETE /api/records/:id — row + best-effort object ─────────────────────
export async function deleteRecord(req, res) {
  const { data: existing } = await store.getRecordWithFile(req.params.id);
  if (!existing) return res404(res, "Record not found.");
  if (existing.user_id !== req.user.id) return res403(res, "Not your record.");

  const { error } = await store.deleteRecord(req.params.id);
  if (error) throw error;
  void removeRecordFile(existing.file_key);  // best-effort — the row is gone either way
  res.status(200).json({ success: true, data: { id: req.params.id } });
}

// ─── GET /api/records/:id/file — stable download seam (302 → presigned) ─────
// The viewer streams from the list's presigned fileUrl; this endpoint is the
// friendly "save a copy" link (cookies auth it, the store serves the bytes).
export async function openFile(req, res) {
  const { data: existing } = await store.getRecordDownload(req.params.id);
  if (!existing) return res404(res, "Record not found.");
  if (existing.user_id !== req.user.id) return res403(res, "Not your record.");
  if (!existing.file_key) return res400(res, "This record has no saved file — only its details were captured.");
  const url = await createPresignedDownload(existing.file_key, { downloadName: existing.name });
  // `?inline=1` streams the bytes THROUGH the API. The reader uses this instead
  // of the storage URL because R2 presigned URLs send no CORS headers, so a
  // browser fetch there is blocked ("Failed to fetch") — the library PDF never
  // loaded. A server-side fetch has no CORS; we pipe it out same-API.
  if (req.query.inline === "1") return streamFromStore(res, url);
  res.redirect(302, url);
}
