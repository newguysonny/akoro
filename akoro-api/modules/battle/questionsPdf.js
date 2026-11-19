/**
 * battle/questionsPdf.js — a finished battle's questions as one PDF: what the
 * Questions tab shows (every question in order, its options, the answer and
 * its explanation). Same fonts and layout as the submission PDF
 * (self-study/submissionPdf.js), so Yoruba, Igbo and Hausa letters print.
 */
import { newPdf, PDF_STYLE } from "../../lib/pdf.js";

const { M, MUTED, ACCENT, letterOf, fmtDate } = PDF_STYLE;
const GREEN = [0.02, 0.47, 0.34];

/** PURE: battle_questions rows → what is printed. */
export function questionRows(rows = []) {
  return [...rows].sort((a, b) => a.question_order - b.question_order).map((q) => {
    let options = [];
    try { options = Array.isArray(q.options) ? q.options : JSON.parse(q.options_json || "[]"); } catch { options = []; }
    return { order: q.question_order, text: String(q.question_text || ""), topic: q.topic || null, options, correct: q.correct_answer_index ?? null, explanation: q.explanation || null };
  });
}

/** → Uint8Array (a PDF). battle: { title, subject, topic, actual_end } */
export async function buildQuestionsPdf({ battle = {}, questions = [] }) {
  const { rgb } = await import("pdf-lib");
  const { doc, flow, regular } = await newPdf();
  const title = String(battle.title || "Battle");
  const rows = questionRows(questions);
  doc.setTitle(`${title} — questions`);
  doc.setSubject("Akoro battle questions");
  doc.setProducer("Akoro");

  flow.newPage();
  flow.text("BATTLE QUESTIONS", { size: 8.5, bold: true, color: ACCENT, gap: 2 });
  flow.text(title, { size: 20, bold: true, gap: 6 });
  for (const m of [[battle.subject, battle.topic].filter(Boolean).join(" · "), `${rows.length} question${rows.length === 1 ? "" : "s"}`, battle.actual_end ? `Played: ${fmtDate(battle.actual_end)}` : ""].filter(Boolean)) {
    flow.text(m, { size: 10, color: MUTED, gap: 1 });
  }
  flow.rule(12);

  for (const q of rows) {
    flow.ensure(70);   // a question stays with its first options
    flow.text(`Q${q.order}. ${q.text}`, { size: 11, bold: true, gap: q.topic ? 1 : 4 });
    if (q.topic) flow.text(q.topic, { size: 9, color: MUTED, gap: 4 });
    q.options.forEach((o, i) => flow.text(`${letterOf(i)}.  ${o}`, { size: 10.5, indent: 14, gap: 1, ...(i === q.correct ? { bold: true, color: rgb(...GREEN) } : {}) }));
    flow.y -= 3;
    if (q.correct != null && q.options[q.correct] != null) flow.text(`Answer: ${letterOf(q.correct)}. ${q.options[q.correct]}`, { size: 10.5, bold: true, color: rgb(...GREEN), indent: 14, gap: q.explanation ? 1 : 10 });
    if (q.explanation) flow.text(q.explanation, { size: 9.5, color: MUTED, indent: 14, gap: 10 });
  }

  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const foot = `${title} · questions · page ${i + 1} of ${pages.length}`;
    page.drawText(flow.clean(foot), { x: M, y: M - 22, size: 8, font: regular, color: MUTED });
  });
  return doc.save();
}
