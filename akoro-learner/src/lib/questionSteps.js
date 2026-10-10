/**
 * questionSteps — an assignment answered one question at a time.
 *
 * `local` is what's on screen (autosaved in the browser); `saved` is what
 * the learner has SUBMITTED for each question (kept on the server). A step
 * is:
 *   saved   — submitted, and unchanged since
 *   edited  — changed since it was submitted (or typed, never submitted)
 *   empty   — no answer
 */

const isMcq = (q) => typeof q === 'object' && q !== null && Array.isArray(q.options);

/** A value that counts as an answer for this question. */
export function hasAnswer(q, v) {
  if (v === undefined || v === null) return false;
  if (isMcq(q)) return Number.isInteger(Number(v)) && String(v).trim() !== '';
  return String(v).trim() !== '';
}

/** Two answers are the same (MCQ by option, text ignoring outer spaces). */
export function sameAnswer(q, a, b) {
  const ha = hasAnswer(q, a), hb = hasAnswer(q, b);
  if (!ha || !hb) return ha === hb;
  return isMcq(q) ? Number(a) === Number(b) : String(a).trim() === String(b).trim();
}

export function stepStatus(q, localValue, savedValue) {
  if (!hasAnswer(q, localValue)) return hasAnswer(q, savedValue) ? 'edited' : 'empty';
  return hasAnswer(q, savedValue) && sameAnswer(q, localValue, savedValue) ? 'saved' : 'edited';
}

export function stepStatuses(questions, local = {}, saved = {}) {
  return (questions || []).map((q, i) => stepStatus(q, local?.[i], saved?.[i]));
}

/** Where to resume: the first step not submitted yet, else the review. */
export function resumeStep(questions, local = {}, saved = {}) {
  const st = stepStatuses(questions, local, saved);
  const i = st.findIndex((s) => s !== 'saved');
  return i === -1 ? (questions || []).length : i;   // length = the review step
}

/**
 * The answers to show when the page opens: the server's submitted answers,
 * with the browser's unsent edits on top — unless the server copy is newer
 * (the learner moved on from another device).
 */
export function openingAnswers({ saved = {}, savedAt = null, local = {}, editedAt = null }) {
  const serverNewer = savedAt && (!editedAt || Date.parse(savedAt) >= Date.parse(editedAt));
  return serverNewer ? { ...saved } : { ...saved, ...local };
}
