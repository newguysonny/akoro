/**
 * modules/records/storedText.js — text the SERVER can read from a stored
 * file for free, with no GPU: PDFs that carry a real text layer, plain
 * text files (.txt / .md / .csv) and Word / PowerPoint (officeText.js).
 *
 * The pages are saved as the file's extraction (edu.content_parses) and
 * indexed, so Ask, Summary / Quiz / Flashcards, the podcast and the
 * teaching session's document search all work on them. It runs:
 *   • at upload (POST /api/records), and
 *   • once over the files already on the shelf (backfillRecordText — the
 *     "record text backfill" job and `npm run records:backfill-text`).
 *
 * Scanned PDFs and images have no text to read here: they stay on the
 * reader's tap-to-extract offer (RunPod), as do recordings (transcribe).
 *
 * PDF pages get real layout blocks: the text layer's runs are grouped into
 * lines, the lines into paragraphs, each with its box (bbox_2d, 0-1000) —
 * so citations flash the paragraph on the page, just as an OCR'd scan does.
 */
import { officeKindOf, officeToPages, paginate, downloadCapped, OFFICE_MODELS } from "./officeText.js";
import { looksScanned } from "./textLayer.js";

export const STORED_TEXT_LIMITS = Object.freeze({
  MAX_PDF_BYTES: 60 * 1024 * 1024,
  MAX_TEXT_BYTES: 3 * 1024 * 1024,
  MAX_PDF_PAGES: 200,                  // the search index keeps 200 page chunks per record
  MAX_BLOCKS_PER_PAGE: 400,
  TEXT_PIECE_CHARS: 1500,              // a long run of lines (a CSV) is cut into pieces
});

export const STORED_TEXT_MODELS = Object.freeze({ ...OFFICE_MODELS, pdf: "pdf-text", text: "text-file" });

const TEXT_MIME = new Set(["text/plain", "text/markdown", "text/csv"]);

/** "pdf" | "text" | "docx" | "pptx" | null — what the server can read itself. */
export function storedTextKindOf(mime = "", name = "") {
  const m = String(mime || "").toLowerCase(), n = String(name || "");
  if (m === "application/pdf" || /\.pdf$/i.test(n)) return "pdf";
  if (TEXT_MIME.has(m) || /\.(txt|md|csv)$/i.test(n)) return "text";
  return officeKindOf(mime, name);
}

/* ── PDF: the text layer → paragraphs with boxes ──────────────────────── */

/**
 * One page's text runs ([{ str, left, top, right, bottom }] in viewport
 * pixels, top-left origin) → paragraph blocks [{ text, box }].
 * Pure — covered by the contract test.
 */
export function runsToParagraphs(runs) {
  const items = runs.filter((r) => String(r.str || "").trim() && r.bottom > r.top)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  // 1. Lines: runs whose vertical middles sit within half a line height.
  const lines = [];
  for (const r of items) {
    const h = r.bottom - r.top, mid = (r.top + r.bottom) / 2;
    const line = lines.find((l) => Math.abs((l.top + l.bottom) / 2 - mid) < Math.min(h, l.bottom - l.top) * 0.5);
    if (line) {
      line.runs.push(r);
      line.top = Math.min(line.top, r.top); line.bottom = Math.max(line.bottom, r.bottom);
      line.left = Math.min(line.left, r.left); line.right = Math.max(line.right, r.right);
    } else {
      lines.push({ runs: [r], top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    }
  }
  for (const l of lines) {
    l.runs.sort((a, b) => a.left - b.left);
    let text = "";
    let prevRight = null;
    for (const r of l.runs) {
      const gap = prevRight == null ? 0 : r.left - prevRight;
      const needsSpace = text && !/\s$/.test(text) && !/^\s/.test(r.str) && gap > (l.bottom - l.top) * 0.2;   // ~ a space at this size
      text += (needsSpace ? " " : "") + r.str;
      prevRight = r.right;
    }
    l.text = text.replace(/\s+/g, " ").trim();
  }
  lines.sort((a, b) => a.top - b.top || a.left - b.left);
  // 2. Paragraphs: the next line follows closely and starts near the same x.
  const paras = [];
  for (const l of lines) {
    if (!l.text) continue;
    const p = paras[paras.length - 1];
    const h = l.bottom - l.top;
    const close = p && l.top - p.lastBottom < h * 0.9 && l.top >= p.lastTop
      && Math.abs(l.left - p.box.left) < Math.max(h * 3, (p.box.right - p.box.left) * 0.25);
    if (close) {
      p.text = p.text.endsWith("-") ? p.text.slice(0, -1) + l.text : `${p.text} ${l.text}`;
      p.box = { left: Math.min(p.box.left, l.left), top: p.box.top, right: Math.max(p.box.right, l.right), bottom: l.bottom };
      p.lastBottom = l.bottom; p.lastTop = l.top;
    } else {
      paras.push({ text: l.text, box: { left: l.left, top: l.top, right: l.right, bottom: l.bottom }, lastBottom: l.bottom, lastTop: l.top });
    }
  }
  return paras.map(({ text, box }) => ({ text, box }));
}

/** Paragraphs + the page's size → one saved page { markdown, blocks, size }. */
export function pdfPageFromParagraphs(paras, width, height, cap = STORED_TEXT_LIMITS.MAX_BLOCKS_PER_PAGE) {
  const n = (v, total) => Math.max(0, Math.min(1000, Math.round((v / total) * 1000)));
  const blocks = paras.slice(0, cap).map((p) => ({
    bbox_2d: [n(p.box.left, width), n(p.box.top, height), n(p.box.right, width), n(p.box.bottom, height)],
    text_content: p.text,
  }));
  return {
    markdown: blocks.map((b) => b.text_content).join("\n\n"),
    blocks,
    size: { width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100, unit: "pt" },
  };
}

/**
 * PDF bytes → { pages, scanned, totalPages }. Pages without text are left
 * out (a scan page stays for the tap-to-extract offer); a document whose
 * text layer is thinner than the scan rule (textLayer.js — repeated
 * watermark text doesn't count) counts as scanned.
 */
export async function pdfTextPages(buffer, { maxPages = STORED_TEXT_LIMITS.MAX_PDF_PAGES } = {}) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  try {
    const total = doc.numPages;
    const pages = [];
    const texts = [];   // every page's text, empty ones too — the scan rule needs them all
    for (let i = 1; i <= Math.min(total, maxPages); i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const runs = [];
      for (const it of tc.items || []) {
        if (!it?.str || !Array.isArray(it.transform)) continue;
        const [, , c, d, e, f] = it.transform;
        const h = Math.hypot(c, d) || it.height || 0;
        const [x1, y1] = vp.convertToViewportPoint(e, f);
        const [x2, y2] = vp.convertToViewportPoint(e + (it.width || 0), f + h);
        runs.push({ str: it.str, left: Math.min(x1, x2), right: Math.max(x1, x2), top: Math.min(y1, y2), bottom: Math.max(y1, y2) });
      }
      page.cleanup();
      const built = pdfPageFromParagraphs(runsToParagraphs(runs), vp.width, vp.height);
      texts.push(built.markdown);
      if (built.markdown.trim()) pages.push({ pageNumber: i, ...built });
    }
    // A watermark or running header on every page isn't the document (textLayer.js).
    const scanned = looksScanned(texts);
    return { pages: scanned ? [] : pages, scanned, totalPages: total };
  } finally {
    await doc.destroy().catch(() => {});
  }
}

/* ── Plain text files ─────────────────────────────────────────────────── */

/** Text bytes → reading pages (paragraphs; a long run of lines is cut into pieces). */
export function textFilePages(buffer) {
  const text = Buffer.from(buffer).toString("utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const items = [];
  for (const para of text.split(/\n\s*\n+/)) {
    const t = para.replace(/\s+$/g, "");
    if (!t.trim()) continue;
    if (t.length <= STORED_TEXT_LIMITS.TEXT_PIECE_CHARS) {
      items.push({ text: t, heading: /^#{1,6}\s/.test(t) });
      continue;
    }
    let piece = "";
    for (const line of t.split("\n")) {
      if (piece && piece.length + line.length + 1 > STORED_TEXT_LIMITS.TEXT_PIECE_CHARS) { items.push({ text: piece }); piece = ""; }
      piece = piece ? `${piece}\n${line}` : line;
    }
    if (piece.trim()) items.push({ text: piece });
  }
  return paginate(items);
}

/* ── The flow ─────────────────────────────────────────────────────────── */

const MAX_BYTES = { pdf: STORED_TEXT_LIMITS.MAX_PDF_BYTES, text: STORED_TEXT_LIMITS.MAX_TEXT_BYTES };

/**
 * Read a stored file's text into the shared cache, ONCE (the parse lane's
 * single-flight claim). Never throws.
 *   → { status: "done", pages } | "running" | "scanned" | "skipped" | { status: "failed", error }
 * A scan claims nothing (the uploader's browser may be starting its own
 * RunPod run for it at this very moment); with rememberScanned (the
 * backfill) the verdict is recorded so the next pass doesn't re-download it.
 * bill:false — indexing is unmetered (platform work, not the owner's).
 */
export async function extractStoredText({ userId = null, contentKey, name, mime, fileUrl, rememberScanned = false, bill = true }, deps = {}) {
  const kind = storedTextKindOf(mime, name);
  if (!kind || !contentKey || !fileUrl) return { status: "skipped" };
  const lib = deps.extractLib || await import("./extractLib.js");
  const index = deps.indexByContentKey || (await import("./searchLib.js")).indexByContentKey;
  const download = deps.download || downloadCapped;
  const readPdf = deps.pdfTextPages || pdfTextPages;
  const mode = kind === "docx" || kind === "pptx" ? "office" : "text";
  let claimed = false;
  try {
    let pages;
    if (kind === "pdf") {
      // Read first, claim after: a scan must not hold the claim the
      // uploader's RunPod run needs.
      const bytes = await download(fileUrl, { maxBytes: MAX_BYTES.pdf });
      const out = await readPdf(bytes);
      if (out.scanned || !out.pages.length) {
        if (rememberScanned && await lib.claimContentJob(contentKey, "parse", userId)) {
          await lib.finishContentJob(contentKey, "parse", "done", { mode, scanned: true, pages: 0 });
        }
        return { status: "scanned" };
      }
      claimed = await lib.claimContentJob(contentKey, "parse", userId);
      if (!claimed) return { status: "running" };
      pages = out.pages;
    } else {
      claimed = await lib.claimContentJob(contentKey, "parse", userId);
      if (!claimed) return { status: "running" };
      const bytes = await download(fileUrl, kind === "text" ? { maxBytes: MAX_BYTES.text } : {});
      pages = kind === "text" ? textFilePages(bytes) : officeToPages(kind, bytes);
    }
    if (!pages.length) throw new Error("No text was found in this file.");
    await lib.saveExtractionPages({ contentKey, model: STORED_TEXT_MODELS[kind], pages });
    await Promise.resolve(index({ contentKey, pages, bill })).catch(() => {});
    await lib.finishContentJob(contentKey, "parse", "done", { mode, pages: pages.length });
    return { status: "done", pages };
  } catch (err) {
    const error = String(err?.message || err).slice(0, 200);
    if (claimed) await lib.finishContentJob(contentKey, "parse", "failed", { mode, error }).catch(() => {});
    else if (rememberScanned && await lib.claimContentJob(contentKey, "parse", userId).catch(() => false)) {
      await lib.finishContentJob(contentKey, "parse", "failed", { mode, error }).catch(() => {});
    }
    return { status: "failed", error };
  }
}
