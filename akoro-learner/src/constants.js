// ─── Design tokens ─────────────────────────────────────────────
export const BRAND = "#6C3BFF";
export const RED   = "#EF4444";
export const GREEN = "#10B981";
export const GOLD  = "#F59E0B";

export const SUBJECTS = {
  all:     { label:"All Topics", color:BRAND,     icon:"📚" },
  maths:   { label:"Maths",      color:"#6C3BFF", icon:"🔢" },
  english: { label:"English",    color:"#0EA5E9", icon:"📖" },
  science: { label:"Science",    color:"#10B981", icon:"🔬" },
};

export const SUBJECT_COLORS = { maths:"#6C3BFF", english:"#0EA5E9", science:"#10B981" };

export const PRIORITY_CONFIG = {
  live:     { label:"LIVE",      bg:"rgba(239,68,68,0.12)",  color:"#EF4444", dot:"#EF4444", pulse:true  },
  upcoming: { label:"UPCOMING",  bg:"rgba(245,158,11,0.12)", color:"#F59E0B", dot:"#F59E0B", pulse:false },
  normal:   { label:"SCHEDULED", bg:"rgba(16,185,129,0.10)", color:"#10B981", dot:"#10B981", pulse:false },
};

export const DIFFICULTY_CONFIG = {
  hard:   { label:"Hard",   color:"#EF4444", bg:"rgba(239,68,68,0.10)"  },
  medium: { label:"Medium", color:"#F59E0B", bg:"rgba(245,158,11,0.10)" },
  easy:   { label:"Easy",   color:"#10B981", bg:"rgba(16,185,129,0.10)" },
};

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
