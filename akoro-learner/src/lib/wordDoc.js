/*
 * wordDoc.js — the document editor's page setup and its Word (.docx) writer.
 *
 * The editor (features/docs/components/WordEditor.jsx) keeps the document as TipTap
 * JSON; wordToDocx() turns that JSON into a real Word document with the
 * `docx` library — headings and the Title style, fonts, sizes, colours,
 * highlight, alignment, indents, line spacing, bullets and numbering,
 * tables, pictures, links, page breaks and the page's size, orientation and
 * margins — so the learner hands in a file that opens in Microsoft Word.
 *
 * No DOM needed (a node test builds one and reads it back with mammoth).
 */
import {
  Document, Packer, Paragraph, TextRun, ExternalHyperlink, ImageRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, LevelFormat, PageBreak, PageOrientation, WidthType, ShadingType, BorderStyle,
} from 'docx';

/* ── Page setup ─────────────────────────────────────────────────────────── */

export const PAGE_SIZES = Object.freeze({
  A4: { label: 'A4', w: 8.27, h: 11.69 },          // inches
  Letter: { label: 'Letter', w: 8.5, h: 11 },
});
export const MARGINS = Object.freeze({
  normal: { label: 'Normal', note: '2.54 cm all round', top: 1, bottom: 1, left: 1, right: 1 },
  narrow: { label: 'Narrow', note: '1.27 cm all round', top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
  moderate: { label: 'Moderate', note: '2.54 cm top and bottom, 1.91 cm sides', top: 1, bottom: 1, left: 0.75, right: 0.75 },
  wide: { label: 'Wide', note: '2.54 cm top and bottom, 5.08 cm sides', top: 1, bottom: 1, left: 2, right: 2 },
});
export const DEFAULT_PAGE = Object.freeze({ size: 'A4', orientation: 'portrait', margins: 'normal' });

export const FONTS = Object.freeze([
  { name: 'Calibri', css: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif" },
  { name: 'Times New Roman', css: "'Times New Roman', Tinos, Times, serif" },
  { name: 'Arial', css: 'Arial, Arimo, Helvetica, sans-serif' },
  { name: 'Georgia', css: 'Georgia, serif' },
  { name: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
  { name: 'Cambria', css: 'Cambria, Caladea, Georgia, serif' },
  { name: 'Courier New', css: "'Courier New', Cousine, monospace" },
  { name: 'Comic Sans MS', css: "'Comic Sans MS', 'Comic Neue', cursive" },
]);
export const DEFAULT_FONT = 'Calibri';
export const DEFAULT_SIZE = 11;   // pt
export const FONT_SIZES = Object.freeze([8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72]);
export const LINE_SPACINGS = Object.freeze([1, 1.15, 1.5, 2, 2.5, 3]);
/** The editor's heading levels → Word's styles. */
export const STYLES = Object.freeze([
  { key: 'normal', label: 'Normal' },
  { key: 'title', label: 'Title', level: 1 },
  { key: 'h1', label: 'Heading 1', level: 2 },
  { key: 'h2', label: 'Heading 2', level: 3 },
  { key: 'h3', label: 'Heading 3', level: 4 },
  { key: 'quote', label: 'Quote' },
]);

const PX_PER_IN = 96;
const TWIPS_PER_IN = 1440;

/** A page setup → its sizes in px (CSS, 96 per inch). */
export function pageBox(page = DEFAULT_PAGE) {
  const size = PAGE_SIZES[page?.size] || PAGE_SIZES.A4;
  const m = MARGINS[page?.margins] || MARGINS.normal;
  const land = page?.orientation === 'landscape';
  const w = (land ? size.h : size.w) * PX_PER_IN;
  const h = (land ? size.w : size.h) * PX_PER_IN;
  return {
    width: Math.round(w), height: Math.round(h),
    top: m.top * PX_PER_IN, bottom: m.bottom * PX_PER_IN, left: m.left * PX_PER_IN, right: m.right * PX_PER_IN,
    contentWidth: Math.round(w - (m.left + m.right) * PX_PER_IN),
    contentHeight: Math.round(h - (m.top + m.bottom) * PX_PER_IN),
  };
}

/** Pages a document of `contentPx` height fills (at least 1). */
export const pageCount = (contentPx, page = DEFAULT_PAGE) => Math.max(1, Math.ceil(Math.max(0, contentPx - 2) / pageBox(page).contentHeight));

/** Words and characters in the editor's plain text. */
export function textStats(text) {
  const s = String(text || '');
  const words = s.trim() ? s.trim().split(/\s+/).length : 0;
  return { words, characters: s.replace(/\n/g, '').length };
}

/* ── JSON → docx ────────────────────────────────────────────────────────── */

const hex = (c) => {
  const s = String(c || '').trim();
  let m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) return m[1].toUpperCase();
  m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m) return `${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase();
  m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(s);
  if (m) return [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  return null;
};
const firstFont = (css) => String(css || '').split(',')[0].replace(/['"]/g, '').trim() || undefined;
const ptOf = (v) => { const n = parseFloat(String(v || '')); return Number.isFinite(n) && n > 0 ? n : null; };
const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
const HEADING = { 1: HeadingLevel.TITLE, 2: HeadingLevel.HEADING_1, 3: HeadingLevel.HEADING_2, 4: HeadingLevel.HEADING_3 };

/** "data:image/png;base64,…" → { type, data } for ImageRun, or null. */
function imageData(src) {
  const m = /^data:image\/(png|jpe?g|gif);base64,(.+)$/i.exec(String(src || ''));
  if (!m) return null;
  const bin = typeof atob === 'function' ? atob(m[2]) : Buffer.from(m[2], 'base64').toString('binary');
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  return { type: m[1].toLowerCase().startsWith('jp') ? 'jpg' : m[1].toLowerCase(), data };
}

/** One text node (with its marks) → a run, or a hyperlink holding one. */
function textRun(node, extra = {}) {
  const o = { text: node.text || '', ...extra };
  let link = null;
  for (const mk of node.marks || []) {
    const a = mk.attrs || {};
    if (mk.type === 'bold') o.bold = true;
    else if (mk.type === 'italic') o.italics = true;
    else if (mk.type === 'underline') o.underline = {};
    else if (mk.type === 'strike') o.strike = true;
    else if (mk.type === 'superscript') o.superScript = true;
    else if (mk.type === 'subscript') o.subScript = true;
    else if (mk.type === 'highlight') { const f = hex(a.color || '#FFFF00'); if (f) o.shading = { type: ShadingType.CLEAR, fill: f, color: 'auto' }; }
    else if (mk.type === 'textStyle') {
      if (a.color && hex(a.color)) o.color = hex(a.color);
      if (a.fontFamily) o.font = firstFont(a.fontFamily);
      if (ptOf(a.fontSize)) o.size = Math.round(ptOf(a.fontSize) * 2);   // half-points
    } else if (mk.type === 'link' && a.href) link = a.href;
  }
  if (link) { o.style = 'Hyperlink'; return new ExternalHyperlink({ link, children: [new TextRun(o)] }); }
  return new TextRun(o);
}

/** A paragraph's inline content → runs. */
function inlines(nodes, box) {
  const out = [];
  for (const n of nodes || []) {
    if (n.type === 'text') out.push(textRun(n));
    else if (n.type === 'hardBreak') out.push(new TextRun({ break: 1 }));
    else if (n.type === 'image') { const r = imageRun(n, box); if (r) out.push(r); }
  }
  return out;
}

function imageRun(n, box) {
  const img = imageData(n.attrs?.src);
  if (!img) return null;
  const nw = Number(n.attrs?.naturalWidth) || 600, nh = Number(n.attrs?.naturalHeight) || 400;
  const pct = Math.min(100, Math.max(10, Number(n.attrs?.widthPct) || 100));
  const width = Math.round(Math.min(nw, box.contentWidth * (pct / 100)));
  return new ImageRun({ type: img.type, data: img.data, transformation: { width, height: Math.round((width * nh) / nw) } });
}

function paraOptions(attrs = {}) {
  const o = {};
  if (ALIGN[attrs.textAlign] && attrs.textAlign !== 'left') o.alignment = ALIGN[attrs.textAlign];
  const indent = Number(attrs.indent) || 0;
  if (indent > 0) o.indent = { left: indent * 720 };   // 0.5 inch steps, like Word
  const lh = Number(attrs.lineHeight);
  if (lh > 0) o.spacing = { line: Math.round(lh * 240) };
  return o;
}

/** Block nodes → docx paragraphs/tables. `list` = { ref, level } inside lists. */
function blocks(nodes, ctx, list = null) {
  const out = [];
  for (const n of nodes || []) {
    const a = n.attrs || {};
    switch (n.type) {
      case 'paragraph':
        out.push(new Paragraph({ ...paraOptions(a), children: inlines(n.content, ctx.box), ...(list ? { numbering: { reference: list.ref, level: list.level } } : {}) }));
        break;
      case 'heading':
        out.push(new Paragraph({ ...paraOptions(a), heading: HEADING[a.level] || HeadingLevel.HEADING_1, children: inlines(n.content, ctx.box) }));
        break;
      case 'blockquote':
        for (const p of n.content || []) out.push(new Paragraph({ ...paraOptions(p.attrs), style: 'Quote', children: inlines(p.content, ctx.box) }));
        break;
      case 'bulletList':
      case 'orderedList': {
        const ref = n.type === 'bulletList' ? 'bullets' : `numbers-${ctx.lists++}`;
        if (n.type === 'orderedList') ctx.numbered.push(ref);
        const level = list ? Math.min(8, list.level + 1) : 0;
        for (const item of n.content || []) {
          // An item's first paragraph carries the bullet; later blocks and sub-lists follow it.
          (item.content || []).forEach((child, ci) => {
            if (child.type === 'paragraph' && ci === 0) out.push(...blocks([child], ctx, { ref, level }));
            else if (child.type === 'bulletList' || child.type === 'orderedList') out.push(...blocks([child], ctx, { ref, level }));
            else out.push(...blocks([child], ctx));
          });
        }
        break;
      }
      case 'table':
        out.push(table(n, ctx));
        out.push(new Paragraph({}));   // Word needs a paragraph after a table
        break;
      case 'image': {
        const r = imageRun(n, ctx.box);
        if (r) out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [r] }));
        break;
      }
      case 'horizontalRule':
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } } }));
        break;
      case 'pageBreak':
        out.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      default:
        if (n.content) out.push(...blocks(n.content, ctx, list));
    }
  }
  return out;
}

function table(n, ctx) {
  const rows = (n.content || []).map((row) => new TableRow({
    tableHeader: (row.content || []).every((c) => c.type === 'tableHeader'),
    children: (row.content || []).map((cell) => {
      const kids = blocks(cell.content, ctx);
      return new TableCell({
        children: kids.length ? kids : [new Paragraph({})],
        ...(Number(cell.attrs?.colspan) > 1 ? { columnSpan: Number(cell.attrs.colspan) } : {}),
        ...(Number(cell.attrs?.rowspan) > 1 ? { rowSpan: Number(cell.attrs.rowspan) } : {}),
        ...(cell.type === 'tableHeader' ? { shading: { type: ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' } } : {}),
      });
    }),
  }));
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

const LIST_INDENT = (level) => ({ left: 720 * (level + 1), hanging: 360 });

/** TipTap JSON + page setup → a docx Document. */
export function wordToDocx(json, page = DEFAULT_PAGE, { title = '', creator = 'Akoro' } = {}) {
  const box = pageBox(page);
  const ctx = { box, lists: 0, numbered: [] };
  const children = blocks(json?.content || [], ctx);
  const size = PAGE_SIZES[page?.size] || PAGE_SIZES.A4;
  const m = MARGINS[page?.margins] || MARGINS.normal;
  const bullets = ['•', '◦', '▪'];
  const numFormats = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
  return new Document({
    creator, title,
    styles: {
      default: { document: { run: { font: DEFAULT_FONT, size: DEFAULT_SIZE * 2 } } },
      paragraphStyles: [{ id: 'Quote', name: 'Quote', basedOn: 'Normal', next: 'Normal', run: { italics: true, color: '555555' }, paragraph: { indent: { left: 720, right: 720 } } }],
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: Array.from({ length: 9 }, (_, l) => ({ level: l, format: LevelFormat.BULLET, text: bullets[l % 3], alignment: AlignmentType.LEFT, style: { paragraph: { indent: LIST_INDENT(l) } } })) },
        // Each numbered list starts again at 1.
        ...ctx.numbered.map((ref) => ({ reference: ref, levels: Array.from({ length: 9 }, (_, l) => ({ level: l, format: numFormats[l % 3], text: `%${l + 1}.`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: LIST_INDENT(l) } } })) })),
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: Math.round(size.w * TWIPS_PER_IN), height: Math.round(size.h * TWIPS_PER_IN), orientation: page?.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
          margin: { top: m.top * TWIPS_PER_IN, bottom: m.bottom * TWIPS_PER_IN, left: m.left * TWIPS_PER_IN, right: m.right * TWIPS_PER_IN },
        },
      },
      children: children.length ? children : [new Paragraph({})],
    }],
  });
}

/** The document as a .docx Blob (browser). */
export const docxBlob = (json, page, meta) => Packer.toBlob(wordToDocx(json, page, meta));
/** …or bytes (node — the tests). */
export const docxBuffer = (json, page, meta) => Packer.toBuffer(wordToDocx(json, page, meta));
