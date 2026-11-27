// ─── Design tokens ─────────────────────────────────────────────
export const BRAND = "#6C3BFF";
export const RED   = "#EF4444";
export const GREEN = "#10B981";
export const GOLD  = "#F59E0B";

/* Subject icons are @tabler/icons-webfont names — render them with
   <Icon name={...}/>; they are not text glyphs. */
export const SUBJECTS = {
  all:     { label:"All Topics", color:BRAND,     icon:"ti-book" },
  maths:   { label:"Maths",      color:"#6C3BFF", icon:"ti-math-function" },
  english: { label:"English",    color:"#0EA5E9", icon:"ti-book-2" },
  science: { label:"Science",    color:"#10B981", icon:"ti-microscope" },
  session_tool: { label:"Session tool", color:"#6C3BFF", icon:"ti-tools" },
};

export const SUBJECT_COLORS = { maths:"#6C3BFF", english:"#0EA5E9", science:"#10B981", session_tool:"#6C3BFF" };

/**
 * SUBJECTS above is keyed by three demo slugs. Real battles carry the school's
 * own subject NAME — "Mathematics", "English Language", "Basic Science",
 * "Social Studies", or anything a course is called — so SUBJECTS[subject] was
 * undefined and the subject pill rendered as an empty rounded box.
 *
 * Match on words rather than exact keys, and fall back to the name itself with
 * a colour derived from it. The label is never blank: a subject we have no icon
 * for is still a subject the learner can read.
 */
const SUBJECT_MATCHERS = [
  [/math/i,                       { icon:"ti-math-function", color:"#6C3BFF" }],
  [/english|literat|language art/i,{ icon:"ti-book-2", color:"#0EA5E9" }],
  [/physics/i,                    { icon:"ti-atom", color:"#6366F1" }],
  [/chem/i,                       { icon:"ti-flask", color:"#14B8A6" }],
  [/bio/i,                        { icon:"ti-dna", color:"#22C55E" }],
  [/science/i,                    { icon:"ti-microscope", color:"#10B981" }],
  [/social|civic|government/i,    { icon:"ti-world", color:"#F59E0B" }],
  [/history/i,                    { icon:"ti-clock-history", color:"#B45309" }],
  [/geograph/i,                   { icon:"ti-map", color:"#0891B2" }],
  [/econom|commerce|account/i,    { icon:"ti-chart-bar", color:"#EA580C" }],
  [/comput|ict|technolog/i,       { icon:"ti-device-laptop", color:"#4F46E5" }],
  [/agric/i,                      { icon:"ti-plant", color:"#65A30D" }],
  [/health|physical/i,            { icon:"ti-run", color:"#DB2777" }],
  [/relig|christian|islamic/i,    { icon:"ti-star", color:"#7C3AED" }],
  [/art|music|creative/i,         { icon:"ti-palette", color:"#DB2777" }],
];

const FALLBACK_COLORS = ["#6C3BFF","#0EA5E9","#10B981","#F59E0B","#EC4899","#14B8A6"];

export function subjectStyle(subject) {
  const name = (subject ?? "").toString().trim();
  if (!name) return { label:"General", icon:"ti-book", color:"#6B7280" };

  const slug = SUBJECTS[name.toLowerCase()];
  if (slug) return { label:slug.label, icon:slug.icon, color:slug.color };

  for (const [re, cfg] of SUBJECT_MATCHERS) {
    if (re.test(name)) return { label:name, icon:cfg.icon, color:cfg.color };
  }
  // Stable per name, so the same subject is always the same colour.
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return { label:name, icon:"ti-book", color:FALLBACK_COLORS[h % FALLBACK_COLORS.length] };
}

export const PRIORITY_CONFIG = {
  live:     { label:"LIVE",      bg:"rgba(239,68,68,0.12)",  color:"#EF4444", dot:"#EF4444", pulse:true  },
  upcoming: { label:"UPCOMING",  bg:"rgba(245,158,11,0.12)", color:"#F59E0B", dot:"#F59E0B", pulse:false },
  normal:   { label:"SCHEDULED", bg:"rgba(16,185,129,0.10)", color:"#10B981", dot:"#10B981", pulse:false },
};

/**
 * The API's difficulty vocabulary is easy | intermediate | hard, and
 * 'intermediate' is the DEFAULT on every battle. This map was keyed 'medium',
 * so DIFFICULTY_CONFIG[difficulty] was undefined for almost every real battle
 * and `diff.bg` threw — a blank Challenges tab with a TypeError behind it.
 *
 * Both spellings are here because both reach the UI: 'intermediate' from the
 * battle engine, 'medium' from older seeded and locally-built cards.
 */
export const DIFFICULTY_CONFIG = {
  hard:         { label:"Hard",   color:"#EF4444", bg:"rgba(239,68,68,0.10)"  },
  intermediate: { label:"Medium", color:"#F59E0B", bg:"rgba(245,158,11,0.10)" },
  medium:       { label:"Medium", color:"#F59E0B", bg:"rgba(245,158,11,0.10)" },
  easy:         { label:"Easy",   color:"#10B981", bg:"rgba(16,185,129,0.10)" },
};

/**
 * Never returns undefined. A missing or unknown difficulty is a cosmetic
 * detail; it must not be able to take the whole tab down with it.
 */
export const difficultyStyle = (d) =>
  DIFFICULTY_CONFIG[d] ?? DIFFICULTY_CONFIG.intermediate;

// Resolve the active learner's id. The backend's `edu` tables type student_id
// as a UUID, so we must use the authenticated user's real id (cached in
// localStorage by AuthContext under `akoro_user`). The old hardcoded
// "user-alex-01" placeholder is only a last-resort dev fallback — it is NOT a
// valid UUID and will be rejected by Postgres once a real session starts.
export function getStudentId() {
  try {
    const u = JSON.parse(localStorage.getItem("akoro_user"));
    if (u?.id) return u.id;
  } catch { /* ignore */ }
  return "user-alex-01";
}

// Evaluated at import for the many call-sites that use it as a plain value.
// On a protected dashboard the user is already cached, so this resolves to the
// real UUID. Call getStudentId() directly if you need the freshest value.
export const STUDENT_ID = getStudentId();

export const AGENT_STYLES = {
  nana:    { name:"NaNa Esumai", emoji:"🧠", bg:"#EEEDFE", color:"#3C3489", ring:"#AFA9EC" },
  sargeant:{ name:"Sargeant",    emoji:"⚡", bg:"#FFF0F0", color:"#7F1D1D", ring:"#FCA5A5" },
  student: { name:"Agent",       emoji:"🤖", bg:"#FEF0E6", color:"#92400E", ring:"#F59E0B" },
};

// Neutral avatar for users with no uploaded picture. Inline SVG data URI:
// no network request and, crucially, no user id sent to a third party — this
// replaces the old `https://i.pravatar.cc/150?u=<user id>` fallback, which
// leaked a real person's id to an external image host on every render.
export const AVATAR_FALLBACK =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'>"
  + "<rect width='40' height='40' fill='%23E9E4F5'/>"
  + "<circle cx='20' cy='15.5' r='6.8' fill='%23B4A8D8'/>"
  + "<path d='M6 38c0-7.7 6.4-11.6 14-11.6S34 30.3 34 38z' fill='%23B4A8D8'/></svg>";
