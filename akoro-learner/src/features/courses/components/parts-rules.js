/**
 * Course details — pure constants and the API→view mapper.
 */

/* ── palette ──────────────────────────────────────────────── */

const INK = '#1A1A2E', MUTED = '#6B6B80', MUTED2 = '#9490A0', BORDER = '#EDE8E1';
const LIGHT = '#FAF8F5', BG = '#F7F5F2', GREEN = '#10B981', RED = '#EF4444', GOLD = '#F59E0B';
const FONT = "'Nunito', sans-serif";

const card = { background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 18, fontFamily: FONT };
const PLATFORMS = { zoom: ['#2D8CFF', 'Zoom'], meet: ['#34A853', 'Google Meet'], teams: ['#5B5EA6', 'MS Teams'], youtube: ['#FF0000', 'YouTube Live'] };

/* ── defaults (fallback when a course has no data yet) ─────── */
const DEFAULT_MODULES = [
  { title: 'Module 1: Foundations of Calculus', lessons: [
    { title: 'Introduction to limits', duration: '9min', done: false, type: 'video' },
    { title: 'Continuity & discontinuities', duration: '11min', done: false, type: 'video' },
    { title: 'The concept of a derivative', duration: '13min', done: false, type: 'video' },
    { title: 'Quiz: Limits', duration: '—', done: false, type: 'quiz' },
  ] },
  { title: 'Module 2: Differentiation Techniques', lessons: [
    { title: 'Chain Rule', duration: '14min', done: false, type: 'video' },
    { title: 'Product & Quotient Rule', duration: '16min', done: false, type: 'video' },
    { title: 'Implicit Differentiation', duration: '12min', done: false, type: 'video' },
    { title: 'Quiz: Differentiation', duration: '—', done: false, type: 'quiz' },
  ] },
];
const DEFAULT_COURSE = {
  title: 'Course', subject: 'General', level: 'All levels', rating: null, ratingCount: '',
  students: 0, hours: 0, instructor: 'Instructor', updated: '', priceLabel: 'Free',
  priceOld: null, emoji: 'ti-book', description: '', schedule: null, reviews: null, teachers: null,
};

/* People get initials discs — typography, not emoji. */
const initialsOf = (name = '') => (String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')) || '?';
const RV_BG = ['#D4EAD8', '#E4D4F0', '#C8D8E8', '#F0E4C8', '#F8E8FF', '#FFE8C0'];

/* ── map API → view shape ─────────────────────────────────── */
function mapCourse(api) {
  if (!api) return { course: DEFAULT_COURSE, modules: DEFAULT_MODULES, type: 'live', enrolled: false };
  const isFree = api.is_free || api.price === 0;
  const priceLabel = isFree ? 'Free' : `₦${Number(api.price || 0).toLocaleString('en-NG')}`;
  const modules = Array.isArray(api.modules) && api.modules.length
    ? api.modules.map((m) => ({ title: m.title, lessons: (m.lessons || []).map((l) => ({ id: l.id, title: l.title, duration: l.duration || '—', done: !!l.done, type: l.type || 'video', isPreview: !!l.isPreview })) }))
    : DEFAULT_MODULES;
  return {
    type: api.type === 'video' || api.course_type === 'video' ? 'video' : 'live',
    enrolled: !!api.enrolled,
    modules,
    course: {
      id: api.id || null, slug: api.slug || null, platform: api.platform || null,
      title: api.title || DEFAULT_COURSE.title, subject: api.subject || DEFAULT_COURSE.subject,
      level: api.level || DEFAULT_COURSE.level, rating: api.rating != null ? Number(api.rating) : null,
      ratingCount: api.rating_count || '', students: api.total_students || 0, hours: api.total_hours || 0,
      instructor: api.instructor_name || DEFAULT_COURSE.instructor, updated: api.updated || '',
      description: api.description || '', priceLabel, priceOld: null, emoji: api.emoji || DEFAULT_COURSE.emoji,
      price: Number(api.price || 0), is_free: isFree,   // raw kobo + flag for checkout
      schedule: Array.isArray(api.schedule) && api.schedule.length ? api.schedule : null,
      reviews: Array.isArray(api.reviews) && api.reviews.length ? api.reviews : null,
      teachers: Array.isArray(api.teachers) && api.teachers.length ? api.teachers : null,
      battles: Array.isArray(api.battles) && api.battles.length ? api.battles : null,
      leaderboard: Array.isArray(api.leaderboard) && api.leaderboard.length ? api.leaderboard : null,
      revisions: Array.isArray(api.revisions) && api.revisions.length ? api.revisions : null,
    },
  };
}

export { INK, MUTED, MUTED2, BORDER, LIGHT, BG, GREEN, RED, GOLD, FONT, card, PLATFORMS, DEFAULT_MODULES, DEFAULT_COURSE, initialsOf, RV_BG, mapCourse };
