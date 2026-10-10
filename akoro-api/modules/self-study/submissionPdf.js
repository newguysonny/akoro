/**
 * modules/self-study/submissionPdf.js — one learner's submission as ONE PDF.
 *
 * What an instructor opens to grade, and what the learner can keep:
 *   1. a cover block — the activity, the learner, when it was handed in,
 *   2. the written answer,
 *   3. every question in order with the learner's answer (MCQ: all options
 *      listed, the pick marked; unanswered questions say so),
 *   4. the attachments, each introduced by a header: PDFs merged page for
 *      page, JPEG / PNG photos placed on their own page (a phone photo of
 *      handwritten work stays legible), Word files as their text, text
 *      files as text. Anything that can't be carried says so, so the
 *      grader knows to open the original.
 * Every page is footed "learner · activity · page n of N".
 *
 * The PDF never marks right or wrong — the learner can download it, and a
 * copy that carried the answer key could be passed to classmates.
 *
 * Text uses DejaVu Sans (the dejavu-fonts-ttf package) through fontkit, so
 * Yoruba, Igbo and Hausa letters and tone marks print. Right-to-left
 * scripts (Arabic, Hebrew) are replaced and a note points to the original:
 * pdf-lib can't join or reorder them, and reversed, disconnected letters
 * would misquote the learner.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { docxToPages } from "../records/officeText.js";
import { paperBlocks, passageRange, figurePng } from "./paperLayout.js";
import { readChoice } from "./submissionView.js";

const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve("dejavu-fonts-ttf/package.json")), "ttf");
let FONTS = null;
const fonts = () => (FONTS ||= {
  regular: readFileSync(path.join(FONT_DIR, "DejaVuSans.ttf")),
  bold: readFileSync(path.join(FONT_DIR, "DejaVuSans-Bold.ttf")),
});
/** Right-to-left scripts need shaping pdf-lib doesn't do. */
const isRtl = (cp) => (cp >= 0x590 && cp <= 0x8ff) || (cp >= 0xfb1d && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff);

export const SUBMISSION_PDF_LIMITS = Object.freeze({
  MAX_ATTACHMENT_PAGES: 150,   // merged pages across all attached PDFs
  MAX_TEXT_CHARS: 200_000,     // per attachment's text
});

const A4 = [595.28, 841.89];
const M = 50;                  // margin
const INK = rgb(0.11, 0.1, 0.09), MUTED = rgb(0.45, 0.43, 0.41), ACCENT = rgb(0.42, 0.23, 1), RULE = rgb(0.9, 0.89, 0.88);

const letterOf = (i) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Number(i)] ?? "?";
const qText = (q) => (typeof q === "object" && q !== null ? String(q.q ?? "") : String(q ?? ""));
const fmtDate = (iso) => {
  const d = new Date(iso || "");
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
};
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);

/** A writer that flows wrapped text down A4 pages, adding pages as needed. */
class Flow {
  constructor(doc, regular, bold, glyphs) {
    Object.assign(this, { doc, regular, bold, glyphs, page: null, y: 0, replaced: 0 });
  }
  newPage() { this.page = this.doc.addPage(A4); this.y = A4[1] - M; return this.page; }
  ensure(h) { if (!this.page || this.y - h < M + 24) this.newPage(); }
  /** Characters the font can't draw become "?" (counted for the note). */
  clean(text) {
    let out = "";
    for (const ch of String(text ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, "    ")) {
      const cp = ch.codePointAt(0);
      if (ch === "\n" || this.glyphs(cp)) out += ch;
      else if (cp >= 0x300 && cp <= 0x36f) continue;    // an unsupported combining mark — drop it
      else { out += "?"; this.replaced += 1; }
    }
    return out;
  }
  lines(text, size, font, width) {
    const out = [];
    for (const para of this.clean(text).split("\n")) {
      if (!para.trim()) { out.push(""); continue; }
      let line = "";
      for (const word of para.split(/(\s+)/)) {
        const next = line + word;
        if (font.widthOfTextAtSize(next, size) <= width || !line.trim()) {
          // A single word wider than the line is broken by characters.
          if (!line.trim() && font.widthOfTextAtSize(next, size) > width) {
            let chunk = "";
            for (const ch of next) {
              if (font.widthOfTextAtSize(chunk + ch, size) > width && chunk) { out.push(chunk); chunk = ""; }
              chunk += ch;
            }
            line = chunk;
          } else line = next;
        } else { out.push(line.trimEnd()); line = word.trimStart(); }
      }
      out.push(line.trimEnd());
    }
    return out;
  }
  text(text, { size = 10.5, bold = false, color = INK, indent = 0, gap = 4, lineGap = 1.38 } = {}) {
    const font = bold ? this.bold : this.regular;
    const width = A4[0] - M * 2 - indent;
    for (const l of this.lines(text, size, font, width)) {
      this.ensure(size * lineGap);
      this.y -= size * lineGap;
      if (l) this.page.drawText(l, { x: M + indent, y: this.y, size, font, color });
    }
    this.y -= gap;
  }
  rule(gap = 10) {
    this.ensure(gap * 2);
    this.y -= gap;
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: A4[0] - M, y: this.y }, thickness: 0.6, color: RULE });
    this.y -= gap;
  }
  heading(text) { this.ensure(40); this.y -= 8; this.text(text, { size: 13, bold: true, color: ACCENT, gap: 6 }); }
  /** An embedded image, scaled to fit the column (never upscaled past 1×). */
  image(img, { indent = 0, maxH = 220, gap = 8 } = {}) {
    const maxW = A4[0] - M * 2 - indent;
    const s = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * s, h = img.height * s;
    this.ensure(h + gap);
    this.y -= h;
    this.page.drawImage(img, { x: M + indent, y: this.y, width: w, height: h });
    this.y -= gap;
  }
}

/**
 * The same submission as markdown text — what machines read (AI grading,
 * search), beside the PDF people read. Attachments contribute their text
 * where they have one (`files[].text`).
 */
export function submissionMarkdown({ assignment = {}, learner = {}, submission = {}, files = [] }) {
  const out = [`# ${assignment.title || "Activity"}`, "",
    `- Learner: ${learner.name || learner.username || "Learner"}${learner.username ? ` (@${learner.username})` : ""}`,
    ...(submission.submittedAt ? [`- Submitted: ${submission.submittedAt}`] : []), ""];
  const written = String(submission.text || "").trim();
  if (written) out.push("## Written answer", "", written, "");
  const questions = Array.isArray(assignment.details?.questions) ? assignment.details.questions : [];
  const answers = submission.answers && typeof submission.answers === "object" ? submission.answers : {};
  if (questions.length) {
    out.push("## Questions and answers", "");
    for (const block of paperBlocks(assignment.details)) {
      if (block.newSection) {
        if (block.section.title) out.push(`### ${block.section.title}`, "");
        if (block.section.instructions) out.push(`_${block.section.instructions}_`, "");
      }
      if (block.passage) out.push(`> **${block.passage.title || "Passage"}** (${passageRange(block.items)})`, ">", ...block.passage.text.split("\n").map((l) => `> ${l}`), "");
      for (const { q, i } of block.items) {
        const raw = answers[String(i)] ?? answers[i];
        const answered = raw !== undefined && raw !== null && String(raw).trim() !== "";
        // A heading is one line: an assertion-and-reason question's two lines join.
        out.push(`### Q${i + 1}. ${qText(q).replace(/\n+/g, " · ")}`, "");
        if (q?.format === "label" && Array.isArray(q.labels)) out.push(`_Name the labelled parts: ${q.labels.join(", ")}_`, "");
        if (q?.figure) out.push(`_[Figure${q.figure.caption ? `: ${q.figure.caption}` : ""} — see the PDF]_`, "");
        const qFiles = files.filter((f) => f.question === i);
        if (typeof q === "object" && q && Array.isArray(q.options)) {
          const choice = readChoice(q, raw);
          q.options.forEach((opt, oi) => out.push(`- ${choice === oi ? "**[x]**" : "[ ]"} ${letterOf(oi)}. ${opt}`));
          const typed = typeof raw === "number" ? letterOf(raw) : String(raw ?? "").trim();
          out.push("", answered ? `Answer: ${typed}${choice !== null && typed.toUpperCase() !== letterOf(choice) ? ` (read as ${letterOf(choice)})` : choice === null ? " (not an option)" : ""}` : qFiles.length ? "_Answered with a file_" : "_No answer_", "");
        } else out.push(answered ? String(raw) : qFiles.length ? "_Answered with a file_" : "_No answer_", "");
        for (const f of qFiles) out.push(`_Attached: ${f.name}${f.kind === "image" ? " (a photo or drawing — see the PDF)" : ""}_`, "");
      }
    }
  }
  if (files.length) {
    out.push("## Attachments", "");
    for (const f of files) {
      out.push(`### ${f.name}`, "");
      out.push(f.text ? String(f.text).slice(0, SUBMISSION_PDF_LIMITS.MAX_TEXT_CHARS) : `_${f.kind === "image" ? "An image — see the PDF." : "No text could be read from this file — see the PDF."}_`, "");
    }
  }
  return out.join("\n").trim() + "\n";
}

/**
 * Build the PDF. → { bytes: Uint8Array, pages, notes[] }
 *   assignment  { title, type, subject, topic, details:{ questions }, due_at }
 *   learner     { name, username }
 *   submission  { text, answers, submittedAt }
 *   files       [{ name, size, kind, bytes }] — the attachments, in order
 */
export async function buildSubmissionPdf({ assignment = {}, learner = {}, submission = {}, files = [] }) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fonts().regular, { subset: true });
  const bold = await doc.embedFont(fonts().bold, { subset: true });
  const probe = fontkit.create(fonts().regular);
  const flow = new Flow(doc, regular, bold, (cp) => !isRtl(cp) && probe.hasGlyphForCodePoint(cp));
  const notes = [];
  const title = String(assignment.title || "Activity");
  const who = String(learner.name || learner.username || "Learner");

  doc.setTitle(`${title} — ${who}`);
  doc.setAuthor(who);
  doc.setSubject("Akoro activity submission");
  doc.setProducer("Akoro");

  // 1. Cover block.
  flow.newPage();
  flow.text("ACTIVITY SUBMISSION", { size: 8.5, bold: true, color: ACCENT, gap: 2 });
  flow.text(title, { size: 20, bold: true, gap: 6 });
  const meta = [
    [assignment.subject, assignment.topic].filter(Boolean).join(" · "),
    `Learner: ${who}${learner.username ? ` (@${learner.username})` : ""}`,
    submission.submittedAt ? `Submitted: ${fmtDate(submission.submittedAt)}` : "",
    assignment.due_at ? `Due: ${fmtDate(assignment.due_at)}` : "",
  ].filter(Boolean);
  for (const m of meta) flow.text(m, { size: 10, color: MUTED, gap: 1 });
  flow.rule(12);

  // 2. Written answer.
  const written = String(submission.text || "").trim();
  if (written) {
    flow.heading("Written answer");
    flow.text(written, { size: 11 });
  }

  // 3. Questions and answers.
  const questions = Array.isArray(assignment.details?.questions) ? assignment.details.questions : [];
  const answers = submission.answers && typeof submission.answers === "object" ? submission.answers : {};
  if (questions.length) {
    flow.heading("Questions and answers");
    const figures = new Map();   // the same figure is embedded once
    for (const block of paperBlocks(assignment.details)) {
      if (block.newSection) {
        flow.ensure(120);   // a heading stays with what follows it
        if (block.section.title) flow.text(block.section.title.toUpperCase(), { size: 10.5, bold: true, color: ACCENT, gap: 2 });
        if (block.section.instructions) flow.text(block.section.instructions, { size: 10, color: MUTED, gap: 8 });
      }
      if (block.passage) {
        flow.ensure(120);
        flow.text(`${block.passage.title || "Read the passage"} — ${passageRange(block.items)}`, { size: 10.5, bold: true, gap: 3 });
        flow.text(block.passage.text, { size: 10.5, indent: 10, gap: 10 });
      }
      for (const { q, i } of block.items) {
        const pts = typeof q === "object" && q && Number(q.max_points ?? q.points) > 0 ? ` (${Number(q.max_points ?? q.points)} pts)` : "";
        flow.ensure(46);
        flow.text(`Q${i + 1}${pts}. ${qText(q)}`, { size: 11, bold: true, gap: 3 });
        if (q?.figure) {
          const key = q.figure.src || q.figure.svg;
          if (!figures.has(key)) {
            const png = await figurePng(q.figure);
            figures.set(key, png ? await (png.type === "jpeg" ? doc.embedJpg(png.bytes) : doc.embedPng(png.bytes)).catch(() => null) : null);
          }
          const img = figures.get(key);
          if (img) flow.image(img, { indent: 14, gap: q.figure.caption ? 2 : 8 });
          else notes.push(`Question ${i + 1}: its figure couldn't be drawn in the PDF.`);
          if (q.figure.caption) flow.text(q.figure.caption, { size: 9, color: MUTED, indent: 14, gap: 8 });
      }
      if (!q?.figure && q?.figure_note) flow.text(`[Figure: ${q.figure_note}]`, { size: 9.5, color: MUTED, indent: 14, gap: 6 });
      if (q?.format === "label" && Array.isArray(q.labels)) flow.text(`Name the labelled parts: ${q.labels.join(", ")}`, { size: 10, color: MUTED, indent: 14, gap: 4 });
      // The learner's answer: what they typed (an MCQ's typed answer read
      // as its option), then the files that answer this question — photos
      // and whiteboard drawings drawn right here, documents at the end.
      const raw = answers[String(i)] ?? answers[i];
      const answered = raw !== undefined && raw !== null && String(raw).trim() !== "";
      const qFiles = files.filter((f) => f.question === i);
      if (typeof q === "object" && q && Array.isArray(q.options)) {
        const choice = readChoice(q, raw);
        q.options.forEach((opt, oi) => {
          const picked = choice === oi;
          flow.text(`${picked ? "●" : "○"}  ${letterOf(oi)}. ${opt}`, { size: 10.5, bold: picked, color: picked ? INK : MUTED, indent: 14, gap: 0 });
        });
        const typed = typeof raw === "number" ? letterOf(raw) : String(raw ?? "").trim();
        if (answered) {
          flow.text(`Answer: ${typed}${choice !== null && typed.toUpperCase() !== letterOf(choice) ? ` (read as ${letterOf(choice)})` : choice === null ? " (not an option — for the teacher to read)" : ""}`,
            { size: 10, bold: true, color: ACCENT, indent: 14, gap: qFiles.length ? 4 : 10 });
        }
      } else if (answered) {
        flow.text(String(raw), { size: 11, color: INK, indent: 14, gap: qFiles.length ? 4 : 10 });
      }
      for (const f of qFiles) {
        if (f.kind === "image" && f.bytes?.length) {
          try {
            const img = /^\x89PNG/.test(Buffer.from(f.bytes).subarray(0, 4).toString("latin1")) ? await doc.embedPng(f.bytes) : await doc.embedJpg(f.bytes);
            flow.text(`Attached: ${f.name}`, { size: 9.5, color: MUTED, indent: 14, gap: 2 });
            flow.image(img, { indent: 14, maxH: 300, gap: 8 });
            f._inline = true;
            continue;
          } catch { /* drawn with the attachments instead */ }
        }
        flow.text(`Attached: ${f.name} — attachment ${files.indexOf(f) + 1}, at the end`, { size: 9.5, color: MUTED, indent: 14, gap: 4 });
      }
      if (!answered && !qFiles.length) flow.text("No answer", { size: 10, bold: true, color: MUTED, indent: 14, gap: 10 });
      else flow.y -= 4;
      }
    }
  } else if (Object.keys(answers).length) {
    flow.heading("Answers");
    for (const k of Object.keys(answers).sort((a, b) => Number(a) - Number(b))) {
      flow.text(`Q${Number(k) + 1}`, { size: 11, bold: true, gap: 2 });
      flow.text(String(answers[k]), { size: 11, indent: 14, gap: 8 });
    }
  }
  if (!written && !questions.length && !Object.keys(answers).length && !files.length) {
    flow.text("No written work or files were submitted.", { size: 11, color: MUTED });
  }

  // 4. Attachments (photos already drawn under their question aren't repeated).
  let mergedPages = 0;
  files.forEach((f, i) => { f._n = i + 1; });
  const rest = files.filter((f) => !f._inline);
  if (files.length) {
    flow.heading("Attachments");
    for (const f of files) flow.text(`${f._n}. ${f.name}${Number.isInteger(f.question) ? ` (question ${f.question + 1})` : ""} — ${fmtSize(f.size)}${f._inline ? " · shown with its question" : ""}`, { size: 10, color: MUTED, gap: 1 });
  }
  for (const f of rest) {
    const label = `Attachment ${f._n}${Number.isInteger(f.question) ? ` (question ${f.question + 1})` : ""}: ${f.name}`;
    try {
      if (f.kind === "pdf") {
        const src = await PDFDocument.load(f.bytes, { ignoreEncryption: true, updateMetadata: false });
        const room = SUBMISSION_PDF_LIMITS.MAX_ATTACHMENT_PAGES - mergedPages;
        const take = Math.min(src.getPageCount(), Math.max(0, room));
        flow.newPage();
        flow.text(label, { size: 13, bold: true, gap: 2 });
        flow.text(`PDF · ${src.getPageCount()} page${src.getPageCount() === 1 ? "" : "s"}${take < src.getPageCount() ? ` · first ${take} included` : ""} — follows`, { size: 10, color: MUTED });
        if (take < src.getPageCount()) notes.push(`${f.name}: only the first ${take} pages were included — open the original for the rest.`);
        const copied = await doc.copyPages(src, Array.from({ length: take }, (_, k) => k));
        copied.forEach((p) => doc.addPage(p));
        mergedPages += take;
        flow.page = null;   // the next text starts on a fresh page
      } else if (f.kind === "image") {
        const img = /^\x89PNG/.test(Buffer.from(f.bytes).subarray(0, 4).toString("latin1"))
          ? await doc.embedPng(f.bytes) : await doc.embedJpg(f.bytes);
        const page = flow.newPage();
        flow.text(label, { size: 12, bold: true, gap: 6 });
        const maxW = A4[0] - M * 2, maxH = flow.y - M - 20;
        const s = Math.min(maxW / img.width, maxH / img.height, 1.5);
        page.drawImage(img, { x: M + (maxW - img.width * s) / 2, y: flow.y - img.height * s, width: img.width * s, height: img.height * s });
        flow.page = null;
      } else if (f.kind === "docx" || f.kind === "text") {
        flow.newPage();
        flow.text(label, { size: 13, bold: true, gap: 2 });
        flow.text(f.kind === "docx" ? "Word document — its text follows (layout and pictures are in the original)." : "Text file — follows.", { size: 10, color: MUTED, gap: 8 });
        const body = f.kind === "docx"
          ? docxToPages(f.bytes).map((p) => p.markdown).join("\n\n")
          : Buffer.from(f.bytes).toString("utf8").replace(/^﻿/, "");
        const capped = body.slice(0, SUBMISSION_PDF_LIMITS.MAX_TEXT_CHARS);
        for (const block of capped.split(/\n{2,}/)) {
          const h = /^(#{1,6})\s+(.*)$/s.exec(block.trim());
          if (h) flow.text(h[2], { size: h[1].length <= 2 ? 13 : 11.5, bold: true, gap: 4 });
          else if (block.trim().startsWith("|")) {
            // A table: one line per row, cells separated, the --- row dropped.
            const rows = block.trim().split("\n").filter((r) => !/^\|\s*-{3,}/.test(r.trim()));
            rows.forEach((r, ri) => flow.text(r.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|")).join("   ·   "),
              { size: 10.5, bold: ri === 0, gap: ri === rows.length - 1 ? 6 : 0 }));
          }
          else flow.text(block, { size: 10.5, gap: 6 });
        }
        if (body.length > capped.length) notes.push(`${f.name}: the text was too long to include in full — open the original.`);
      } else {
        throw new Error("This file type can't be shown in the PDF.");
      }
    } catch (e) {
      flow.newPage();
      flow.text(label, { size: 13, bold: true, gap: 2 });
      flow.text(`This file couldn't be added to the PDF (${String(e?.message || e).slice(0, 120)}). Open the original attachment.`, { size: 10.5, color: MUTED });
      notes.push(`${f.name}: couldn't be added — open the original.`);
      flow.page = null;
    }
  }
  if (flow.replaced) notes.push(`${flow.replaced} character${flow.replaced === 1 ? "" : "s"} this PDF's font can't show were replaced with "?" — the original text is in the submission.`);

  // Notes for the grader, then the footer on every page.
  if (notes.length) {
    flow.newPage();
    flow.heading("Notes");
    for (const n of notes) flow.text(`• ${n}`, { size: 10, color: MUTED, gap: 2 });
  }
  const pages = doc.getPages();
  const foot = flow.clean(`${who} · ${title}`).slice(0, 90);
  pages.forEach((p, i) => {
    const { width } = p.getSize();
    const label = `${foot} · page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: Math.max(12, (width - regular.widthOfTextAtSize(label, 7.5)) / 2), y: 16, size: 7.5, font: regular, color: MUTED });
  });

  const bytes = await doc.save();
  return { bytes, pages: pages.length, notes };
}
