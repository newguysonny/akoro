/**
 * modules/self-study/submissionMarkup.js — the grader's marks on a
 * submission PDF, and the marked copy the learner gets back.
 *
 * Marks: tick ✓ and cross ✗ (a point), comment (a numbered pin + text),
 * highlight (a box). Positions are fractions of the page from its top-left
 * corner, so they're independent of zoom and of the page's size.
 *
 * The marked copy = the submission PDF with the marks drawn in, opened by
 * a grade page (score, rubric, written feedback) and closed by a list of
 * the comments, numbered like their pins.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export const MARK_TYPES = Object.freeze(["tick", "cross", "comment", "highlight"]);
export const MARKUP_LIMITS = Object.freeze({ MAX_MARKS: 400, MAX_COMMENT_CHARS: 1000, MAX_PAGE: 1000 });

const frac = (v) => Math.round(Math.min(1, Math.max(0, Number(v))) * 10000) / 10000;

/** Untrusted marks → clean marks, or { error }. */
export function validateMarks(input) {
  if (!Array.isArray(input)) return { error: "marks must be a list." };
  if (input.length > MARKUP_LIMITS.MAX_MARKS) return { error: `At most ${MARKUP_LIMITS.MAX_MARKS} marks per submission.` };
  const marks = [];
  for (const m of input) {
    if (!m || typeof m !== "object" || !MARK_TYPES.includes(m.type)) return { error: "Each mark needs a type: tick, cross, comment or highlight." };
    const page = Number(m.page);
    if (!Number.isInteger(page) || page < 1 || page > MARKUP_LIMITS.MAX_PAGE) return { error: "Each mark needs a page number." };
    if (![m.x, m.y].every((v) => Number.isFinite(Number(v)))) return { error: "Each mark needs a position." };
    const mark = { id: String(m.id || "").slice(0, 40) || `m${marks.length + 1}`, page, type: m.type, x: frac(m.x), y: frac(m.y) };
    if (m.type === "highlight") {
      mark.w = frac(m.w); mark.h = frac(m.h);
      if (mark.w < 0.002 || mark.h < 0.002) continue;   // a click, not a box
    }
    if (m.type === "comment") {
      mark.text = String(m.text ?? "").trim().slice(0, MARKUP_LIMITS.MAX_COMMENT_CHARS);
      if (!mark.text) continue;                          // an empty pin says nothing
    }
    marks.push(mark);
  }
  return { marks };
}

/** Comments in reading order (page, then top to bottom) → their pin numbers. */
export function numberComments(marks) {
  return (marks || []).filter((m) => m.type === "comment")
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
    .map((m, i) => ({ ...m, n: i + 1 }));
}

const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve("dejavu-fonts-ttf/package.json")), "ttf");
let FONTS = null;
const fonts = () => (FONTS ||= {
  regular: readFileSync(path.join(FONT_DIR, "DejaVuSans.ttf")),
  bold: readFileSync(path.join(FONT_DIR, "DejaVuSans-Bold.ttf")),
});

const GREEN = rgb(0.06, 0.6, 0.35), RED = rgb(0.86, 0.15, 0.15), PIN = rgb(0.42, 0.23, 1), HL = rgb(1, 0.85, 0.1);
const INK = rgb(0.11, 0.1, 0.09), MUTED = rgb(0.45, 0.43, 0.41);

function wrap(text, font, size, width) {
  const out = [];
  for (const para of String(text ?? "").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

/**
 * Draw the marks into the submission PDF and add the grade page + comments.
 * → Uint8Array. grade: { score, rubric:[{name,max,level}], feedback, gradedAt }.
 */
export async function buildMarkedPdf({ submissionPdf, marks = [], grade = {}, title = "Activity", learner = "Learner" }) {
  const doc = await PDFDocument.load(submissionPdf, { ignoreEncryption: true });
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fonts().regular, { subset: true });
  const bold = await doc.embedFont(fonts().bold, { subset: true });
  const pages = doc.getPages();
  const numbered = numberComments(marks);

  for (const m of [...marks.filter((x) => x.type !== "comment"), ...numbered]) {
    const page = pages[m.page - 1];
    if (!page) continue;
    const { width: W, height: H } = page.getSize();
    const x = m.x * W, y = H - m.y * H;   // marks are top-left fractions; PDF space is bottom-left
    if (m.type === "highlight") {
      page.drawRectangle({ x, y: y - m.h * H, width: m.w * W, height: m.h * H, color: HL, opacity: 0.32, borderColor: HL, borderOpacity: 0.7, borderWidth: 0.8 });
    } else if (m.type === "tick") {
      const s = Math.max(10, W * 0.028);
      page.drawSvgPath(`M 0 ${s * 0.55} L ${s * 0.38} ${s} L ${s} 0`, { x: x - s / 2, y: y + s / 2, borderColor: GREEN, borderWidth: 2.4 });
    } else if (m.type === "cross") {
      const s = Math.max(9, W * 0.024);
      page.drawLine({ start: { x: x - s / 2, y: y - s / 2 }, end: { x: x + s / 2, y: y + s / 2 }, color: RED, thickness: 2.4 });
      page.drawLine({ start: { x: x - s / 2, y: y + s / 2 }, end: { x: x + s / 2, y: y - s / 2 }, color: RED, thickness: 2.4 });
    } else if (m.type === "comment") {
      const r = Math.max(7, W * 0.016);
      page.drawCircle({ x, y, size: r, color: PIN });
      const label = String(m.n);
      const fs = r * 1.1;
      page.drawText(label, { x: x - bold.widthOfTextAtSize(label, fs) / 2, y: y - fs * 0.36, size: fs, font: bold, color: rgb(1, 1, 1) });
    }
  }

  // The grade page goes first; the comments list (if any) last.
  const A4 = [595.28, 841.89], M = 50, TW = A4[0] - M * 2;
  const gp = doc.insertPage(0, A4);
  let y = A4[1] - M;
  const line = (text, { size = 11, font = regular, color = INK, gap = 4, indent = 0 } = {}) => {
    for (const l of wrap(text, font, size, TW - indent)) {
      y -= size * 1.4;
      if (y < M) break;
      gp.drawText(l, { x: M + indent, y, size, font, color });
    }
    y -= gap;
  };
  line("MARKED SUBMISSION", { size: 8.5, font: bold, color: PIN, gap: 2 });
  line(title, { size: 19, font: bold, gap: 4 });
  line(`${learner}${grade.gradedAt ? ` · graded ${new Date(grade.gradedAt).toUTCString().slice(5, 16)}` : ""}`, { size: 10, color: MUTED, gap: 14 });
  if (Number.isFinite(Number(grade.score))) line(`Score: ${Math.round(Number(grade.score))}%`, { size: 26, font: bold, color: PIN, gap: 10 });
  const rubric = Array.isArray(grade.rubric) ? grade.rubric.filter((r) => r && r.name) : [];
  if (rubric.length) {
    line("Rubric", { size: 12, font: bold, gap: 2 });
    for (const r of rubric) line(`${r.name}: ${r.level ?? "–"} / ${r.max}`, { size: 10.5, indent: 10, gap: 0 });
    y -= 10;
  }
  if (String(grade.feedback || "").trim()) {
    line("Feedback", { size: 12, font: bold, gap: 2 });
    line(String(grade.feedback), { size: 11, gap: 10 });
  }
  const ticks = marks.filter((m) => m.type === "tick").length, crosses = marks.filter((m) => m.type === "cross").length;
  if (marks.length) line(`On your work: ${ticks} ✓ · ${crosses} ✗ · ${numbered.length} comment${numbered.length === 1 ? "" : "s"} · ${marks.filter((m) => m.type === "highlight").length} highlighted`, { size: 10, color: MUTED });

  if (numbered.length) {
    let cp = doc.addPage(A4);
    y = A4[1] - M;
    const cline = (text, opts = {}) => {
      const { size = 10.5, font = regular, color = INK, indent = 0, gap = 2 } = opts;
      for (const l of wrap(text, font, size, TW - indent)) {
        y -= size * 1.4;
        if (y < M + 20) { cp = doc.addPage(A4); y = A4[1] - M - size * 1.4; }
        cp.drawText(l, { x: M + indent, y, size, font, color });
      }
      y -= gap;
    };
    cline("Teacher's comments", { size: 14, font: bold, color: PIN, gap: 8 });
    for (const c of numbered) {
      cline(`${c.n}.  (page ${c.page + 1})`, { size: 10, font: bold, gap: 0 });   // +1: the grade page now comes first
      cline(c.text, { indent: 18, gap: 8 });
    }
  }
  return doc.save();
}
