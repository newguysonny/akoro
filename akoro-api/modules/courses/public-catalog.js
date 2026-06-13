// =============================================================
// modules/courses/public-catalog.js
// Public (no-auth) read endpoints that power the marketing
// landing page. They read the seeded Postgres tables via the
// Supabase client and shape the rows to match the landing
// page card props exactly.
//
//   GET /api/courses/published      — published courses (self-paced cards)
//   GET /api/live-sessions          — upcoming / live sessions
//   GET /api/instructors/featured   — active instructors
//
// All three are intentionally unauthenticated — they only
// expose public catalogue data, never private fields.
// =============================================================

import { Router } from "express";
import db from "../../db.js";

const router = Router();

// ── Presentation mapping ─────────────────────────────────────
// The DB stores subjects as free text; the landing page cards
// want a category key (for filter pills), an emoji and a 2-stop
// gradient. Map subject → presentation here so the front-end
// stays unchanged.
const SUBJECT_META = {
  "mathematics":         { cat: "stem",      emoji: "🧮", grad: ["#E8F0FF", "#D4E4FF"] },
  "further mathematics": { cat: "stem",      emoji: "📐", grad: ["#E8F0FF", "#D4E4FF"] },
  "physics":             { cat: "stem",      emoji: "⚛️", grad: ["#EEF2FF", "#E0E7FF"] },
  "chemistry":           { cat: "stem",      emoji: "🔬", grad: ["#E8FFE8", "#D4F0D4"] },
  "biology":             { cat: "stem",      emoji: "🧬", grad: ["#E8FFF4", "#D4F5E4"] },
  "computer science":    { cat: "stem",      emoji: "💻", grad: ["#E8EFFF", "#D0DCFF"] },
  "english language":    { cat: "languages", emoji: "🗣", grad: ["#F8E8FF", "#EDD4FF"] },
  "english literature":  { cat: "languages", emoji: "📚", grad: ["#F8E8FF", "#EDD4FF"] },
  "economics":           { cat: "business",  emoji: "💰", grad: ["#FFF8E8", "#FFE8C0"] },
  "finance":             { cat: "business",  emoji: "📈", grad: ["#FFF8E8", "#FFE8C0"] },
  "history":             { cat: "arts",      emoji: "📜", grad: ["#FFF3E8", "#FFE0C0"] },
};
const DEFAULT_META = { cat: "stem", emoji: "📘", grad: ["#F0ECE6", "#E5DFD6"] };

const meta = (subject) => SUBJECT_META[(subject || "").trim().toLowerCase()] || DEFAULT_META;

const PLATFORM_LABEL = { zoom: "Zoom", meet: "Google Meet", teams: "MS Teams" };

// "1.2k" style compact number
const compact = (n) => {
  const v = Number(n) || 0;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(v);
};

const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Price: course.price is stored in kobo (NGN smallest unit).
const formatPrice = (course) =>
  course.is_free || !course.price
    ? "Free"
    : `₦${Math.round(course.price / 100).toLocaleString("en-NG")}/mo`;

// Format scheduled_start → { date, time } the way the card expects.
function formatSchedule(start, end) {
  if (!start) return { date: "TBA", time: "" };
  const s = new Date(start);
  const now = new Date();
  const sameDay = s.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = s.toDateString() === tomorrow.toDateString();

  let date;
  if (sameDay)        date = "Today";
  else if (isTomorrow) date = "Tomorrow";
  else date = s.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  const t = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const time = end
    ? `${t(s)} – ${t(new Date(end))} WAT`
    : `${t(s)} WAT`;
  return { date, time };
}

// =============================================================
// GET /courses/published
// =============================================================
router.get("/courses/published", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 12, 50);

    const { data, error } = await db
      .from("courses")
      .select("id, title, description, subject, level, is_free, price, currency, total_students, rating, total_hours, course_type, course_modules(title, order_index)")
      .eq("is_published", true)
      .order("rating", { ascending: false })
      .order("total_students", { ascending: false })
      .limit(limit);

    if (error) throw error;

    const courses = (data || []).map((c) => {
      const m = meta(c.subject);
      const syllabus = (c.course_modules || [])
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
        .map((mod) => mod.title)
        .slice(0, 6);
      return {
        id:       c.id,
        cat:      m.cat,
        emoji:    m.emoji,
        grad:     m.grad,
        title:    c.title,
        subject:  c.subject,
        dur:      c.total_hours ? `${c.total_hours}h` : "Self-paced",
        rating:   c.rating ? Number(c.rating).toFixed(1) : "—",
        rev:      compact(c.total_students),
        level:    titleCase(c.level) || "All levels",
        price:    formatPrice(c),
        priceNum: c.is_free ? 0 : c.price || 0,
        syllabus: syllabus.length ? syllabus : ["Curriculum coming soon"],
      };
    });

    res.json({ success: true, courses, count: courses.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// GET /live-sessions
// Upcoming + currently-live sessions (not ended/cancelled).
// =============================================================
router.get("/live-sessions", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50);

    const { data, error } = await db
      .from("live_sessions")
      .select("id, title, description, topic, subject, status, platform, scheduled_start, scheduled_end, current_participants, course:courses(title), instructor:users!instructor_id(full_name, avatar_url)")
      .in("status", ["live", "scheduled", "recorded"])
      .order("scheduled_start", { ascending: true })
      .limit(limit);

    if (error) throw error;

    const sessions = (data || []).map((s) => {
      const { date, time } = formatSchedule(s.scheduled_start, s.scheduled_end);
      const m = meta(s.subject);
      return {
        id:           s.id,
        status:       s.status,
        platform:     PLATFORM_LABEL[s.platform] || "Zoom",
        subject:      s.subject || s.course?.title || "General",
        course:       s.title || s.course?.title || s.topic,
        teacher:      s.instructor?.full_name || "Instructor",
        teacherEmoji: m.emoji,
        date,
        time:         s.status === "recorded" ? `Recorded` : time,
        desc:         s.description || "",
        enrolled:     s.current_participants || 0,
        present:      s.status === "live" ? s.current_participants || 0 : null,
      };
    });

    res.json({ success: true, sessions, count: sessions.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// GET /instructors/featured
// Active instructors with rating/student stats aggregated from
// their published courses.
// =============================================================
const INSTRUCTOR_BG = ["#C8E8D4", "#D4C8E8", "#F0E4C8", "#C8D8E8", "#E8D4C8", "#D4E8E0"];

router.get("/instructors/featured", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 8, 50);

    const { data, error } = await db
      .from("users")
      .select("id, full_name, avatar_url, school_name, subjects, courses!instructor_id(rating, total_students, subject, is_published)")
      .eq("role", "instructor")
      .eq("is_active", true)
      .limit(limit);

    if (error) throw error;

    const instructors = (data || []).map((u, i) => {
      const pubCourses = (u.courses || []).filter((c) => c.is_published);
      const ratings = pubCourses.map((c) => Number(c.rating)).filter((r) => r > 0);
      const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;
      const totalStudents = pubCourses.reduce((sum, c) => sum + (c.total_students || 0), 0);
      const subjectList = (u.subjects && u.subjects.length)
        ? u.subjects
        : [...new Set(pubCourses.map((c) => c.subject).filter(Boolean))];
      const primary = subjectList[0] || "General";
      const m = meta(primary);
      return {
        id:      u.id,
        emoji:   m.emoji,
        bg:      INSTRUCTOR_BG[i % INSTRUCTOR_BG.length],
        name:    u.full_name || "Instructor",
        subject: subjectList.slice(0, 2).join(" & ") || "General",
        score:   avgRating ? avgRating.toFixed(1) : "—",
        rev:     compact(totalStudents),
        bio:     u.school_name
          ? `${primary} specialist at ${u.school_name}.`
          : `${primary} specialist.`,
      };
    })
    // Only surface instructors who actually have published courses.
    .filter((u) => u.score !== "—" || u.rev !== "0");

    res.json({ success: true, instructors, count: instructors.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
