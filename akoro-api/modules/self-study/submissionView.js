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
      const { correct, answer, explanation, ...rest } = q;   // eslint-disable-line no-unused-vars
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
 * One saved answer → its clean value, or { error }. An MCQ answer is the
 * option's index; anything else is text (≤4000 chars). An empty value
 * clears the answer (null).
 */
export function cleanAnswer(questions, index, value) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= (questions || []).length) return { error: "No such question." };
  const q = questions[i];
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return { index: i, value: null };
  if (isMcqQ(q)) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n >= q.options.length) return { error: "Pick one of the options." };
    return { index: i, value: n };
  }
  if (typeof value !== "string" && typeof value !== "number") return { error: "An answer is text." };
  return { index: i, value: String(value).slice(0, 4000) };
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
    const raw = Number(m?.awarded);
    const awarded = Number.isFinite(raw) ? Math.min(max, Math.max(0, Math.round(raw * 2) / 2)) : null;
    marks.push({ index: i, awarded, max, comment: String(m?.comment ?? "").trim().slice(0, 1000) });
  }
  return { marks: marks.sort((a, b) => a.index - b.index) };
}
