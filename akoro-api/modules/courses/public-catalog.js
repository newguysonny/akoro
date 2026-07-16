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

    let q = db
      .from("courses")
      .select("id, slug, title, description, subject, level, is_free, price, currency, total_students, rating, total_hours, course_type, course_modules(title, order_index)")
      .eq("is_published", true);
    // Optional ?type=live|video filter for the discovery categories.
    if (req.query.type === "live" || req.query.type === "video") q = q.eq("course_type", req.query.type);
    const { data, error } = await q
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
        slug:     c.slug,
        type:     c.course_type,
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
// GET /courses/:id/full
// Unified single-course detail for the course details page. One endpoint;
// the frontend renders live vs video off the `type` field.
// =============================================================
router.get("/courses/:idOrSlug/full", async (req, res) => {
  try {
    const { idOrSlug } = req.params;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const { data: c, error } = await db
      .from("courses")
      .select("id, slug, title, description, subject, level, is_free, price, currency, total_students, rating, total_hours, course_type, instructor:users!instructor_id(id, full_name, avatar_url), course_modules(id, title, order_index, lessons(id, title, lesson_type, duration_seconds, order_index, is_preview))")
      .eq(isUuid ? "id" : "slug", idOrSlug)
      .single();

    if (error || !c) return res.status(404).json({ error: "Course not found" });
    const id = c.id;   // real course id for the sub-queries below

    const m = meta(c.subject);
    const fmtDur = (secs) => (secs ? `${Math.round(secs / 60)}min` : "—");
    const modules = (c.course_modules || [])
      .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
      .map((mod) => ({
        title: mod.title,
        lessons: (mod.lessons || [])
          .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
          .map((l) => ({
            id:        l.id,
            title:     l.title,
            type:      l.lesson_type === "quiz" ? "quiz" : "video",
            duration:  l.lesson_type === "quiz" ? "—" : fmtDur(l.duration_seconds),
            isPreview: !!l.is_preview,
            done:      false,
          })),
      }));

    // Schedule + Peer revisions — both come from live_sessions for this course
    let schedule = [];
    let revisions = [];
    let platform = null;   // streaming platform of the live / next session
    try {
      const { data: sessions } = await db
        .from("live_sessions")
        .select("title, topic, status, platform, scheduled_start, scheduled_end, current_participants, max_participants, host:users!instructor_id(full_name, avatar_url)")
        .eq("course_id", id)
        .order("scheduled_start", { ascending: true });
      schedule = (sessions || []).map((s) => {
        const { date, time } = formatSchedule(s.scheduled_start, s.scheduled_end);
        return {
          topic:  s.topic || s.title,
          date, time,
          status: s.status === "live" ? "live" : s.status === "ended" || s.status === "recorded" ? "recorded" : "upcoming",
        };
      });
      // Revisions = currently live / upcoming community sessions
      revisions = (sessions || [])
        .filter((s) => s.status === "live" || s.status === "scheduled" || s.status === "starting")
        .slice(0, 8)
        .map((s) => {
          const { date, time } = formatSchedule(s.scheduled_start, s.scheduled_end);
          return {
            topic:  s.topic || s.title,
            host:   s.host?.full_name || "Host",
            time:   s.status === "live" ? "Live now" : `${date}${time ? ` · ${time}` : ""}`,
            joined: s.current_participants || 0,
            max:    s.max_participants || 20,
            status: s.status === "live" ? "live" : "upcoming",
          };
        });
      // Platform from the live session if any, else the soonest scheduled one.
      const liveS = (sessions || []).find((s) => s.status === "live");
      const nextS = (sessions || []).find((s) => s.status === "scheduled" || s.status === "starting");
      platform = (liveS || nextS)?.platform || null;
    } catch { /* ignore */ }

    // Battles + leaderboard — real battles for this course
    let battles = [];
    let leaderboard = [];
    try {
      const { data: bts } = await db
        .from("battles")
        .select("id, title, topic, subject, status, peak_viewers, created_at, battle_participants(score, role, user_agents(agent_name, agent_emoji, agent_color))")
        .eq("course_id", id)
        .order("created_at", { ascending: false })
        .limit(12);

      battles = (bts || []).map((b) => {
        const parts = (b.battle_participants || []);
        const A = parts[0] || {}, B = parts[1] || {};
        const agA = A.user_agents || {}, agB = B.user_agents || {};
        return {
          id:     b.id,
          topic:  b.title || b.topic || "Battle",
          status: b.status === "active" || b.status === "live" ? "live" : b.status === "scheduled" ? "upcoming" : "completed",
          viewers: b.peak_viewers || 0,
          a: { name: agA.agent_name || "Agent A", emoji: agA.agent_emoji || "🤖", color: agA.agent_color || "#6C3BFF", score: A.score || 0 },
          b: { name: agB.agent_name || "Agent B", emoji: agB.agent_emoji || "⚡", color: agB.agent_color || "#2563EB", score: B.score || 0 },
        };
      });

      // Leaderboard — aggregate scores per agent across the course's battles
      const agg = {};
      (bts || []).forEach((b) => (b.battle_participants || []).forEach((p) => {
        const name = p.user_agents?.agent_name;
        if (!name) return;
        if (!agg[name]) agg[name] = { name, emoji: p.user_agents.agent_emoji || "🤖", color: p.user_agents.agent_color || "#6C3BFF", pts: 0 };
        agg[name].pts += p.score || 0;
      }));
      leaderboard = Object.values(agg).sort((x, y) => y.pts - x.pts).slice(0, 6);
    } catch { /* ignore */ }

    // Reviews — public list
    let reviews = [];
    try {
      const { data: rv } = await db
        .from("reviews")
        .select("rating, comment, created_at, users!reviews_user_id_fkey(full_name, avatar_url)")
        .eq("course_id", id)
        .order("helpful_count", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(12);
      reviews = (rv || []).map((r) => ({
        name:   r.users?.full_name || "Student",
        rating: r.rating,
        text:   r.comment || "",
        date:   r.created_at ? new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "",
      }));
    } catch { /* ignore */ }

    // Teachers — the course instructor
    const teachers = c.instructor ? [{
      name:      c.instructor.full_name || "Instructor",
      avatarUrl: c.instructor.avatar_url || null,
      title:     "Lead Instructor",
    }] : [];

    res.json({
      success: true,
      course: {
        id:              c.id,
        slug:            c.slug,
        title:           c.title,
        description:     c.description,
        subject:         c.subject,
        platform,
        type:            c.course_type === "video" ? "video" : "live",
        level:           titleCase(c.level),
        rating:          c.rating ? Number(Number(c.rating).toFixed(1)) : null,
        rating_count:    compact(c.total_students),
        total_students:  c.total_students || 0,
        total_hours:     c.total_hours || 0,
        instructor_name: c.instructor?.full_name || null,
        is_free:         c.is_free,
        price:           c.is_free ? 0 : Math.round((c.price || 0) / 100),
        emoji:           m.emoji,
        enrolled:        false,
        modules,
        schedule,
        reviews,
        teachers,
        battles,
        leaderboard,
        revisions,
      },
    });
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
