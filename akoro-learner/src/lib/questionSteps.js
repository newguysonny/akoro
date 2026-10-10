/**
 * questionSteps — an assignment answered one question at a time, by typing
 * (and/or files for that question).
 *
 * `local` is what's on screen (kept in the browser); `saved` is what the
 * server holds for each question (autosaved as the learner types). Files
 * go to the server the moment they're attached. A step is:
 *   saved   — the server has it (typed text, or only files)
 *   edited  — typed since the last save (saving…)
 *   empty   — no text and no files
 */

const isMcq = (q) => typeof q === 'object' && q !== null && Array.isArray(q.options);
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * An answer as the answer box shows it: an older MCQ pick (an option
 * number) reads as its letter — "B" — like the learner would type it.
 */
export function shownAnswer(q, v) {
  return isMcq(q) && typeof v === 'number' && Number.isInteger(v) && LETTERS[v] ? LETTERS[v] : v;
}

/** A value that counts as a typed answer (an older option number counts). */
export function hasAnswer(q, v) {
  if (v === undefined || v === null) return false;
  return String(v).trim() !== '';
}

/** Two answers are the same — text ignoring outer spaces; 1 and "B" agree on an MCQ. */
export function sameAnswer(q, a, b) {
  const ha = hasAnswer(q, a), hb = hasAnswer(q, b);
  if (!ha || !hb) return ha === hb;
  return String(shownAnswer(q, a)).trim() === String(shownAnswer(q, b)).trim();
}

export function stepStatus(q, localValue, savedValue, fileCount = 0) {
  if (!hasAnswer(q, localValue)) return hasAnswer(q, savedValue) ? 'edited' : fileCount > 0 ? 'saved' : 'empty';
  return hasAnswer(q, savedValue) && sameAnswer(q, localValue, savedValue) ? 'saved' : 'edited';
}

/** fileCounts: { [index]: files attached to that question } */
export function stepStatuses(questions, local = {}, saved = {}, fileCounts = {}) {
  return (questions || []).map((q, i) => stepStatus(q, local?.[i], saved?.[i], Number(fileCounts?.[i]) || 0));
}

/** Where to resume: the first step not answered and saved yet, else the review. */
export function resumeStep(questions, local = {}, saved = {}, fileCounts = {}) {
  const st = stepStatuses(questions, local, saved, fileCounts);
  const i = st.findIndex((s) => s !== 'saved');
  return i === -1 ? (questions || []).length : i;   // length = the review step
}

/**
 * What to tell the learner before they hand in (the last-check sheet).
 * → { unanswered: [i], blanks: [{ index, parts: ['Q', …] }], pending: [i], files }
 */
export function lastCheck(questions, local = {}, saved = {}, fileCounts = {}) {
  const st = stepStatuses(questions, local, saved, fileCounts);
  const blanks = [];
  (questions || []).forEach((q, i) => {
    if (q?.format !== 'label' || !Array.isArray(q.labels) || !hasAnswer(q, local?.[i])) return;
    const filled = new Set(String(local[i]).split('\n').map((l) => /^\s*([^:]{1,12}?)\s*:\s*\S/.exec(l)?.[1]).filter(Boolean));
    const parts = q.labels.filter((l) => !filled.has(l));
    if (parts.length) blanks.push({ index: i, parts });
  });
  return {
    unanswered: st.map((s, i) => (s === 'empty' ? i : -1)).filter((i) => i > -1),
    blanks,
    pending: st.map((s, i) => (s === 'edited' ? i : -1)).filter((i) => i > -1),
    files: Object.values(fileCounts || {}).reduce((n, c) => n + (Number(c) || 0), 0),
  };
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
