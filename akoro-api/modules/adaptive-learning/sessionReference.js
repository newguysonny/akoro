/**
 * sessionReference.js
 * ───────────────────
 * A short-lived, learner-supplied document used to ground one adaptive
 * teaching session. References are deliberately not persisted: the learner
 * chooses them in the start-session modal, they are read to make the lesson
 * more relevant, and the extracted text stays only with that live session.
 */

import pdfParse from "pdf-parse/lib/pdf-parse.js";

export const MAX_REFERENCE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_REFERENCE_CHARS = 12_000;

const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/csv"]);
const TEXT_EXTENSIONS = /\.(txt|md|csv)$/i;
const PDF_EXTENSION = /\.pdf$/i;

const cleanText = (value) => String(value || "")
  .replace(/\u0000/g, "")
  .replace(/\r\n/g, "\n")
  .trim();

const safeName = (value) => String(value || "reference")
  .replace(/[\r\n]/g, " ")
  .trim()
  .slice(0, 180) || "reference";

export const isSupportedSessionReference = (file) => {
  const type = String(file?.mimetype || file?.type || "").toLowerCase();
  const name = String(file?.originalname || file?.name || "");
  return type === "application/pdf" || TEXT_TYPES.has(type) || PDF_EXTENSION.test(name) || TEXT_EXTENSIONS.test(name);
};

/**
 * Normalize a reference received over REST or Socket.IO. The server keeps the
 * hard text cap even though /teaching/reference already applies it, because a
 * client can emit Socket.IO events without calling that endpoint first.
 */
export function normalizeSessionReference(value) {
  const text = cleanText(value?.text).slice(0, MAX_REFERENCE_CHARS);
  if (!text) return null;
  return {
    name:      safeName(value?.name),
    text,
    chars:     text.length,
    truncated: Boolean(value?.truncated) || cleanText(value?.text).length > text.length,
  };
}

/** Extract a safe, prompt-ready text reference from an uploaded PDF/text file. */
export async function readSessionReference(file) {
  if (!file) {
    const err = new Error("Choose a reference file first.");
    err.status = 400;
    throw err;
  }
  if (!isSupportedSessionReference(file)) {
    const err = new Error("Use a PDF, TXT, Markdown, or CSV file.");
    err.status = 415;
    throw err;
  }
  if (!file.buffer || file.size > MAX_REFERENCE_BYTES) {
    const err = new Error("That reference file is too large. The limit is 5 MB.");
    err.status = 413;
    throw err;
  }

  const name = safeName(file.originalname || file.name);
  const type = String(file.mimetype || file.type || "").toLowerCase();
  let extracted = "";

  if (type === "application/pdf" || PDF_EXTENSION.test(name)) {
    const parsed = await pdfParse(file.buffer);
    extracted = parsed?.text || "";
  } else {
    extracted = file.buffer.toString("utf8");
  }

  const original = cleanText(extracted);
  if (!original) {
    const err = new Error("We couldn't read text from that file. Try a text-based PDF or a TXT, Markdown, or CSV file.");
    err.status = 422;
    throw err;
  }

  const text = original.slice(0, MAX_REFERENCE_CHARS);
  return { name, text, chars: text.length, truncated: original.length > text.length };
}
