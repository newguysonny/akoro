/**
 * onboardingChat.js — the learner onboarding as a scripted conversation (no AI call).
 *
 * Pure data and rules, no React: the page walks STEP_IDS, asks each question in Ako's voice,
 * and the learner answers through the chat composer (typing, tapping a quick-reply chip, or
 * picking from a card in the chat). Everything is saved by the same three requests the old
 * form used, so nothing downstream changes: PATCH /api/profiles/me, PUT /api/user/agent and
 * POST /api/profiles/me/teacher-request.
 *
 * Required (the conversation will not move on without them): agreeing to the terms, name, study
 * level, the agent's name, and a teacher — unless no teacher exists yet to choose from.
 * Optional (each has a skip): class, school, subjects. Language, theme and accent start on
 * sensible defaults and can be sent as they are.
 */

export const STEP_IDS = ['welcome', 'name', 'level', 'school', 'subjects', 'agent', 'teacher', 'prefs', 'done'];
export const STEP_COUNT = STEP_IDS.length;

export const STUDY_LEVELS = ['Primary', 'Junior Secondary', 'Senior Secondary', 'University', 'Adult learner'];
// Class/year options for the chosen study level; an adult learner has no class.
export const CLASSES_BY_LEVEL = {
  'Primary':          ['Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6'],
  'Junior Secondary': ['JSS 1', 'JSS 2', 'JSS 3'],
  'Senior Secondary': ['SSS 1', 'SSS 2', 'SSS 3'],
  'University':       ['100 Level', '200 Level', '300 Level', '400 Level', '500 Level', 'Postgraduate'],
  'Adult learner':    [],
};
export const classesFor = (level) => CLASSES_BY_LEVEL[level] || [];

/* The Nigerian curriculum first (NERDC schemes, NCEE papers, JSS/SSS classes): a JSS1 learner
   must be able to pick Basic Science and Social Studies, which their class actually teaches. */
export const SUBJECT_OPTIONS = [
  'Mathematics', 'English Language', 'Basic Science', 'Basic Technology',
  'Social Studies', 'Civic Education', 'Agricultural Science', 'Computer Studies',
  'Business Studies', 'Home Economics', 'Cultural and Creative Arts',
  'Physics', 'Chemistry', 'Biology', 'Further Mathematics', 'Economics',
  'Geography', 'History', 'Government', 'Literature in English',
  'Christian Religious Studies', 'Islamic Religious Studies',
  'French', 'Yoruba', 'Igbo', 'Hausa',
];

/* Stored keys into the drawn AgentAvatar set (AgentAvatar.jsx), never rendered as glyphs. */
export const GUIDE_EMOJIS = ['🧠', '🤖', '👾', '🦉', '🎓', '⚡', '🌟', '🔮', '🦋', '🎯', '🚀', '💡'];

export const emptyAnswers = () => ({
  agreed: false, name: '', level: '', cls: '', school: '', subjects: [],
  agentName: '', agentEmoji: '🤖', teacherId: '', teacherName: '',
});

/* What a senior (or older) learner is most likely to take, so they don't dig through "+ more" for Physics. */
const SENIOR_FIRST = ['Mathematics', 'English Language', 'Physics', 'Chemistry', 'Biology', 'Further Mathematics', 'Economics', 'Geography', 'Government', 'Literature in English'];
const isSenior = (level) => ['Senior Secondary', 'University', 'Adult learner'].includes(level);

/** Subjects the learner's school teaches come first, then the ones that fit their level, then the rest; nothing is dropped. */
export const subjectChoices = (prefillSubjects = [], level = '') =>
  [...new Set([...(prefillSubjects || []), ...(isSenior(level) ? SENIOR_FIRST : []), ...SUBJECT_OPTIONS])];

export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

/** "Mathematics, English Language +3 more" — the reply bubble for the subjects step. */
export function subjectsLabel(subjects = []) {
  if (!subjects.length) return "I'll pick subjects later";
  const head = subjects.slice(0, 3).join(', ');
  return subjects.length > 3 ? `${head} +${subjects.length - 3} more` : head;
}

/** The draft the composer shows while a card or chip selection is staged. */
export const subjectsDraft = (subjects = []) => (subjects.length ? `${subjects.length} subject${subjects.length === 1 ? '' : 's'} picked` : '');

/**
 * The learner's reply bubble for a step. `prefs` is { language, theme, accent } (labels).
 */
export function answerText(stepId, a, prefs = {}) {
  switch (stepId) {
    case 'welcome':  return 'I agree to the terms';
    case 'name':     return a.name.trim();
    case 'level':    return a.cls ? `${a.level} · ${a.cls}` : a.level;
    case 'school':   return a.school.trim() || 'I learn on my own';
    case 'subjects': return subjectsLabel(a.subjects);
    case 'agent':    return a.agentName.trim();
    case 'teacher':  return a.teacherName;
    case 'prefs':    return [prefs.language, prefs.theme, prefs.accent].filter(Boolean).join(' · ');
    default:         return '';
  }
}

/**
 * → an i18n key naming what is missing, or null when the step can be sent.
 * `teachersAvailable`: whether the directory has anyone to choose from (a teacher is required only then).
 */
export function stepError(stepId, a, { teachersAvailable = true } = {}) {
  if (stepId === 'welcome' && !a.agreed) return 'onboarding.chat_err_terms';
  if (stepId === 'name' && !a.name.trim()) return 'onboarding.err_name';
  if (stepId === 'level' && !a.level) return 'onboarding.err_level';
  if (stepId === 'agent' && !a.agentName.trim()) return 'onboarding.err_agent';
  if (stepId === 'teacher' && teachersAvailable && !a.teacherId) return 'onboarding.err_teacher';
  return null;
}

/** Every required answer still missing, as [stepId, i18n key] pairs — checked once more before saving. */
export function missingRequired(a, opts) {
  return ['welcome', 'name', 'level', 'agent', 'teacher'].map((id) => [id, stepError(id, a, opts)]).filter(([, key]) => key);
}

/** The progress bar's fill and label for the step being shown. */
export function progressOf(index) {
  const i = Math.max(0, Math.min(STEP_COUNT - 1, index));
  return { pct: Math.round(((i + 1) / STEP_COUNT) * 100), done: i === STEP_COUNT - 1, number: i + 1 };
}

/** Body of PATCH /api/profiles/me — unchanged from the form it replaces. */
export function profilePayload(a, { language, displayMode, accentColor }) {
  return {
    fullName: a.name.trim(),
    yearGroup: a.cls.trim() || undefined,
    studyLevel: a.level,
    schoolName: a.school.trim() || undefined,
    subjects: a.subjects,
    language,
    displayMode,
    accentColor,
    onboardingCompleted: true,
  };
}

/** Body of PUT /api/user/agent — unchanged. */
export function agentPayload(a, username = 'me') {
  return {
    agent_name: a.agentName.trim() || `Agent_${username}`,
    agent_emoji: a.agentEmoji,
    study_level: a.level || undefined,
    year_group: a.cls.trim() || undefined,
    subjects: a.subjects.length ? a.subjects : undefined,
  };
}

/** Answers a teacher already put on file for this learner (GET /api/profiles/onboarding-prefill). */
export function applyPrefill(a, p) {
  if (!p || !p.className) return a;
  const next = { ...a };
  next.level = a.level || p.studyLevel || '';
  next.cls = a.cls || p.yearGroup || '';
  next.school = a.school || p.schoolName || '';
  if (p.teacherId && !a.teacherId) { next.teacherId = p.teacherId; next.teacherName = p.teacherName || ''; }
  // Kept as-is, not filtered against the canonical list: a school that teaches something we
  // didn't think of must not have it silently dropped from its own learners' profiles.
  if (p.subjects?.length && !a.subjects.length) next.subjects = [...p.subjects];
  return next;
}

/** Free-text filter over the teacher directory: name, username, school, class and subjects. */
export function filterTeachers(teachers, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return teachers;
  const tokens = q.split(/\s+/);
  return teachers.filter((t) => {
    const hay = [t.full_name, t.username, t.school_name, t.class_name, ...(t.subjects || [])].filter(Boolean).join(' ').toLowerCase();
    return tokens.every((tok) => hay.includes(tok));
  });
}

/** Free-text filter over the active schools on Akoro: name and address, every word. */
export function filterSchools(schools, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/);
  return schools.filter((sc) => {
    const hay = [sc.name, sc.address].filter(Boolean).join(' ').toLowerCase();
    return tokens.every((tok) => hay.includes(tok));
  });
}

export const initials = (name) => String(name || '?').replace(/^(Mrs?\.?|Ms\.?|Dr\.?|Prof\.?)\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
