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

export const STUDENT_ID = "user-alex-01";

export const AGENT_STYLES = {
  nana:    { name:"NaNa Esumai", emoji:"🧠", bg:"#EEEDFE", color:"#3C3489", ring:"#AFA9EC" },
  sargeant:{ name:"Sargeant",    emoji:"⚡", bg:"#FFF0F0", color:"#7F1D1D", ring:"#FCA5A5" },
  student: { name:"Agent",       emoji:"🤖", bg:"#FEF0E6", color:"#92400E", ring:"#F59E0B" },
};
