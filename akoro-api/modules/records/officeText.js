/**
 * modules/records/officeText.js — Word and PowerPoint files, readable.
 *
 * DOCX and PPTX are zip packages of XML. The SERVER reads the text out of
 * the stored file (never the browser — a viewer of a shared file must not
 * be able to write the shared cache), shapes it into reading pages and
 * saves them as the file's extraction, exactly where a scanned PDF's pages
 * land. Everything downstream — the reader, Ask, the teaching session's
 * grounding, Summary / Quiz / Flashcards — then works unchanged.
 *
 *   DOCX → paragraphs, headings (#), list items (-) and tables in document
 *          order, cut into ~3,000-character pages, preferring to cut at a
 *          heading or an explicit page break.
 *   PPTX → one page per slide, in presentation order: the title as a
 *          heading, the text boxes, tables, then the speaker notes.
 *
 * Each paragraph is also one layout block. The OCR path's blocks carry a
 * real box (bbox_2d, 0-1000); a text document has no geometry, so its
 * blocks carry [0, i, 1000, i+1] — i is the block's order on the page.
 * That keeps the block ranking and the reading-order sort the citation
 * pipeline already does, and the reader resolves the box to the paragraph
 * it rendered with data-block="i" (no overlay is drawn on text pages).
 *
 * The parsing is pure (buffer in, pages out) and covered by
 * officeText.test.mjs; the download / save / index flow is below it.
 */
import AdmZip from "adm-zip";

export const OFFICE_LIMITS = Object.freeze({
  MAX_FILE_BYTES: 50 * 1024 * 1024,        // the download we're willing to read
  MAX_XML_BYTES: 40 * 1024 * 1024,         // one part, uncompressed (zip-bomb guard)
  MAX_TOTAL_XML_BYTES: 120 * 1024 * 1024,
  MAX_ENTRIES: 5000,
  MAX_PAGES: 150,
  MAX_TOTAL_CHARS: 600_000,
  PAGE_TARGET_CHARS: 3000,                 // cut at the next heading past this
  PAGE_HARD_CHARS: 4500,                   // cut anywhere past this
  MAX_BLOCKS_PER_PAGE: 999,                // block i lives at y = i on the 0-1000 scale
});

export const OFFICE_MODELS = Object.freeze({ docx: "docx-text", pptx: "pptx-text" });

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** "docx" | "pptx" | null — by mime first, then by extension. */
export function officeKindOf(mime = "", name = "") {
  const m = String(mime || "").toLowerCase();
  if (m === DOCX_MIME) return "docx";
  if (m === PPTX_MIME) return "pptx";
  if (/\.docx$/i.test(String(name || ""))) return "docx";
  if (/\.pptx$/i.test(String(name || ""))) return "pptx";
  return null;
}

/* ── XML helpers (the parts are machine-written; regex over them is safe
   enough, and a malformed part just yields less text, never a throw) ── */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function decodeXml(s) {
  return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : null;
};

const tidy = (s) => String(s || "").replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").trim();

/** One paragraph's text: runs (w:t / a:t), tabs and line breaks, in order. */
function runsText(xml, ns) {
  const re = ns === "w"
    ? /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>/g
    : /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br(?:\s[^>]*)?\/>/g;
  let out = "";
  for (const m of xml.matchAll(re)) {
    if (m[1] !== undefined) out += decodeXml(m[1]);
    else if (m[0].includes("tab")) out += "\t";
    else out += "\n";
  }
  return tidy(out);
}

const tableMarkdown = (rows) => {
  const clean = rows.filter((r) => r.some((c) => c));
  if (!clean.length) return "";
  const width = Math.max(...clean.map((r) => r.length));
  const cell = (c) => String(c || "").replace(/\|/g, "\\|").replace(/\n+/g, " ");
  const line = (r) => `| ${Array.from({ length: width }, (_, i) => cell(r[i])).join(" | ")} |`;
  return [line(clean[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...clean.slice(1).map(line)].join("\n");
};

/* ── The zip, read defensively ───────────────────────────────────────── */

function openPackage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error("This file is empty or not an Office document.");
  if (buffer.length > OFFICE_LIMITS.MAX_FILE_BYTES) throw new Error("This file is too large to read (50 MB max).");
  let zip;
  try { zip = new AdmZip(buffer); } catch { throw new Error("This file is damaged or not an Office document."); }
  const entries = zip.getEntries();
  if (entries.length > OFFICE_LIMITS.MAX_ENTRIES) throw new Error("This file has too many parts to read.");
  const byName = new Map(entries.map((e) => [e.entryName, e]));
  let total = 0;
  const read = (name) => {
    const e = byName.get(name);
    if (!e || e.isDirectory) return null;
    const size = Number(e.header?.size) || 0;
    if (size > OFFICE_LIMITS.MAX_XML_BYTES) throw new Error("A part of this file is too large to read.");
    total += size;
    if (total > OFFICE_LIMITS.MAX_TOTAL_XML_BYTES) throw new Error("This file is too large to read.");
    const data = e.getData();
    if (data.length > OFFICE_LIMITS.MAX_XML_BYTES) throw new Error("A part of this file is too large to read.");
    return data.toString("utf8");
  };
  return { read, names: [...byName.keys()] };
}

/* A relationships part → Map(Id → target path resolved against `base`). */
function relsMap(xml, base) {
  const out = new Map();
  for (const m of String(xml || "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id"), target = attr(m[0], "Target"), type = attr(m[0], "Type") || "";
    if (!id || !target || attr(m[0], "TargetMode") === "External") continue;
    const parts = (target.startsWith("/") ? target.slice(1) : `${base}/${target}`).split("/");
    const resolved = [];
    for (const p of parts) {
      if (p === "..") resolved.pop();
      else if (p && p !== ".") resolved.push(p);
    }
    out.set(id, { target: resolved.join("/"), type });
  }
  return out;
}

/* ── Pages from blocks ───────────────────────────────────────────────── */

/**
 * Blocks ([{ text, heading?, pageBreakBefore? }]) → reading pages
 * [{ pageNumber, markdown, blocks }]. A page closes at a heading once it
 * holds PAGE_TARGET_CHARS, anywhere past PAGE_HARD_CHARS, and at an
 * explicit page break once it holds anything substantial.
 */
export function paginate(items, L = OFFICE_LIMITS) {
  const pages = [];
  let cur = [], chars = 0, total = 0;
  const close = () => {
    if (!cur.length) return;
    pages.push(cur);
    cur = []; chars = 0;
  };
  for (const it of items) {
    const text = String(it.text || "").trimEnd();   // keep a nested list item's indent
    if (!text.trim()) continue;
    if (total + text.length > L.MAX_TOTAL_CHARS) break;
    if (cur.length && (
      (it.heading && chars >= L.PAGE_TARGET_CHARS) ||
      (it.pageBreakBefore && chars >= 400) ||
      chars + text.length > L.PAGE_HARD_CHARS ||
      cur.length >= L.MAX_BLOCKS_PER_PAGE
    )) close();
    if (pages.length >= L.MAX_PAGES) break;
    cur.push(text);
    chars += text.length;
    total += text.length;
  }
  if (pages.length < L.MAX_PAGES) close();
  return pages.map((texts, i) => ({ pageNumber: i + 1, ...pageFromTexts(texts) }));
}

/** One page's texts → { markdown, blocks } with the [0, i, 1000, i+1] anchors. */
export function pageFromTexts(texts) {
  const kept = texts.map((t) => String(t || "").trimEnd()).filter((t) => t.trim()).slice(0, OFFICE_LIMITS.MAX_BLOCKS_PER_PAGE);
  return {
    markdown: kept.join("\n\n"),
    blocks: kept.map((text_content, i) => ({ bbox_2d: [0, i, 1000, i + 1], text_content })),
  };
}

/* ── DOCX ────────────────────────────────────────────────────────────── */

function headingLevel(pPr, styleNames) {
  const styleId = /<w:pStyle\s[^>]*w:val="([^"]*)"/.exec(pPr)?.[1] || "";
  const name = (styleNames.get(styleId) || styleId).toLowerCase().replace(/\s+/g, "");
  // Title → 1 (#); Heading N → N + 1 (Heading 1 is ##, under the title).
  if (name === "title") return 1;
  const m = /^heading([1-6])$/.exec(name) || /^(?:heading|überschrift|berschrift|titre|titolo|encabezado|título)([1-6])$/i.exec(styleId);
  if (m) return Math.min(6, Number(m[1]) + 1);
  const outline = /<w:outlineLvl\s[^>]*w:val="(\d)"/.exec(pPr)?.[1];
  if (outline !== undefined && Number(outline) < 5) return Number(outline) + 2;
  return 0;
}

function docxParagraph(pXml, styleNames) {
  const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(pXml)?.[1] || "";
  const text = runsText(pXml.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, ""), "w");
  const pageBreakBefore = /<w:br\s[^>]*w:type="page"/.test(pXml) || /<w:pageBreakBefore(?:\s[^>]*)?\/>/.test(pPr);
  if (!text) return { text: "", pageBreakBefore };
  const level = headingLevel(pPr, styleNames);
  if (level) {
    // Title → #, Heading 1 → ##, Heading 2 → ###: the document's own title
    // outranks its sections, as it does on the printed page.
    return { text: `${"#".repeat(Math.min(6, level))} ${text.replace(/\n+/g, " ")}`, heading: true, pageBreakBefore };
  }
  const numPr = /<w:numPr>([\s\S]*?)<\/w:numPr>/.exec(pPr)?.[1];
  // A list style ("List Bullet", "List Number 2") carries its numbering in
  // the style itself, not on the paragraph.
  const styleId = /<w:pStyle\s[^>]*w:val="([^"]*)"/.exec(pPr)?.[1] || "";
  const listStyle = /^list ?(?:bullet|number)(?: ?(\d))?$/i.exec((styleNames.get(styleId) || styleId).trim());
  if (!numPr && listStyle) {
    const lvl = listStyle[1] ? Number(listStyle[1]) - 1 : 0;
    return { text: `${"  ".repeat(Math.min(lvl, 6))}- ${text}`, pageBreakBefore };
  }
  if (numPr) {
    const lvl = Number(/<w:ilvl\s[^>]*w:val="(\d+)"/.exec(numPr)?.[1] || 0);
    return { text: `${"  ".repeat(Math.min(lvl, 6))}- ${text}`, pageBreakBefore };
  }
  return { text, pageBreakBefore };
}

/** Paragraphs in a table cell, or anywhere a run of XML holds them. */
const paragraphsIn = (xml) => [...String(xml).matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((m) => m[0]);

function docxTable(tblXml) {
  const rows = [];
  for (const tr of tblXml.matchAll(/<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g)) {
    const cells = [];
    for (const tc of tr[1].matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g)) {
      cells.push(paragraphsIn(tc[1]).map((p) => runsText(p, "w")).filter(Boolean).join(" "));
    }
    rows.push(cells);
  }
  return tableMarkdown(rows);
}

/** The style ids a document names its headings with → display names. */
function docxStyleNames(stylesXml) {
  const out = new Map();
  for (const m of String(stylesXml || "").matchAll(/<w:style\b[^>]*w:styleId="([^"]*)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const name = /<w:name\s[^>]*w:val="([^"]*)"/.exec(m[2])?.[1];
    if (name) out.set(m[1], decodeXml(name));
  }
  return out;
}

/** DOCX bytes → [{ pageNumber, markdown, blocks }]. */
export function docxToPages(buffer) {
  const pkg = openPackage(buffer);
  const doc = pkg.read("word/document.xml");
  if (!doc) throw new Error("This Word file has no document body.");
  const styleNames = docxStyleNames(pkg.read("word/styles.xml"));
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(doc)?.[1] || doc;

  // Top-level paragraphs and tables, in document order. A table is taken
  // whole (its cells' paragraphs belong to it, not to the body).
  const items = [];
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p(?:\s[^>]*)?\/>/g;
  for (const m of body.matchAll(re)) {
    if (m[0].startsWith("<w:tbl>")) {
      const md = docxTable(m[0]);
      if (md) items.push({ text: md });
    } else if (!m[0].endsWith("/>")) {
      const p = docxParagraph(m[0], styleNames);
      if (p.text) items.push(p);
      else if (p.pageBreakBefore && items.length) items[items.length - 1].breakAfter = true;
    }
  }
  // A break recorded on an empty paragraph applies to the next real one.
  for (let i = 0; i < items.length - 1; i++) if (items[i].breakAfter) items[i + 1].pageBreakBefore = true;
  return paginate(items);
}

/* ── PPTX ────────────────────────────────────────────────────────────── */

/** One shape tree's text: title (if any) and the body paragraphs. */
function slideShapes(xml) {
  let title = "";
  const lines = [];
  const re = /<p:sp>[\s\S]*?<\/p:sp>|<p:sp\s[^>]*>[\s\S]*?<\/p:sp>|<a:tbl>[\s\S]*?<\/a:tbl>/g;
  for (const m of String(xml).matchAll(re)) {
    const shape = m[0];
    if (shape.startsWith("<a:tbl")) {
      const rows = [...shape.matchAll(/<a:tr(?:\s[^>]*)?>([\s\S]*?)<\/a:tr>/g)].map((tr) =>
        [...tr[1].matchAll(/<a:tc(?:\s[^>]*)?>([\s\S]*?)<\/a:tc>/g)].map((tc) =>
          [...tc[1].matchAll(/<a:p>[\s\S]*?<\/a:p>|<a:p\s[^>]*>[\s\S]*?<\/a:p>/g)].map((p) => runsText(p[0], "a")).filter(Boolean).join(" ")));
      const md = tableMarkdown(rows);
      if (md) lines.push({ text: md });
      continue;
    }
    const ph = /<p:ph\b[^>]*>/.exec(shape)?.[0] || "";
    const phType = ph ? (attr(ph, "type") || "body") : null;
    if (phType && /^(sldNum|dt|ftr|sldImg|hdr)$/.test(phType)) continue;   // slide furniture
    const paras = [...shape.matchAll(/<a:p>[\s\S]*?<\/a:p>|<a:p\s[^>]*>[\s\S]*?<\/a:p>/g)].map((p) => {
      const pPr = /<a:pPr\b[^>]*>/.exec(p[0])?.[0] || "";
      return { text: runsText(p[0], "a"), lvl: Number(attr(pPr, "lvl") || 0), bullet: !/<a:buNone\/>/.test(p[0]) };
    }).filter((p) => p.text);
    if (!paras.length) continue;
    if ((phType === "title" || phType === "ctrTitle") && !title) {
      title = paras.map((p) => p.text).join(" ").replace(/\s+/g, " ");
      continue;
    }
    // Body placeholders are bulleted by the layout; free text boxes aren't.
    const listy = phType === "body" || phType === "obj" || (phType === null && paras.length > 1 && paras.some((p) => p.lvl > 0));
    for (const p of paras) {
      lines.push({ text: listy && p.bullet ? `${"  ".repeat(Math.min(p.lvl, 6))}- ${p.text}` : p.text });
    }
  }
  return { title, lines };
}

/** Slide parts in presentation order (sldIdLst), else by number. */
function slideOrder(pkg) {
  const pres = pkg.read("ppt/presentation.xml") || "";
  const rels = relsMap(pkg.read("ppt/_rels/presentation.xml.rels"), "ppt");
  const ordered = [];
  for (const m of pres.matchAll(/<p:sldId\b[^>]*>/g)) {
    const rid = attr(m[0], "r:id");
    const rel = rid && rels.get(rid);
    if (rel?.target && !ordered.includes(rel.target)) ordered.push(rel.target);
  }
  if (ordered.length) return ordered;
  return pkg.names
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));
}

/** PPTX bytes → one page per slide [{ pageNumber, markdown, blocks }]. */
export function pptxToPages(buffer) {
  const pkg = openPackage(buffer);
  const slides = slideOrder(pkg);
  if (!slides.length) throw new Error("This PowerPoint file has no slides.");
  const pages = [];
  let total = 0;
  for (const part of slides.slice(0, OFFICE_LIMITS.MAX_PAGES)) {
    const xml = pkg.read(part);
    if (xml == null) continue;
    const { title, lines } = slideShapes(xml);
    const texts = [];
    if (title) texts.push(`## ${title}`);
    for (const l of lines) texts.push(l.text);

    // Speaker notes: the notes slide's body placeholder.
    const dir = part.replace(/\/[^/]+$/, ""), file = part.slice(dir.length + 1);
    const rels = relsMap(pkg.read(`${dir}/_rels/${file}.rels`), dir);
    const notesRel = [...rels.values()].find((r) => /\/notesSlide$/.test(r.type));
    if (notesRel) {
      const notes = slideShapes(pkg.read(notesRel.target) || "").lines
        .map((l) => l.text.replace(/^\s*- /, "")).join("\n").trim();
      if (notes) texts.push(`> **Speaker notes:** ${notes.replace(/\n+/g, " ")}`);
    }

    const size = texts.reduce((n, t) => n + t.length, 0);
    if (total + size > OFFICE_LIMITS.MAX_TOTAL_CHARS) break;
    total += size;
    pages.push({ pageNumber: pages.length + 1, ...pageFromTexts(texts) });
  }
  return pages;
}

/** Office bytes → pages, by kind. */
export function officeToPages(kind, buffer) {
  if (kind === "docx") return docxToPages(buffer);
  if (kind === "pptx") return pptxToPages(buffer);
  throw new Error("Only Word (.docx) and PowerPoint (.pptx) files can be read.");
}

/* ── The flow: download → pages → saved extraction → search index ────── */

/** Read a URL into a Buffer, refusing anything over the cap. */
export async function downloadCapped(url, { maxBytes = OFFICE_LIMITS.MAX_FILE_BYTES, fetchImpl = fetch, timeoutMs = 60_000 } = {}) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Could not download the file (HTTP ${res.status}).`);
  const declared = Number(res.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("This file is too large to read (50 MB max).");
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("This file is too large to read (50 MB max).");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Extract an Office file's text ONCE per file (the parse lane's single-
 * flight claim — the same cache a scanned PDF fills), index it, finish.
 * → { status: "done", pages } | { status: "running" } | { status: "failed", error }.
 * Never throws; deps are injectable for the test.
 */
export async function extractOfficeContent({ userId = null, contentKey, name, mime, fileUrl }, deps = {}) {
  const kind = officeKindOf(mime, name);
  if (!kind || !contentKey || !fileUrl) return { status: "failed", error: "Not a Word or PowerPoint file." };
  const lib = deps.extractLib || await import("./extractLib.js");
  const index = deps.indexByContentKey || (await import("./searchLib.js")).indexByContentKey;
  const download = deps.download || downloadCapped;
  try {
    const claimed = await lib.claimContentJob(contentKey, "parse", userId);
    if (!claimed) return { status: "running" };
    try {
      const pages = officeToPages(kind, await download(fileUrl));
      if (!pages.length) throw new Error("No text was found in this file.");
      await lib.saveExtractionPages({ contentKey, model: OFFICE_MODELS[kind], pages });
      await index({ contentKey, pages }).catch?.(() => {});
      await lib.finishContentJob(contentKey, "parse", "done", { mode: "office", pages: pages.length });
      return { status: "done", pages };
    } catch (err) {
      const error = String(err?.message || err).slice(0, 200);
      await lib.finishContentJob(contentKey, "parse", "failed", { mode: "office", error }).catch(() => {});
      return { status: "failed", error };
    }
  } catch (e) {
    console.warn("[office] extraction skipped:", String(e?.message || e).slice(0, 160));
    return { status: "failed", error: "Could not read this file right now." };
  }
}
