/*
 * gradingDrafts.js — local autosave for the grading workbench.
 *
 * A grading session autosaves to localStorage as the teacher works; publish
 * is the only thing that touches the server. So a closed tab, a dead
 * network, or a paused afternoon loses nothing: the NowGrading strip (and
 * the workbench) resume the draft exactly where it stopped.
 *
 * Drafts are keyed per activity+student and carry denormalised display
 * names, so the resume strip never needs a fetch.
 */
const PREFIX = 'ak:grading-draft:';

const key = (assignmentId, studentId) => `${PREFIX}${assignmentId}:${studentId}`;

export function saveDraft(draft) {
  try {
    localStorage.setItem(key(draft.assignmentId, draft.studentId), JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch { /* storage full/blocked — grading still works, it just won't resume */ }
}

export function loadDraft(assignmentId, studentId) {
  try {
    const raw = localStorage.getItem(key(assignmentId, studentId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearDraft(assignmentId, studentId) {
  try { localStorage.removeItem(key(assignmentId, studentId)); } catch { /* ignore */ }
}

/** All in-progress drafts, most recently touched first. */
export function listDrafts() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      try { out.push(JSON.parse(localStorage.getItem(k))); } catch { /* corrupt draft — skip */ }
    }
  } catch { return []; }
  return out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

export const DRAFT_PREFIX = PREFIX;
