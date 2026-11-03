/**
 * progress.js  —  Piabam Progress & Analytics router
 *
 * Handles:
 *   - Student progress dashboard overview
 *   - Per-course progress breakdown by module
 *   - Activity timeline (lessons watched, sessions attended)
 *   - Instructor course engagement analytics
 *   - Instructor session attendance analytics
 *   - Progress export (CSV)
 *
 * Usage in app.js:
 *   import progressRouter from "./routes/progress.js";
 *   app.use("/api", progressRouter);
 */

import { Router }                         from "express";
import db                                 from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { requireCourseManager }          from "./courseAccess.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true, data, ...meta });
const res404 = (res, msg)             => res.status(404).json({ success: false, message: msg });

// ─── Student Handlers ─────────────────────────────────────────────────────────

const studentHandlers = {

  /**
   * GET /api/user/progress/overview
   * Dashboard summary: enrolled courses, overall completion, XP, sessions.
   */
  overview: asyncHandler(async (req, res) => {
    const userId = req.user.id;

    // Enrolled courses with progress
    const { data: enrollments } = await db
      .from("enrollments")
      .select(`
        id, progress, enrolled_at,
        courses (
          id, title, cover_image_url, course_type,
          users!courses_instructor_id_fkey ( full_name )
        )
      `)
      .eq("user_id", userId)
      .eq("status", "active")
      .order("enrolled_at", { ascending: false });

    const totalCourses    = enrollments?.length ?? 0;
    const completedCourses = enrollments?.filter((e) => e.progress >= 100).length ?? 0;
    const avgProgress     = totalCourses
      ? Math.round((enrollments ?? []).reduce((s, e) => s + e.progress, 0) / totalCourses)
      : 0;

    // Total lessons completed
    const { count: lessonsCompleted } = await db
      .from("lesson_progress")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("completed", true);

    // Sessions attended
    const { count: sessionsAttended } = await db
      .from("session_participants")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("attended", true);

    // Agent XP
    const { data: agent } = await db
      .from("user_agents")
      .select("total_xp, agent_name, agent_emoji")
      .eq("user_id", userId)
      .single();

    res200(res, {
      stats: {
        total_courses:     totalCourses,
        completed_courses: completedCourses,
        avg_progress:      avgProgress,
        lessons_completed: lessonsCompleted ?? 0,
        sessions_attended: sessionsAttended ?? 0,
        agent_xp:          agent?.total_xp ?? 0,
      },
      agent:       agent ?? null,
      enrollments: enrollments ?? [],
    });
  }),

  /**
   * GET /api/user/progress/course/:courseId
   * Per-course progress: modules breakdown, quiz scores, session attendance.
   */
  course: asyncHandler(async (req, res) => {
    const { courseId } = req.params;
    const userId       = req.user.id;

    const { data: enrollment } = await db
      .from("enrollments")
      .select("progress, enrolled_at")
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .single();

    if (!enrollment) return res404(res, "Not enrolled in this course");

    // Modules + lessons
    const { data: modules } = await db
      .from("course_modules")
      .select(`
        id, title, order_index,
        lessons ( id, title, lesson_type, duration_seconds )
      `)
      .eq("course_id", courseId)
      .order("order_index", { ascending: true });

    const allLessonIds = (modules ?? []).flatMap((m) => (m.lessons ?? []).map((l) => l.id));

    // Lesson progress records for this user
    const { data: progressRows } = await db
      .from("lesson_progress")
      .select("lesson_id, completed, last_position_seconds, quiz_score, completed_at")
      .eq("user_id", userId)
      .in("lesson_id", allLessonIds);

    const progressMap = Object.fromEntries((progressRows ?? []).map((p) => [p.lesson_id, p]));

    const moduleBreakdown = (modules ?? []).map((mod) => {
      const lessons = (mod.lessons ?? []).map((l) => ({
        ...l,
        progress: progressMap[l.id] ?? null,
      }));
      const total = lessons.length;
      const done  = lessons.filter((l) => l.progress?.completed).length;

      return {
        module_id:   mod.id,
        title:       mod.title,
        order_index: mod.order_index,
        total_lessons: total,
        completed:     done,
        percent:       total > 0 ? Math.round((done / total) * 100) : 0,
        lessons,
      };
    });

    // Sessions attended for this course
    const { data: sessions } = await db
      .from("session_participants")
      .select(`
        attended, duration_minutes, feedback_rating,
        live_sessions ( id, title, scheduled_start, status )
      `)
      .eq("user_id", userId)
      .eq("live_sessions.course_id", courseId)
      .order("live_sessions.scheduled_start", { ascending: false });

    res200(res, {
      overall_progress: enrollment.progress,
      enrolled_at:      enrollment.enrolled_at,
      modules:          moduleBreakdown,
      sessions_attended: (sessions ?? []).filter((s) => s.attended).length,
      sessions:          sessions ?? [],
    });
  }),

  /**
   * GET /api/user/activity
   * Activity timeline — last 30 days of lessons watched + sessions attended.
   */
  activity: asyncHandler(async (req, res) => {
    const userId    = req.user.id;
    const thirtyAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: lessonActivity } = await db
      .from("lesson_progress")
      .select(`
        updated_at, completed,
        lessons ( id, title, lesson_type,
          course_modules ( course_id, courses ( title ) ) )
      `)
      .eq("user_id", userId)
      .gte("updated_at", thirtyAgo)
      .order("updated_at", { ascending: false })
      .limit(50);

    const { data: sessionActivity } = await db
      .from("session_participants")
      .select(`
        joined_at, duration_minutes, attended,
        live_sessions ( id, title, scheduled_start,
          courses ( id, title ) )
      `)
      .eq("user_id", userId)
      .gte("joined_at", thirtyAgo)
      .order("joined_at", { ascending: false })
      .limit(20);

    // Merge and sort by date desc
    const timeline = [
      ...(lessonActivity ?? []).map((l) => ({
        type:        "lesson",
        title:       l.lessons?.title ?? "Lesson",
        course:      l.lessons?.course_modules?.courses?.title ?? "",
        completed:   l.completed,
        date:        l.updated_at,
      })),
      ...(sessionActivity ?? []).map((s) => ({
        type:          "session",
        title:         s.live_sessions?.title ?? "Session",
        course:        s.live_sessions?.courses?.title ?? "",
        attended:      s.attended,
        duration_min:  s.duration_minutes,
        date:          s.joined_at,
      })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    res200(res, timeline, { total: timeline.length });
  }),

  /**
   * POST /api/user/progress/export
   * Returns a CSV string of the student's full progress across all courses.
   */
  export: asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const { data: enrollments } = await db
      .from("enrollments")
      .select(`
        progress, enrolled_at,
        courses ( title )
      `)
      .eq("user_id", userId)
      .eq("status", "active");

    const { data: lessonProgress } = await db
      .from("lesson_progress")
      .select(`
        completed, last_position_seconds, quiz_score, updated_at,
        lessons (
          title, lesson_type,
          course_modules ( title, courses ( title ) )
        )
      `)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    // Build CSV
    const rows = [
      ["Course", "Module", "Lesson", "Type", "Completed", "Quiz Score", "Last Position (s)", "Last Updated"],
      ...(lessonProgress ?? []).map((p) => [
        p.lessons?.course_modules?.courses?.title ?? "",
        p.lessons?.course_modules?.title ?? "",
        p.lessons?.title ?? "",
        p.lessons?.lesson_type ?? "",
        p.completed ? "Yes" : "No",
        p.quiz_score ?? "",
        p.last_position_seconds ?? 0,
        p.updated_at ?? "",
      ]),
    ];

    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="akoro_progress_${userId}.csv"`);
    res.status(200).send(csv);
  }),
};

// ─── Instructor Analytics Handlers ────────────────────────────────────────────

const instructorHandlers = {

  /**
   * GET /api/courses/:courseId/analytics/engagement
   * Lesson-level engagement: completion rates, average quiz scores, drop-off points.
   */
  engagement: asyncHandler(async (req, res) => {
    const { courseId } = req.params;

    const { data: modules } = await db
      .from("course_modules")
      .select(`
        id, title, order_index,
        lessons ( id, title, lesson_type, order_index )
      `)
      .eq("course_id", courseId)
      .order("order_index", { ascending: true });

    // Total enrolled students
    const { count: totalStudents } = await db
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("course_id", courseId)
      .eq("status", "active");

    const enriched = await Promise.all((modules ?? []).map(async (mod) => {
      const lessons = await Promise.all((mod.lessons ?? []).map(async (l) => {
        const { count: completedCount } = await db
          .from("lesson_progress")
          .select("id", { count: "exact", head: true })
          .eq("lesson_id", l.id)
          .eq("completed", true);

        const { data: scores } = await db
          .from("lesson_progress")
          .select("quiz_score")
          .eq("lesson_id", l.id)
          .not("quiz_score", "is", null);

        const avgScore = scores?.length
          ? Math.round(scores.reduce((s, r) => s + r.quiz_score, 0) / scores.length)
          : null;

        return {
          lesson_id:          l.id,
          title:              l.title,
          lesson_type:        l.lesson_type,
          order_index:        l.order_index,
          completion_count:   completedCount ?? 0,
          completion_rate:    totalStudents
            ? Math.round(((completedCount ?? 0) / totalStudents) * 100)
            : 0,
          avg_quiz_score:     avgScore,
        };
      }));

      return { module_id: mod.id, title: mod.title, order_index: mod.order_index, lessons };
    }));

    res200(res, {
      course_id:      courseId,
      total_students: totalStudents ?? 0,
      modules:        enriched,
    });
  }),

  /**
   * GET /api/courses/:courseId/analytics/sessions
   * Session attendance analytics across all live sessions for a course.
   */
  sessions: asyncHandler(async (req, res) => {
    const { courseId } = req.params;

    const { data: sessions } = await db
      .from("live_sessions")
      .select(`
        id, title, scheduled_start, status,
        session_analytics (
          total_registered, total_attended,
          attendance_rate, peak_concurrent, avg_rating
        )
      `)
      .eq("course_id", courseId)
      .in("status", ["ended", "recorded"])
      .order("scheduled_start", { ascending: false });

    const totals = (sessions ?? []).reduce((acc, s) => {
      const a = s.session_analytics;
      if (!a) return acc;
      acc.total_registered += a.total_registered ?? 0;
      acc.total_attended   += a.total_attended   ?? 0;
      acc.session_count    += 1;
      return acc;
    }, { total_registered: 0, total_attended: 0, session_count: 0 });

    const overallAttendanceRate = totals.total_registered
      ? Math.round((totals.total_attended / totals.total_registered) * 100 * 100) / 100
      : 0;

    res200(res, {
      course_id:               courseId,
      overall_attendance_rate: overallAttendanceRate,
      total_sessions:          totals.session_count,
      total_registered:        totals.total_registered,
      total_attended:          totals.total_attended,
      sessions:                sessions ?? [],
    });
  }),
};

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

// Student
router.get ("/user/progress/overview",                    authenticateToken, studentHandlers.overview);
router.get ("/user/progress/course/:courseId",            authenticateToken, studentHandlers.course);
router.get ("/user/activity",                             authenticateToken, studentHandlers.activity);
router.post("/user/progress/export",                      authenticateToken, studentHandlers.export);

// Instructor analytics — the course's own instructor (or an admin), not every instructor.
router.get ("/courses/:courseId/analytics/engagement",    authenticateToken, requireRole(["instructor", "admin"]), requireCourseManager(), instructorHandlers.engagement);
router.get ("/courses/:courseId/analytics/sessions",      authenticateToken, requireRole(["instructor", "admin"]), requireCourseManager(), instructorHandlers.sessions);

export default router;
