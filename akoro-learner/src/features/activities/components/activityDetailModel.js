import { BRAND, GREEN, GOLD } from '../../../constants.js';
import { FORMAT_NAMES } from '../../../lib/paper.js';

/* ── Type identity: gradient + icon + label (reference TYPE_META) ───────── */
export const TYPE = {
  assignment:  { label: 'Assignment',   icon: 'ti-edit',      light: '#8B5CF6', mid: BRAND,     dark: '#4C1DCC' },
  project:     { label: 'Project',      icon: 'ti-folder',    light: '#34D399', mid: '#10B981', dark: '#047857' },
  self_study:  { label: 'Self study',   icon: 'ti-book-2',    light: '#2DD4BF', mid: '#0D9488', dark: '#0F766E' },
  live_course: { label: 'Live course',  icon: 'ti-device-tv', light: '#FB7185', mid: '#E11D48', dark: '#9F1239' },
  multi_stage: { label: 'Multi-stage activity', icon: 'ti-puzzle', light: '#6D5CE8', mid: '#4338CA', dark: '#34248F' },
  battle:      { label: 'Agent battle', icon: 'ti-swords',    light: '#F87171', mid: '#EF4444', dark: '#B91C1C' },
  quiz:        { label: 'Quiz',         icon: 'ti-help-circle', light: '#60A5FA', mid: '#3B82F6', dark: '#1D4ED8' },
};
export const typeOf = (k) => TYPE[k] || { ...TYPE.assignment, label: 'Activity', icon: 'ti-clipboard' };

export const STATUS = {
  assigned: { label: 'Not started', color: GOLD },
  started:  { label: 'In progress', color: BRAND },
  complete: { label: 'Done',        color: GREEN },
};

export function fmtDue(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/* A question's document draft on this device — { json, page, saved }. */
const docKey = (assignmentId, i) => `ak_doc_${assignmentId}_q${i}`;
export const DRAWING_RE = /^drawing-q\d+\.png$/i;
export const DOC_RE = /^document-q\d+\.docx$/i;
export function loadDoc(assignmentId, i) {
  try { return JSON.parse(localStorage.getItem(docKey(assignmentId, i)) || 'null'); } catch { return null; }
}
export function storeDoc(assignmentId, i, doc) {
  try { if (doc) localStorage.setItem(docKey(assignmentId, i), JSON.stringify(doc)); else localStorage.removeItem(docKey(assignmentId, i)); }
  catch { /* too big for this device's storage — the attached .docx still has it */ }
}

/* Local autosave — answers and the attached file name, per activity. */
export const storeKey = (id) => `ak_activity_work_${id}`;
export function loadWork(id) {
  try { return JSON.parse(localStorage.getItem(storeKey(id)) || 'null') || { answers: {}, text: '' }; }
  catch { return { answers: {}, text: '' }; }
}
export function saveWork(id, w) {
  try { localStorage.setItem(storeKey(id), JSON.stringify(w)); }
  catch {
    // Too big with the drawings' strokes — keep the answers at least.
    try { localStorage.setItem(storeKey(id), JSON.stringify({ ...w, drawings: {} })); } catch { /* private mode */ }
  }
}
export function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
// What the API accepts (it checks the bytes too): PDF, photos, Word .docx, text.
export const FILE_OK = /\.(pdf|jpe?g|png|docx|txt)$/i;

/* ── Question shapes ────────────────────────────────────────────────────────
   A question rides as a plain string (older assignments) or an object:
   .q is the question text and the object may carry marking metadata
   (type, max_points, difficulty, cognitive_level); MCQ adds .options and
   .correct. Mixed sets are normal (AI-drafted assignments mix MCQ with
   short answer, essay, coding…) — decide per question, never per set. */
export const qText = (q) => (typeof q === 'object' && q !== null ? String(q.q ?? '') : String(q ?? ''));
export const isMcq = (q) => typeof q === 'object' && q !== null && Array.isArray(q.options);
/* A question's type as a chip label — MCQs without a stored type still
   say what they are. */
const typeLabel = (t) => { const s = String(t ?? '').replace(/[_-]+/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : ''; };
export const kindOf = (q) => FORMAT_NAMES[q?.format] || (isMcq(q) ? 'Multiple choice' : typeLabel(q?.type) || 'Written answer');
export const ptsOf = (q) => (typeof q === 'object' && q && Number(q.max_points ?? q.points) > 0 ? Number(q.max_points ?? q.points) : null);
export const PER_QUESTION_FILES = 3;

/* ── The assignment, one question at a time ─────────────────────────────
   Q1 → "Submit answer & next" → Q2 → … → Review → "Submit assignment".
   The question sits on top, read-only; below it an answer box like the
   Agent Chat composer: type, attach (up to 3 files), draw on the
   whiteboard. What's typed autosaves to the server as the learner types
   (so it follows them across devices); files upload as they're attached.
   The review lays the whole paper out with every answer under its question. */
export const STEP_LOOK = {
  saved:  { bg: 'rgba(16,185,129,.14)', fg: '#047857', border: 'rgba(16,185,129,.45)', label: 'Answered' },
  edited: { bg: 'rgba(245,158,11,.14)', fg: '#B45309', border: 'rgba(245,158,11,.5)', label: 'Saving…' },
  empty:  { bg: 'var(--ak-surface)',    fg: 'var(--ak-text-muted)', border: 'var(--ak-border)', label: 'Not answered' },
};
