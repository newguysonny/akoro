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
