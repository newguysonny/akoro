/**
 * courses-store.js  —  In-memory store for the legacy courses mock
 *
 * Extracted from courses.js (Phase 19 step 4) without behaviour changes:
 * the same seed arrays, the same filter/slice semantics, the same
 * createdAt/updatedAt stamps. Swap these bodies for real DB calls here
 * without touching the router or its handlers.
 */

// ─── § STORE ──────────────────────────────────────────────────────────────────

let _courses = [
  {
    id: "1",
    title: "Further Mathematics & Calculus",
    emoji: "🧮",
    courseType: "live",
    subject: "Mathematics",
    level: "High School",
    language: "English",
    description: "Deep-dive into calculus, differentiation and integration for advanced students.",
    status: "live",
    platform: "zoom",
    price: 18000,
    pricing: "paid",
    salePrice: null,
    saleEnds: null,
    introSession: "paid",
    refundPolicy: "30",
    enrolment: "open",
    sessionLengthMin: 90,
    schedulePattern: "weekly",
    students: 847,
    modules: 4,
    lessons: 16,
    rating: 4.9,
    revenue: 152460,
    nextSession: "Today 2:00 PM",
    color: "#1a1f3a",
    thumb: "linear-gradient(135deg,#1a1f3a,#0d2137)",
    thumbnailUrl: null,
    promoVideoUrl: null,
    topics: [
      { id: "t1", topic: "Introduction & Foundations",  recurring: "weekly", dayOfWeek: "Mon", date: "", time: "", platform: "zoom", notes: "", materials: [] },
      { id: "t2", topic: "Differentiation: Chain Rule", recurring: "weekly", dayOfWeek: "Mon", date: "", time: "", platform: "zoom", notes: "", materials: [] },
    ],
    curriculum: [],
    createdAt: "2025-01-12T08:00:00.000Z",
    updatedAt: "2025-01-12T08:00:00.000Z",
  },
  {
    id: "2",
    title: "Organic Chemistry Mastery",
    emoji: "🔬",
    courseType: "live",
    subject: "Chemistry",
    level: "High School",
    language: "English",
    description: "Master organic chemistry reaction mechanisms and synthesis.",
    status: "live",
    platform: "meet",
    price: 18000,
    pricing: "paid",
    salePrice: null,
    saleEnds: null,
    introSession: "paid",
    refundPolicy: "30",
    enrolment: "open",
    sessionLengthMin: 90,
    schedulePattern: "weekly",
    students: 312,
    modules: 3,
    lessons: 12,
    rating: 4.8,
    revenue: 56160,
    nextSession: "Thu 10:00 AM",
    color: "#1a2a1a",
    thumb: "linear-gradient(135deg,#1a2a1a,#0d2a10)",
    thumbnailUrl: null,
    promoVideoUrl: null,
    topics: [],
    curriculum: [],
    createdAt: "2025-01-14T08:00:00.000Z",
    updatedAt: "2025-01-14T08:00:00.000Z",
  },
  {
    id: "3",
    title: "Calculus Self-Paced Mastery",
    emoji: "🧮",
    courseType: "ondemand",
    subject: "Mathematics",
    level: "High School",
    language: "English",
    description: "Complete calculus course — learn at your own pace with 42 video lectures.",
    status: "live",
    platform: "—",
    price: 7500,
    pricing: "paid",
    salePrice: null,
    saleEnds: null,
    introSession: "free",
    refundPolicy: "30",
    enrolment: "open",
    sessionLengthMin: null,
    schedulePattern: null,
    students: 1240,
    modules: 6,
    lessons: 42,
    rating: 4.9,
    revenue: 248000,
    nextSession: "Self-paced",
    color: "#2a0a1a",
    thumb: "linear-gradient(135deg,#2a0a1a,#1f0512)",
    thumbnailUrl: null,
    promoVideoUrl: null,
    topics: [],
    curriculum: [
      {
        id: "m1",
        title: "Module 1: Foundations",
        lectures: [
          { id: "l1", title: "Welcome & course overview", type: "video", duration: "4:32",  free: true  },
          { id: "l2", title: "What is calculus?",         type: "video", duration: "12:18", free: true  },
          { id: "l3", title: "Prerequisites check",       type: "quiz",  duration: "5 min", free: false },
        ],
      },
    ],
    createdAt: "2025-01-20T08:00:00.000Z",
    updatedAt: "2025-01-20T08:00:00.000Z",
  },
];

let _sessions = [
  { id: "s1", courseId: "1", title: "Chain Rule & Product Rule", date: "Today",      time: "2:00 PM",  platform: "zoom", enrolled: 54, status: "live",     description: "" },
  { id: "s2", courseId: "1", title: "Integration by Parts",      date: "Thu 19 Jun", time: "2:00 PM",  platform: "zoom", enrolled: 54, status: "upcoming", description: "" },
  { id: "s3", courseId: "2", title: "Reaction Mechanisms",       date: "Thu 19 Jun", time: "10:00 AM", platform: "meet", enrolled: 38, status: "upcoming", description: "" },
];

const now = () => new Date().toISOString();

const CourseStore = {
  list: ({ courseType, status, subject, search } = {}) => {
    let r = [..._courses];
    if (courseType) r = r.filter((c) => c.courseType === courseType);
    if (status)     r = r.filter((c) => c.status     === status);
    if (subject)    r = r.filter((c) => c.subject    === subject);
    if (search) {
      const q = search.toLowerCase();
      r = r.filter((c) => c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
    }
    return r;
  },
  get:    (id)       => _courses.find((c) => c.id === id) ?? null,
  create: (data)     => { const c = { ...data, students: 0, revenue: 0, rating: 0, createdAt: now(), updatedAt: now() }; _courses.push(c); return c; },
  update: (id, data) => { const i = _courses.findIndex((c) => c.id === id); if (i === -1) return null; _courses[i] = { ..._courses[i], ...data, id, updatedAt: now() }; return _courses[i]; },
  delete: (id)       => { const i = _courses.findIndex((c) => c.id === id); if (i === -1) return false; _courses.splice(i, 1); return true; },
};

const SessionStore = {
  list:          ({ status, courseId } = {}) => { let r = [..._sessions]; if (status) r = r.filter((s) => s.status === status); if (courseId) r = r.filter((s) => s.courseId === courseId); return r; },
  listByCourse:  (courseId) => _sessions.filter((s) => s.courseId === courseId),
  get:           (id)       => _sessions.find((s) => s.id === id) ?? null,
  create:        (data)     => { _sessions.push(data); return data; },
  update:        (id, data) => { const i = _sessions.findIndex((s) => s.id === id); if (i === -1) return null; _sessions[i] = { ..._sessions[i], ...data, id }; return _sessions[i]; },
  delete:        (id)       => { const i = _sessions.findIndex((s) => s.id === id); if (i === -1) return false; _sessions.splice(i, 1); return true; },
};

export { CourseStore, SessionStore, now };
