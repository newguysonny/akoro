// Structure-aware chunking/cleaning for the record index (H1/H2/H3).
// Pure: markdown in, heading-scoped chunks out. Kept out of searchLib so that
// file stays under the structural size limit; searchLib re-exports these.

import { createHash } from "node:crypto";

export const MAX_CHUNK_CHARS = 1200;

/* ── Structure-aware chunking (H1/H2/H3) ─────────────────────────────────── */

const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const TABLE_ROW = /^\s*\|/;
const FENCE = /^\s*(```|~~~)/;
const FIGURE_ONLY = /^\s*(?:\*?\[figure\]\*?|!\[[^\]]*\]\([^)]*\))\s*$/i;

/** Remove layout tokens and whitespace noise; never alters table cells. */
export function cleanForEmbed(text) {
  return String(text || "")
    .replace(/<\|[^>]*\|>/g, " ")
    .replace(/\uFF5C/g, "|")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Normalised text → content hash (dedupe + embedding reuse). */
export function chunkHash(text) {
  const norm = String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(norm).digest("hex");
}

/**
 * Lines repeated on most pages of ONE document: running headers, footers,
 * watermark stamps. Headings/tables/fences are never treated as boilerplate.
 */
export function boilerplateLines(pages, { share = 0.6, minPages = 3 } = {}) {
  const list = (Array.isArray(pages) ? pages : []).filter((p) => p);
  if (list.length < minPages) return new Set();
  const counts = new Map();
  for (const p of list) {
    const seen = new Set();
    for (const raw of cleanForEmbed(p?.markdown || "").split("\n")) {
      const line = raw.trim();
      if (line.length < 3 || line.length > 120) continue;
      if (HEADING.test(line) || TABLE_ROW.test(line) || FENCE.test(line)) continue;
      // A full sentence repeated on every page is content, not furniture.
      if (/[.!?]$/.test(line) && line.split(/\s+/).length > 4) continue;
      if (seen.has(line)) continue;
      seen.add(line);
      counts.set(line, (counts.get(line) || 0) + 1);
    }
  }
  const threshold = Math.max(minPages, Math.ceil(list.length * share));
  return new Set([...counts].filter(([, n]) => n >= threshold).map(([line]) => line));
}

/** Strip boilerplate lines and bare page numbers from a page's text. */
export function stripBoilerplate(text, boilerplate = new Set()) {
  return cleanForEmbed(text)
    .split("\n")
    .filter((raw) => {
      const line = raw.trim();
      if (!line) return true;
      if (/^\d{1,4}$/.test(line)) return false;                       // page number
      if (/^(?:page|pg\.?)\s*\d+(?:\s*(?:of|\/)\s*\d+)?$/i.test(line)) return false;
      if (/^\d+\s*(?:of|\/)\s*\d+$/i.test(line)) return false;
      if (boilerplate.has(line)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split an oversized prose block at a boundary, with a small overlap. */
function leaves(text, maxChars, overlap) {
  const src = String(text || "").trim();
  if (!src) return [];
  if (src.length <= maxChars) return [src];
  const out = [];
  let at = 0;
  while (at < src.length) {
    let end = Math.min(src.length, at + maxChars);
    if (end < src.length) {
      const para = src.lastIndexOf("\n\n", end);
      const sentence = src.lastIndexOf(". ", end);
      if (para > at + maxChars * 0.4) end = para;
      else if (sentence > at + maxChars * 0.4) end = sentence + 1;
    }
    const piece = src.slice(at, end).trim();
    if (piece) out.push(piece);
    if (end >= src.length) break;
    at = Math.max(end - overlap, at + 1);
  }
  return out;
}

/**
 * Markdown → chunks that follow the document's structure.
 *
 * Headings define sections (their path rides on every chunk); tables, code
 * fences and figure sentinels are ATOMIC — never split across chunks, even
 * when oversized (the item is more useful intact). Figure-only chunks are
 * dropped: a placeholder has nothing to embed. Prose sections split at
 * paragraph/sentence boundaries with a 15% overlap.
 */
export function chunksFromMarkdown(markdown, { pageNumber = null, maxChars = MAX_CHUNK_CHARS, overlap = Math.round(MAX_CHUNK_CHARS * 0.15) } = {}) {
  const clean = cleanForEmbed(markdown);
  if (!clean) return [];
  const nodes = [];
  let path = [];
  let buf = [];
  let mode = null;         // "table" | "fence" while inside an atomic block
  let atomic = [];

  const section = () => path.join(" > ");
  const flushText = () => {
    const text = buf.join("\n").trim();
    buf = [];
    if (text) nodes.push({ text, sectionPath: section() || null, atomic: false });
  };
  const flushAtomic = () => {
    const text = atomic.join("\n").trim();
    atomic = [];
    mode = null;
    if (text) nodes.push({ text, sectionPath: section() || null, atomic: true });
  };

  for (const raw of clean.split("\n")) {
    const line = raw.trimEnd();
    if (mode === "fence") {
      atomic.push(line);
      if (FENCE.test(line)) flushAtomic();
      continue;
    }
    if (mode === "table") {
      if (TABLE_ROW.test(line)) { atomic.push(line); continue; }
      flushAtomic();
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushText();
      const level = heading[1].length;
      path = path.slice(0, Math.max(0, level - 1));
      path[level - 1] = heading[2].trim();
      continue;
    }
    if (FENCE.test(line)) {
      flushText();
      mode = "fence";
      atomic.push(line);
      continue;
    }
    if (TABLE_ROW.test(line)) {
      flushText();
      mode = "table";
      atomic.push(line);
      continue;
    }
    if (!line.trim()) { flushText(); continue; }
    buf.push(line);
  }
  if (mode === "fence" || mode === "table") flushAtomic();
  flushText();

  const out = [];
  let cursor = 0;
  for (const node of nodes) {
    if (!node.atomic && FIGURE_ONLY.test(node.text)) continue;
    const pieces = node.atomic ? [node.text] : leaves(node.text, maxChars, overlap);
    for (const text of pieces) {
      if (!text || FIGURE_ONLY.test(text)) continue;
      const at = clean.indexOf(text.slice(0, 40), cursor);
      const start = at >= 0 ? at : (cursor < clean.length ? cursor : null);
      const end = start != null ? Math.min(clean.length, start + text.length) : null;
      if (start != null) cursor = end;
      out.push({
        pageNumber, text, sectionPath: node.sectionPath,
        charStart: start, charEnd: end,
        oversized: node.atomic && text.length > maxChars,
      });
    }
  }
  return out;
}

/**
 * Extraction pages → index rows. Cleans each page, removes document-wide
 * boilerplate, chunks by structure and drops exact duplicates (H3).
 */
export function chunksForPages(pages) {
  const list = (Array.isArray(pages) ? pages : []).filter((p) => p);
  const boilerplate = boilerplateLines(list);
  const out = [];
  const seen = new Set();
  for (const page of list) {
    const text = stripBoilerplate(page?.markdown || "", boilerplate);
    if (!text) continue;
    for (const c of chunksFromMarkdown(text, { pageNumber: page.pageNumber })) {
      const hash = chunkHash(c.text);
      if (seen.has(hash)) continue;
      seen.add(hash);
      out.push({ ...c, contentHash: hash });
    }
  }
  return out;
}
