/**
 * modules/records/rules.js — pure validation, limits and small decisions.
 *
 * Everything here is synchronous and side-effect free: upload/paste/folder
 * caps, file-kind detection, cursor paging parameters, item-payload
 * validation and the sorted-out selections/services read. No Express, no db.
 */
import { ASK_LIMITS } from "./askLib.js";
import { officeKindOf } from "./officeText.js";

export const MAX_FILE_BYTES   = 500 * 1024 * 1024;  // 500 MB — matches the sheet's guard
export const MAX_TEXT_CHARS   = 20_000;             // matches the sheet's counter
export const MAX_RECORDS      = 200;                // a shelf, not an archive

/* ── Cursor paging (scroll-to-fetch-more, Matt 2026-11-17) ───────────────
   Paged mode is opt-in per request (?limit= / ?cursor=; Discover also
   accepts ?paged=1): the response data becomes { <key>: [...], total,
   nextCursor } while legacy callers keep the bare array they expect. The
   cursor is the last row's (created_at, id); ordering is created_at DESC,
   id DESC, so pages never overlap or skip when new rows land at the top. */
export const pageParams = (req, defLimit, maxLimit) => {
  const paged = req.query.limit !== undefined || req.query.cursor !== undefined || req.query.paged !== undefined;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || defLimit, 1), maxLimit);
  let cursor = null;
  if (req.query.cursor) {
    try { cursor = JSON.parse(Buffer.from(String(req.query.cursor), "base64url").toString("utf8")); } catch { cursor = null; }
  }
  return { paged, limit, cursor };
};

export const encodeCursor = (row, col = "created_at") => (row
  ? Buffer.from(JSON.stringify({ t: row[col], id: row.id }), "utf8").toString("base64url") : null);

export const applyCursor = (q, cursor, col = "created_at") => (cursor && cursor.t
  ? q.or(`${col}.lt.${cursor.t},and(${col}.eq.${cursor.t},id.lt.${cursor.id})`)
  : q);

/* Folders — the shelf's organization layer (created from the
   "Add to library" sheet). A cover rides the SAME presigned storage
   pipeline as record files, just image-only and small. */
export const MAX_FOLDERS        = 50;
export const MAX_FOLDER_NAME    = 100;
export const MAX_FOLDER_DESC    = 500;
export const MAX_COVER_BYTES    = 5 * 1024 * 1024;

/* Folder items — what "Add to folder" puts inside. One item may land
   in several folders at once (the page multi-selects), so the add is
   a bulk write over the user's own folder ids. */
export const MAX_FOLDER_ITEMS   = 200;
export const ITEM_TYPES         = new Set(["record", "pharmd_topic", "lesson", "library"]);
export const ITEM_KINDS         = new Set(["pdf", "docx", "pptx", "audio", "video", "image", "text", "link", "paste", "blog", "course", "topic"]);

/* ── What the viewer can actually open ──────────────────────────────────────
   Mirrors the app's picker: PDF, text, images, audio, video, and Word /
   PowerPoint files (.docx / .pptx) — the server reads their text into
   pages at upload (officeText.js), so the reader opens them as text. */
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|flac)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)$/i;
const TEXT_EXT  = /\.(txt|md|csv)$/i;

export const detectType = (mime = "", name = "") => {
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (/^image\//.test(mime)) return "image";
  if (/^audio\//.test(mime) || AUDIO_EXT.test(name)) return "audio";
  if (/^video\//.test(mime) || VIDEO_EXT.test(name)) return "video";
  if (mime === "text/plain" || mime === "text/markdown" || mime === "text/csv" || TEXT_EXT.test(name)) return "text";
  return officeKindOf(mime, name);   // "docx" | "pptx" | null
};

/* The audio/video kind the transcription lane accepts, or null. */
export const avKindFor = (mime = "", name = "") =>
  /^video\//.test(mime) || VIDEO_EXT.test(name) ? "video"
    : /^audio\//.test(mime) || AUDIO_EXT.test(name) ? "audio" : null;

/* A page's real size from the reader ({ width, height, unit: "pt"|"px" }),
   or null when absent / implausible. */
export function pageSizeOf(p) {
  const width = Number(p?.width);
  const height = Number(p?.height);
  const unit = p?.unit === "px" ? "px" : p?.unit === "pt" ? "pt" : null;
  if (!unit || !(width > 0 && width <= 100_000) || !(height > 0 && height <= 100_000)) return null;
  return { width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100, unit };
}

/* Validate + normalize an item payload shared by the add route.
   Returns { error } or the row fields (without folder_id/user_id). */
export function normalizeItemPayload(body = {}) {
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

/* The learner's highlighted passage, bounded, or null. */
export const cleanSelection = (sel) => {
  const text = typeof sel?.text === "string" ? sel.text.trim().slice(0, ASK_LIMITS.MAX_SELECTION_CHARS) : "";
  if (!text) return null;
  const pageNumber = Number(sel?.pageNumber);
  return { text, ...(Number.isInteger(pageNumber) && pageNumber >= 1 ? { pageNumber } : {}) };
};

/** The history/artifact anchor for a resolved target: folder or record. */
export const anchorOf = (target) => (target.folderId
  ? { folderId: target.folderId }
  : target.recordId
    ? { recordId: target.recordId }
    : target.contentKey
      ? { contentKey: target.contentKey }
      : { recordId: target.recordId });
