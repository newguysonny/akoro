/**
 * syllabus-import/layoutText.js — a digital PDF's text with its layout kept.
 *
 * Syllabi are tables (CONTENTS | NOTES, TOPICS | OBJECTIVES). A plain text
 * extract flattens the columns one after the other, and the model then has to
 * guess which note belongs to which topic. Here every text item keeps its
 * position: items on the same baseline form one line, and each item is placed
 * at its column, so a table row reads across ("(iv) transportation;   Assessment
 * would include…"). Running page headers/footers and bare page numbers are
 * dropped.
 *
 * linesFromItems is PURE (unit-tested); pdfLayoutPages reads the PDF with
 * pdfjs (already a dependency — no poppler on the server).
 */
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const CHAR_PT = 4.6;          // ~ one character column at body size
const SAME_LINE_PT = 2.5;     // baselines closer than this are one line

/**
 * PURE: text items → layout lines (top to bottom).
 * items: [{ str, x, y, w }] in PDF points (y grows upwards).
 */
export function linesFromItems(items = []) {
  const rows = [];
  for (const it of items) {
    const str = String(it.str ?? "");
    if (!str.trim()) continue;
    let row = rows.find((r) => Math.abs(r.y - it.y) <= SAME_LINE_PT);
    if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
    row.items.push({ ...it, str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    r.items.sort((a, b) => a.x - b.x);
    let line = "";
    for (const it of r.items) {
      const col = Math.max(0, Math.round(it.x / CHAR_PT));
      if (line.length < col) line += " ".repeat(col - line.length);
      else if (line && !line.endsWith(" ") && !it.str.startsWith(" ")) line += " ";
      line += it.str;
    }
    return line.replace(/\s+$/, "");
  });
}

const normal = (line) => line.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * PURE: drop running headers/footers (the same line at the top or bottom of
 * most pages) and bare page numbers. pages: string[][] (lines per page).
 */
export function stripRunningLines(pages = []) {
  if (pages.length < 3) return pages.map((p) => p.filter((l) => !/^\s*(page\s*)?\d{1,3}\s*$/i.test(l)));
  const edge = new Map();
  for (const lines of pages) {
    const seen = new Set();
    for (const l of [...lines.slice(0, 3), ...lines.slice(-3)]) {
      const k = normal(l);
      if (k && !seen.has(k)) { seen.add(k); edge.set(k, (edge.get(k) || 0) + 1); }
    }
  }
  const running = new Set([...edge].filter(([, n]) => n >= Math.max(3, pages.length * 0.4)).map(([k]) => k));
  return pages.map((lines) => lines.filter((l, i) => {
    if (/^\s*(page\s*)?\d{1,3}\s*$/i.test(l)) return false;
    const atEdge = i < 3 || i >= lines.length - 3;
    return !(atEdge && running.has(normal(l)));
  }));
}

/** The PDF → [{ page, text }] with layout kept and running lines removed. */
export async function pdfLayoutPages(buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const STANDARD_FONTS = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep;
  const doc = await getDocument({
    data: new Uint8Array(buffer), standardFontDataUrl: STANDARD_FONTS,
    useSystemFonts: false, disableFontFace: true, isEvalSupported: false,
  }).promise;
  const raw = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      raw.push(linesFromItems(tc.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width }))));
      page.cleanup();
    }
  } finally { await doc.destroy(); }
  return stripRunningLines(raw).map((lines, i) => ({ page: i + 1, text: lines.join("\n").replace(/\n{3,}/g, "\n\n") }));
}
