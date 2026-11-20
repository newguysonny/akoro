/**
 * course-content-outline.js  —  read-only course outline + progress views
 *
 * Extracted from course-content.js (Phase 19 step 4). Both handlers read the
 * same tables and build the same response bodies as before; the mounted
 * router in course-content.js imports them.
 */

import db from "../../db.js";
import { asyncHandler, res200, res404 } from "./course-content-rules.js";

// ─── § MODULE READS ───────────────────────────────────────────────────────────

/**
 * GET /api/courses/:courseId/content
 * Full course outline — all modules with their lessons nested.
 * Students see only preview lessons if not enrolled.
 */
const getCourseContent = asyncHandler(async (req, res) => {
  const { courseId } = req.params;

  // Check if enrolled (for non-instructors)
  let isEnrolled = ["instructor", "admin"].includes(req.user?.role);
  if (!isEnrolled && req.user) {
    const { data: enrollment } = await db
      .from("enrollments")
      .select("id")
      .eq("user_id", req.user.id)
      .eq("course_id", courseId)
      .eq("status", "active")
      .single();
    isEnrolled = !!enrollment;
  }

  const { data: modules, error } = await db
    .from("course_modules")
    .select(`
      id, title, description, order_index,
      lessons (
        id, title, description, lesson_type,
        duration_seconds, order_index, is_preview,
        video_url, thumbnail_url
      )
    `)
    .eq("course_id", courseId)
    .order("order_index", { ascending: true });

  if (error) throw new Error(error.message);

  // For unenrolled students: mask non-preview lesson details
  const outline = (modules ?? []).map((mod) => ({
    ...mod,
    lessons: (mod.lessons ?? [])
      .sort((a, b) => a.order_index - b.order_index)
      .map((lesson) => {
        if (!isEnrolled && !lesson.is_preview) {
          return {
            id:              lesson.id,
            title:           lesson.title,
            lesson_type:     lesson.lesson_type,
            duration_seconds: lesson.duration_seconds,
            order_index:     lesson.order_index,
            is_preview:      false,
            locked:          true,
          };
        }
        return { ...lesson, locked: false };
      }),
  }));

  // If enrolled, attach lesson progress
  if (isEnrolled && req.user) {
    const { data: progress } = await db
      .from("lesson_progress")
      .select("lesson_id, completed, last_position_seconds, quiz_score")
      .eq("user_id", req.user.id);

    const progressMap = Object.fromEntries((progress ?? []).map((p) => [p.lesson_id, p]));

    for (const mod of outline) {
      for (const lesson of mod.lessons) {
        lesson.progress = progressMap[lesson.id] ?? null;
      }
    }
  }

  res200(res, outline, { total_modules: outline.length });
});

// ─── § PROGRESS HANDLER ───────────────────────────────────────────────────────

const progressHandler = asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const userId       = req.user.id;

  const { data: enrollment } = await db
    .from("enrollments")
    .select("progress, enrolled_at")
    .eq("user_id", userId)
    .eq("course_id", courseId)
    .eq("status", "active")
    .single();

  if (!enrollment) return res404(res, "Not enrolled in this course");

  // Per-module completion counts
  const { data: modules } = await db
    .from("course_modules")
    .select(`
      id, title, order_index,
      lessons ( id )
    `)
    .eq("course_id", courseId)
    .order("order_index", { ascending: true });

  const lessonIds = (modules ?? []).flatMap((m) => (m.lessons ?? []).map((l) => l.id));

  const { data: progress } = await db
    .from("lesson_progress")
    .select("lesson_id, completed, quiz_score, last_position_seconds")
    .eq("user_id", userId)
    .in("lesson_id", lessonIds);

  const progressMap = Object.fromEntries((progress ?? []).map((p) => [p.lesson_id, p]));

  const moduleProgress = (modules ?? []).map((mod) => {
    const total    = mod.lessons?.length ?? 0;
    const done     = (mod.lessons ?? []).filter((l) => progressMap[l.id]?.completed).length;
    return {
      module_id:   mod.id,
      title:       mod.title,
      order_index: mod.order_index,
      total,
      completed:   done,
      percent:     total > 0 ? Math.round((done / total) * 100) : 0,
    };
  });

  res200(res, {
    overall_progress: enrollment.progress,
    enrolled_at:      enrollment.enrolled_at,
    modules:          moduleProgress,
  });
});

export { getCourseContent, progressHandler };
