/**
 * onboardingChat.js — the instructor onboarding as a scripted conversation (no AI call).
 *
 * Pure data and rules, no React. Ako asks, the instructor answers through the chat composer (typing,
 * a chip, or a pick in an in-chat card) and the send arrow commits. Saved by the same two requests the
 * old form used: PATCH /api/profiles/me, then POST /api/profiles/me/school-request.
 *
 * Required (the conversation will not move on without them): name, a school — unless none exist yet to
 * choose from — and at least one subject. Optional (with a skip): the teaching guide's name. The guide's
 * face always has a default.
 */

export const STEP_IDS = ['name', 'school', 'subjects', 'guide', 'done'];
export const STEP_COUNT = STEP_IDS.length;

/* The list this form always had, plus the junior-secondary cores a Nigerian teacher needs (the learner
   app offers them): nothing that was offered before is gone. */
export const SUBJECT_OPTIONS = [
  'Mathematics', 'Further Mathematics', 'Physics', 'Chemistry', 'Biology',
  'Computer Science', 'English Language', 'English Literature', 'Economics', 'Geography', 'History',
  'Basic Science', 'Basic Technology', 'Social Studies', 'Civic Education', 'Agricultural Science',
  'Computer Studies', 'Business Studies', 'Home Economics', 'Cultural and Creative Arts', 'Government',
  'Literature in English', 'Christian Religious Studies', 'Islamic Religious Studies', 'French', 'Yoruba', 'Igbo', 'Hausa',
];

/* The guide's avatar choices: [stored emoji key, Tabler icon] — the emoji is what the profile keeps (cross-app). */
export const GUIDE_ICONS = [['🧠', 'ti-brain'], ['👩‍🏫', 'ti-presentation'], ['👨‍🏫', 'ti-users'], ['🎓', 'ti-school'], ['📚', 'ti-book'], ['💡', 'ti-bulb'], ['🦉', 'ti-feather'], ['⚡', 'ti-bolt'], ['🌟', 'ti-sparkles'], ['🔮', 'ti-wand'], ['🚀', 'ti-rocket'], ['🎯', 'ti-target']];

export const emptyAnswers = (name = '') => ({ name, schoolId: '', schoolName: '', subjects: [], guideName: '', guideEmoji: '🧠' });

/** What Ako calls the instructor: "Amara" for Amara Osei, but "Dr. Osei" for Dr. Amara Osei (a title is not a first name). */
export function callName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'there';
  if (/^(dr|prof|professor|mr|mrs|ms|mx|engr|rev|pastor|imam|alhaji|chief)\.?$/i.test(parts[0]) && parts.length > 1) return `${parts[0]} ${parts[parts.length - 1]}`;
  return parts[0];
}
export const firstName = callName;
export const initials = (name) => String(name || '?').replace(/^(Mrs?\.?|Ms\.?|Dr\.?|Prof\.?)\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

export function subjectsLabel(subjects = []) {
  if (!subjects.length) return '';
  const head = subjects.slice(0, 3).join(', ');
  return subjects.length > 3 ? `${head} +${subjects.length - 3} more` : head;
}
export const subjectsDraft = (subjects = []) => (subjects.length ? `${subjects.length} subject${subjects.length === 1 ? '' : 's'} picked` : '');

/** The instructor's reply bubble for a step. */
export function answerText(stepId, a) {
  switch (stepId) {
    case 'name':     return a.name.trim();
    case 'school':   return a.schoolName;
    case 'subjects': return subjectsLabel(a.subjects);
    case 'guide':    return a.guideName.trim() || "I'll name it later";
    default:         return '';
  }
}

/**
 * → what is missing, or null when the step can be sent. `schoolsAvailable`: whether the directory has any
 * school to choose from (a school is required only then).
 */
export function stepError(stepId, a, { schoolsAvailable = true } = {}) {
  if (stepId === 'name' && !a.name.trim()) return 'Please enter your name';
  if (stepId === 'school' && schoolsAvailable && !a.schoolId) return 'Please choose your school';
  if (stepId === 'subjects' && a.subjects.length === 0) return 'Pick at least one subject you teach';
  return null;
}

/** Every required answer still missing, as [stepId, message] pairs — checked once more before saving. */
export function missingRequired(a, opts) {
  return ['name', 'school', 'subjects'].map((id) => [id, stepError(id, a, opts)]).filter(([, msg]) => msg);
}

export function progressOf(index) {
  const i = Math.max(0, Math.min(STEP_COUNT - 1, index));
  return { pct: Math.round(((i + 1) / STEP_COUNT) * 100), done: i === STEP_COUNT - 1, number: i + 1 };
}

/** Body of PATCH /api/profiles/me — unchanged from the form it replaces. */
export function profilePayload(a) {
  return {
    fullName: a.name.trim(),
    schoolName: a.schoolName || undefined,
    subjects: a.subjects,
    teachingGuide: a.guideName.trim() || undefined,
    guideEmoji: a.guideEmoji,
    onboardingCompleted: true,
  };
}

/** Active schools on Akoro matching what was typed: name and address, every word. Empty until they type. */
export function filterSchools(schools, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/);
  return schools.filter((sc) => {
    const hay = [sc.name, sc.address].filter(Boolean).join(' ').toLowerCase();
    return tokens.every((tok) => hay.includes(tok));
  });
}
