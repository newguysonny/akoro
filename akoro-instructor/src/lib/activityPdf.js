/**
 * activityPdf.js — "Download PDF" for an activity's details view.
 *
 * Renders the instructor's copy of an AI-prepared activity (or workbench
 * draft) to a clean A4 PDF with jsPDF: the brief, instructions, then the
 * paper — passages, sections, numbered questions with options, the answer
 * key and points (this is the teacher's sheet, so the key is included) —
 * or the study plan when the activity has no paper yet. Fully offline,
 * straight from the data already on screen.
 */
import { jsPDF } from 'jspdf';

const INK = [23, 23, 23];
const MUTED = [107, 114, 128];
const BRAND = [232, 136, 74];
const MARGIN = 52;
const PAGE_W = 595;  // jsPDF pt

const slug = (s) =>
  String(s || 'activity').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'activity';

export function downloadActivityPdf({ draft, meta = {}, shown = null, audience = {} }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = PAGE_W - MARGIN * 2;
  let y = MARGIN;

  const ensure = (h) => { if (y + h > 792 - MARGIN) { doc.addPage(); y = MARGIN; } };
  const put = (str, { size = 10.5, style = 'normal', color = INK, gap = 6, indent = 0 } = {}) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(str ?? ''), W - indent);
    ensure(lines.length * (size * 1.35) + gap);
    lines.forEach((line) => { doc.text(line, MARGIN + indent, y + size); y += size * 1.35; });
    y += gap;
  };
  const rule = (color = [229, 231, 235]) => {
    ensure(10);
    doc.setDrawColor(...color); doc.setLineWidth(0.8);
    doc.line(MARGIN, y + 4, PAGE_W - MARGIN, y + 4);
    y += 12;
  };

  // ── Header ──
  put(draft?.title || 'Activity', { size: 16.5, style: 'bold', gap: 4 });
  const bits = [meta.name || draft?.type?.replace(/_/g, ' '), draft?.payload?.subject, draft?.payload?.topic, draft?.payload?.difficulty].filter(Boolean);
  put(bits.join('  ·  '), { size: 9.5, color: MUTED, gap: 8 });
  rule();

  // ── The brief ──
  const due = draft?.payload?.due_at ? new Date(draft.payload.due_at).toLocaleString() : draft?.payload?.due_hint;
  const brief = [
    audience.class_name ? `Class: ${audience.class_name}` : null,
    audience.label && !audience.class_name ? `Audience: ${audience.label}` : null,
    due ? `Due: ${due}` : null,
  ].filter(Boolean);
  if (brief.length) put(brief.join('    '), { size: 9.5, color: MUTED, gap: 8 });

  if (draft?.payload?.instructions) {
    put('Instructions', { size: 10.5, style: 'bold', gap: 3 });
    put(draft.payload.instructions, { size: 10, gap: 10 });
  }

  const paper = shown?.status === 'ready' ? shown.paper : null;
  const questions = paper?.questions ?? [];
  const sections = paper?.sections ?? [];
  const passages = paper?.passages ?? [];
  const qOf = (q) => {
    const obj = q && typeof q === 'object' ? q : { q: String(q ?? '') };
    const opts = Array.isArray(obj.options) && obj.options.length >= 2 ? obj.options : null;
    return {
      q: obj.q || obj.text || '',
      options: opts || null,
      correct: opts ? Math.min(Math.max(Number(obj.correct ?? obj.correct_answer_index) || 0, 0), opts.length - 1) : null,
      points: obj.max_points ?? obj.points ?? null,
      section: Number.isInteger(obj.section) ? obj.section : null,
    };
  };

  if (questions.length) {
    // Passages first (a paper's reading material), each with its title.
    passages.forEach((p, i) => {
      const title = p?.title || `Passage ${i + 1}`;
      const body = p?.text || p?.body || '';
      put(title, { size: 11, style: 'bold', gap: 3 });
      if (body) put(body, { size: 10, style: 'italic', gap: 10 });
    });
    let lastSection = null;
    questions.forEach((raw, i) => {
      const q = qOf(raw);
      if (q.section != null && sections[q.section]?.title && q.section !== lastSection) {
        lastSection = q.section;
        y += 4;
        put(sections[q.section].title, { size: 11.5, style: 'bold', color: BRAND, gap: 6 });
      }
      const pts = q.points ? `   [${q.points} pts]` : '';
      put(`${i + 1}.  ${q.q}${pts}`, { size: 10.5, style: 'bold', gap: 3 });
      if (q.options) {
        const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
        q.options.forEach((opt, oi) => put(`${letters[oi]}.  ${opt}`, { size: 10, indent: 16, gap: 2 }));
        put(`Answer: ${letters[q.correct]}`, { size: 9.5, style: 'bold', color: [16, 185, 129], indent: 16, gap: 10 });
      } else {
        put('(written response)', { size: 9.5, style: 'italic', color: MUTED, indent: 16, gap: 10 });
      }
    });
  } else if ((draft?.payload?.subtopics || []).length) {
    // No paper yet — print the study plan.
    put('Plan', { size: 11.5, style: 'bold', gap: 6 });
    (draft.payload.subtopics || []).forEach((st, i) => {
      put(`${i + 1}.  ${st}`, { size: 10.5, style: 'bold', gap: 2 });
      (draft.payload.objectives?.[st] || []).forEach((o) => put(`–  ${o}`, { size: 9.5, color: MUTED, indent: 16, gap: 2 }));
      y += 5;
    });
  } else if ((draft?.payload?.details?.stages || []).length) {
    put('Journey stages', { size: 11.5, style: 'bold', gap: 6 });
    draft.payload.details.stages.forEach((st, i) => {
      put(`${i + 1}.  ${st.title}   (${(st.kind || '').replace(/_/g, ' ')})`, { size: 10.5, style: 'bold', gap: 1 });
      put(`${st.subject || ''}${st.subject && st.topic ? ' · ' : ''}${st.topic || ''}`, { size: 9.5, color: MUTED, indent: 16, gap: 6 });
    });
  }

  // ── Footers: attribution + page numbers on every page ──
  const stamp = new Date().toLocaleString();
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(`Akoro — generated ${stamp}`, MARGIN, 812);
    doc.text(`Page ${p} of ${total}`, PAGE_W - MARGIN, 812, { align: 'right' });
  }

  doc.save(`${slug(draft?.title)}${shown ? `-v${shown.n}` : ''}.pdf`);
}
