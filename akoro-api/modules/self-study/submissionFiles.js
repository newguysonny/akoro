/**
 * modules/self-study/submissionFiles.js — a learner's activity attachments,
 * in object storage.
 *
 * Attachments used to be base64 text in Postgres (edu.self_study_files.data).
 * They now go to the same object store library records use (R2, or the
 * Supabase fallback), under the LEARNER's own prefix; the row keeps the key.
 * Rows written before this still carry `data` and keep working.
 *
 * What a file is gets decided by its bytes, not the browser's label: a PDF,
 * a JPEG / PNG image, a Word .docx or plain text — the kinds the submission
 * PDF can carry. Anything else is refused at upload.
 */
import { putRecordObject, createPresignedDownload, removeRecordFile, ownsRecordFileKey } from "../records/lib/storage.js";
import { downloadCapped } from "../records/officeText.js";

// MAX_FILES: a submission without questions; PER_QUESTION: each question of
// one with questions (a photo, a document, a whiteboard drawing).
export const SUBMISSION_FILE_LIMITS = Object.freeze({ MAX_BYTES: 5 * 1024 * 1024, MAX_FILES: 5, PER_QUESTION: 3 });

const MIME_OF = { pdf: "application/pdf", jpeg: "image/jpeg", png: "image/png", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", text: "text/plain" };

/**
 * Sniff the bytes → { kind, format, mime } or null.
 * kind: pdf | image | docx | text (what the PDF builder does with it).
 */
export function sniffSubmissionFile(bytes, name = "") {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (b.length < 4) return null;
  if (b.subarray(0, 1024).includes(Buffer.from("%PDF-"))) return { kind: "pdf", format: "pdf", mime: MIME_OF.pdf };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "image", format: "jpeg", mime: MIME_OF.jpeg };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { kind: "image", format: "png", mime: MIME_OF.png };
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    // A zip: only a Word document is accepted (it names word/document.xml).
    return b.includes(Buffer.from("word/")) ? { kind: "docx", format: "docx", mime: MIME_OF.docx } : null;
  }
  if (/\.(txt|md|csv)$/i.test(String(name)) && isMostlyText(b)) return { kind: "text", format: "text", mime: MIME_OF.text };
  return null;
}

function isMostlyText(b) {
  const sample = b.subarray(0, 4096);
  if (sample.includes(0)) return false;
  const s = sample.toString("utf8");
  const bad = (s.match(/\uFFFD/g) || []).length;
  return bad <= Math.max(2, s.length * 0.01);
}

/**
 * Store one attachment → { storage_key } (object storage) or { data } (base64
 * in the row) when no store will take it — an upload never fails on storage.
 */
export async function storeSubmissionFile({ learnerId, targetId, name, bytes, mime }, deps = {}) {
  const put = deps.put || putRecordObject;
  try {
    const safe = String(name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
    const key = await put({ userId: learnerId, name: `submissions/${targetId}/${safe}`, body: bytes, contentType: mime });
    return { storage_key: key, data: null };
  } catch (e) {
    console.warn("[self-study/files] object storage refused the file — kept in the row:", String(e?.message || e).slice(0, 160));
    return { storage_key: null, data: Buffer.from(bytes).toString("base64") };
  }
}

/** A file row → its bytes (object storage, or the legacy base64 column). */
export async function readSubmissionFile(row, deps = {}) {
  if (row?.storage_key) {
    const presign = deps.presign || createPresignedDownload;
    const download = deps.download || downloadCapped;
    return download(await presign(row.storage_key), { maxBytes: 120 * 1024 * 1024 });
  }
  if (typeof row?.data === "string" && row.data) return Buffer.from(row.data, "base64");
  throw new Error("This file has no stored bytes.");
}

/** Best-effort delete of a row's stored object (only under its learner's prefix). */
export async function removeSubmissionObject(key, learnerId) {
  if (key && ownsRecordFileKey(key, learnerId)) await removeRecordFile(key).catch(() => {});
}

/** RFC 6266 filename header — readable in every browser, safe for any name. */
export function contentDisposition(name, type = "inline") {
  const n = String(name || "file");
  const ascii = n.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(n)}`;
}
