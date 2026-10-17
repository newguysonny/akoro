/**
 * modules/self-study/submissionView.js — what each side may see of an
 * activity and its submission. Pure (covered by the contract test).
 */

/** The brief as a learner may see it: MCQ answer keys stay hidden until the
 *  work is graded (then the review marks right and wrong). */
export function briefForLearner(details, graded) {
  if (graded || !details || !Array.isArray(details.questions)) return details ?? {};
  return {
    ...details,
    questions: details.questions.map((q) => {
      if (!q || typeof q !== "object") return q;
      const { correct, answer, explanation, marking, ...rest } = q;   // eslint-disable-line no-unused-vars
      return rest;
    }),
  };
}

/** Is the stored PDF the one for the current submission? */
export const pdfIsCurrent = (target) =>
  !!target?.submission_pdf?.key && !!target?.submission?.submittedAt && target.submission_pdf.builtFor === target.submission.submittedAt;

/** The submission PDF as the apps see it (never the storage key). */
export const pdfMeta = (t) => (t?.submission?.submittedAt
  ? { ready: pdfIsCurrent(t), pages: pdfIsCurrent(t) ? t.submission_pdf.pages ?? null : null, notes: pdfIsCurrent(t) ? t.submission_pdf.notes ?? [] : [] }
  : null);

/* ── One question at a time ────────────────────────────────────────────── */

const isMcqQ = (q) => !!q && typeof q === "object" && Array.isArray(q.options);
/** A question's points (max_points / points), or null when it has none. */
export const questionPoints = (q) => {
  const n = Number(q && typeof q === "object" ? q.max_points ?? q.points : NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * A typed answer to a multiple-choice question → the option it names, or
 * null when it can't be read (that answer goes to the teacher / AI grader).
 *   2 (an option index — older clients)  "B"  "b."  "(B)"  "Option B"
 *   "Answer: b"  "B. Carbon dioxide"  "B Carbon dioxide"  "carbon dioxide"
 *   True / False: also "T", "F", "yes", "no"
 * The learner and instructor apps carry the same reader (lib/paper.js) —
 * a contract test keeps all three in step.
 */
export function readChoice(q, value) {
  const opts = q && typeof q === "object" && Array.isArray(q.options) ? q.options : null;
  if (!opts || value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value < opts.length ? value : null;
  const s = String(value).trim();
  if (!s) return null;
  const norm = (x) => String(x).toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
  const at = (ch) => { const i = "abcdefghijklmnopqrstuvwxyz".indexOf(String(ch).toLowerCase()); return i >= 0 && i < opts.length ? i : null; };
  const exact = opts.findIndex((o) => norm(o) === norm(s));
  if (exact >= 0) return exact;
  const tf = q.format === "true_false" || (opts.length === 2 && norm(opts[0]) === "true" && norm(opts[1]) === "false");
  if (tf && /^(t|yes|y|correct)$/i.test(norm(s))) return 0;
  if (tf && /^(f|no|n|incorrect|wrong)$/i.test(norm(s))) return 1;
  let m = /^(?:(?:option|answer|ans)\s*[:\-]?\s*)?\(?([a-z])\)?\s*[.):\-]?$/i.exec(s);
  if (m) return at(m[1]);
  m = /^\(?([a-z])\s*[.):\-]\s*(\S.*)$/i.exec(s);
  if (m) {
    // "B. …" names B — unless its words are ANOTHER option's: then it's unclear.
    const i = at(m[1]);
    const other = opts.findIndex((o, j) => j !== i && norm(o) === norm(m[2]));
    return other >= 0 ? null : i;
  }
  m = /^([a-z])\s+(.+)$/i.exec(s);
  if (m) { const i = at(m[1]); if (i !== null && norm(m[2]) === norm(opts[i])) return i; }
  return null;
}

/**
 * One saved answer → its clean value, or { error }. Every answer is TYPED
 * text now (≤4000 chars) — a multiple-choice answer too ("B", "carbon
 * dioxide"); readChoice() reads the option from it when marking. An option
 * index (older clients) is still accepted. An empty value clears the answer.
 */
export function cleanAnswer(questions, index, value) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= (questions || []).length) return { error: "No such question." };
  const q = questions[i];
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return { index: i, value: null };
  if (typeof value === "number") {
    if (isMcqQ(q) && !(Number.isInteger(value) && value >= 0 && value < q.options.length)) return { error: "No such option." };
    return { index: i, value: isMcqQ(q) ? value : String(value) };
  }
  if (typeof value !== "string") return { error: "An answer is text." };
  return { index: i, value: value.slice(0, 4000) };
}

/**
 * The grader's per-question marks → clean rows, or { error }.
 * [{ index, awarded, max, comment }] — awarded in halves, 0..max; max is the
 * question's points (5 when it has none); one row per question at most.
 */
export function cleanQuestionMarks(questions, input) {
  if (input === undefined) return { marks: [] };
  if (!Array.isArray(input)) return { error: "questions must be a list." };
  const seen = new Set();
  const marks = [];
  for (const m of input.slice(0, 60)) {
    const i = Number(m?.index);
    if (!Number.isInteger(i) || i < 0 || i >= (questions || []).length || seen.has(i)) continue;
    seen.add(i);
    const max = questionPoints(questions[i]) ?? 5;
    // Not marked stays not marked (null) — never a silent 0.
    const given = m?.awarded !== null && m?.awarded !== undefined && String(m.awarded).trim() !== "";
    const raw = given ? Number(m.awarded) : NaN;
    const awarded = Number.isFinite(raw) ? Math.min(max, Math.max(0, Math.round(raw * 2) / 2)) : null;
    marks.push({ index: i, awarded, max, comment: String(m?.comment ?? "").trim().slice(0, 1000) });
  }
  return { marks: marks.sort((a, b) => a.index - b.index) };
}
