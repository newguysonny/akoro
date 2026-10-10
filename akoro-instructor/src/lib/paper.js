/*
 * paper.js — an assignment laid out like an exam paper (the NCEE papers in
 * reference/question-layout-for-activity). Kept byte-identical in
 * akoro-learner/src/lib and akoro-instructor/src/lib (a contract test checks).
 *
 *   details.sections  [{ title, instructions }]
 *   details.passages  [{ title, text }]
 *   question.section / .passage   indices into those lists (optional)
 *   question.figure   { svg | src, caption }   drawn between the question
 *                                              text and its options
 *
 * The questions stay one flat list — answers and marks key on the index.
 */

/** Option letters: A, B, C, D, E… */
export const letterOf = (i) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Number(i)] ?? '';

/**
 * The paper in reading order: consecutive questions sharing a section (and
 * passage) form one block, so instructions and a passage print once.
 * → [{ sectionIndex, section, passageIndex, passage, newSection, items: [{ q, i }] }]
 */
export function paperBlocks(details) {
  const qs = Array.isArray(details?.questions) ? details.questions : [];
  const sections = Array.isArray(details?.sections) ? details.sections : [];
  const passages = Array.isArray(details?.passages) ? details.passages : [];
  const blocks = [];
  qs.forEach((q, i) => {
    const s = q && typeof q === 'object' && Number.isInteger(q.section) && sections[q.section] ? q.section : null;
    const p = q && typeof q === 'object' && Number.isInteger(q.passage) && passages[q.passage] ? q.passage : null;
    const last = blocks[blocks.length - 1];
    if (last && last.sectionIndex === s && last.passageIndex === p) { last.items.push({ q, i }); return; }
    blocks.push({
      sectionIndex: s, section: s != null ? sections[s] : null,
      passageIndex: p, passage: p != null ? passages[p] : null,
      newSection: s != null && !(last && last.sectionIndex === s),
      items: [{ q, i }],
    });
  });
  return blocks;
}

/** "Questions 3–7" (1-based) for the questions a passage covers. */
export function passageRange(items) {
  const n = (items || []).map((x) => x.i + 1);
  if (!n.length) return '';
  return n.length === 1 ? `Question ${n[0]}` : `Questions ${n[0]}–${n[n.length - 1]}`;
}

/** What one question needs around it: its section, its passage. */
export function questionContext(details, index) {
  const q = details?.questions?.[index];
  const section = q && Number.isInteger(q.section) ? details?.sections?.[q.section] ?? null : null;
  const passage = q && Number.isInteger(q.passage) ? details?.passages?.[q.passage] ?? null : null;
  const items = passage ? (details.questions || []).map((x, i) => ({ q: x, i })).filter((x) => x.q?.passage === q.passage) : [];
  return { section, passage, passageRange: passage ? passageRange(items) : '' };
}

/** A figure as an <img> src — an SVG is shown as an image, so it never runs script. */
export function figureSrc(figure) {
  if (!figure) return null;
  if (typeof figure.src === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(figure.src)) return figure.src;
  if (typeof figure.svg === 'string' && figure.svg.startsWith('<svg')) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(figure.svg)}`;
  return null;
}

/**
 * Maths written the plain way → runs to render: x^2, 10^{-3}, H_2O, a_{n+1}.
 * Unicode (x², ½, √, °, ₦) passes through untouched.
 * → [{ text, sup?: true, sub?: true }]
 */
export function mathRuns(text) {
  const s = String(text ?? '');
  const out = [];
  // Unbraced, a power is a number or one letter (x^2y is x²y); braces take more.
  const re = /([\w)\]]+)(\^|_)(\{([^{}]{1,24})\}|(-?\d{1,4}(?:\.\d+)?|[a-zA-Z]))/g;
  let last = 0, m;
  const push = (t, k) => {
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev && !prev.sup && !prev.sub && !k) prev.text += t;
    else out.push(k ? { text: t, [k]: true } : { text: t });
  };
  while ((m = re.exec(s))) {
    // Leave snake_case words and URLs alone: a subscript needs a short base.
    if (m[2] === '_' && (m[1].length > 3 || (m[5] != null && !/^\d+$/.test(m[5])))) continue;
    push(s.slice(last, m.index) + m[1]);
    push(m[4] ?? m[5], m[2] === '^' ? 'sup' : 'sub');
    last = m.index + m[0].length;
  }
  push(s.slice(last));
  return out.length ? out : [{ text: '' }];
}

/* ── Editing helpers (the instructor workbench) ───────────────────────── */

/** Drop list item `idx` and keep every question's reference in step. */
export function removeRef(questions, key, idx) {
  return (questions || []).map((q) => {
    if (!q || typeof q !== 'object' || !Number.isInteger(q[key])) return q;
    if (q[key] === idx) { const { [key]: _drop, ...rest } = q; return rest; }   // eslint-disable-line no-unused-vars
    return q[key] > idx ? { ...q, [key]: q[key] - 1 } : q;
  });
}

/** An uploaded image → a JPEG/PNG data URL no wider than `max` px and under `maxChars`. */
export async function imageFileToDataUrl(file, { max = 1000, maxChars = 380_000 } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el); el.onerror = () => reject(new Error('That file is not an image we can read.'));
      el.src = url;
    });
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    for (let scale = Math.min(1, max / Math.max(w, h)), quality = 0.85; ; scale *= 0.8, quality = Math.max(0.5, quality - 0.1)) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const out = c.toDataURL('image/jpeg', quality);
      if (out.length <= maxChars) return out;
      if (c.width < 240) throw new Error('That image is too large — try a smaller one.');
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ── Question kinds with a fixed shape (question.format) ──────────────── */

/** The standard Assertion-and-Reason options, always in this order (the server's too). */
export const AR_OPTIONS = Object.freeze([
  'Both the assertion and the reason are true, and the reason correctly explains the assertion.',
  'Both the assertion and the reason are true, but the reason does not explain the assertion.',
  'The assertion is true, but the reason is false.',
  'The assertion is false, but the reason is true.',
]);
export const TF_OPTIONS = Object.freeze(['True', 'False']);
export const FORMAT_NAMES = Object.freeze({
  true_false: 'True or false', assertion_reason: 'Assertion and reason', label: 'Labelling', case_study: 'Case study',
});

/**
 * A labelling answer travels as plain text, one part per line —
 * "P: chloroplast\nQ: stoma" — so grading, the PDF and the AI read it as is.
 */
export function labelAnswerText(labels, values) {
  return (labels || [])
    .map((l) => [l, String(values?.[l] ?? '').replace(/\s+/g, ' ').trim()])
    .filter(([, v]) => v)
    .map(([l, v]) => `${l}: ${v}`)
    .join('\n');
}

/** …and back into one field per part. */
export function parseLabelAnswer(labels, text) {
  const out = Object.fromEntries((labels || []).map((l) => [l, '']));
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\s*([^:]{1,12}?)\s*:\s*(.*)$/.exec(line);
    if (m && m[1] in out) out[m[1]] = m[2].trim();
  }
  return out;
}
