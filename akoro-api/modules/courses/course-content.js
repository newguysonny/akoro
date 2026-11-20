/**
 * course-content.js  —  Piabam Course Content router
 *
 * Runs on: Railway (API server)
 *
 * Handles:
 *   - Course outline (modules + lessons tree)
 *   - Module CRUD (instructor)
 *   - Lesson CRUD + video attachment (instructor)
 *   - Lesson progress auto-save (student watch position)
 *   - Lesson completion marking
 *   - Quiz answer submission → score + pass/fail
 *   - Overall course progress percentage
 *
 * Usage in app.js:
 *   import contentRouter from "./routes/course-content.js";
 *   app.use("/api", contentRouter);
 *
 * ─── Sections ────────────────────────────────────────────────────────────────
 *  § IMPORTS
 *  § HELPERS
 *  § ACCESS GUARD        checks enrollment before student content access
 *  § VALIDATION RULES
 *  § MODULE HANDLERS     CRUD for course_modules
 *  § LESSON HANDLERS     CRUD, progress save, complete, quiz submit
 *  § PROGRESS HANDLER    overall course progress
 *  § ROUTER
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── § IMPORTS ────────────────────────────────────────────────────────────────

import { Router }                         from "express";
import db                                 from "../../db.js";
import { autoTranscribeContent } from "../records/index.js";
import { authenticateToken, requireRole } from "../auth/index.js";
import { awardXP, XP }                     from "../ranking/index.js";
import { canManageCourse, canUseCourse, courseOfModule, courseOfLesson } from "./courseAccess.js";
import {
  asyncHandler, res200, res201, res204, res400, res403, res404,
  runValidation, now, rules,
} from "./course-content-rules.js";
import { getCourseContent, progressHandler } from "./course-content-outline.js";

// ─── § HELPERS ────────────────────────────────────────────────────────────────
// Response shorthands, the async wrapper, runValidation, `now` and the
// express-validator chains now live in course-content-rules.js.

// ─── § ACCESS GUARD ───────────────────────────────────────────────────────────

/**
 * requireEnrollment
 * Middleware that checks the student is enrolled in the course.
 * Instructors and admins bypass the check.
 * Attaches enrollment to req.enrollment.
 */
const requireEnrollment = asyncHandler(async (req, res, next) => {
  if (["instructor", "admin"].includes(req.user.role)) return next();

  const courseId = req.params.courseId ?? req.body.courseId;

  const { data: enrollment } = await db
    .from("enrollments")
    .select("id, status")
    .eq("user_id", req.user.id)
    .eq("course_id", courseId)
    .single();

  if (!enrollment || enrollment.status !== "active")
    return res403(res, "You must be enrolled in this course to access the content");

  req.enrollment = enrollment;
  next();
});

/**
 * The course's own instructor (or an admin) may change its modules and
 * lessons. The instructor role alone is not enough: every teacher has it
 * (Phase 15 item 6). Answers 404 for a missing row, 403 for someone else's.
 */
async function guardModuleWrite(req, res, moduleId) {
  const courseId = await courseOfModule(moduleId);
  if (!courseId) { res404(res, "Module not found"); return false; }
  if (!(await canManageCourse(req.user, courseId))) { res403(res, "You do not own this course"); return false; }
  return true;
}

async function guardLessonWrite(req, res, lessonId) {
  const courseId = await courseOfLesson(lessonId);
  if (!courseId) { res404(res, "Lesson not found"); return false; }
  if (!(await canManageCourse(req.user, courseId))) { res403(res, "You do not own this course"); return false; }
  return true;
}

/** A learner completes or answers a lesson only where they may open it: a preview, or a course they belong to. */
const mayOpenLesson = async (user, lesson) =>
  !!lesson.is_preview || canUseCourse(user, lesson.course_modules?.course_id);

/**
 * fireLessonTranscription — "always extract" for course videos. Whenever a
 * lesson's video_url lands (lesson created with it, or set/changed by an
 * update, or the encode worker completing a just-uploaded file), the video
 * transcribes itself in the background under the shared lesson:<id> key.
 * Claim-first via edu.content_jobs, so this, the encode hook and a learner
 * tapping the reader's offer all collapse into ONE transcription.
 */
const fireLessonTranscription = (lesson, userId) => {
  if (!lesson?.id || !lesson.video_url) return;
  void autoTranscribeContent({
    userId: userId ?? null,
    contentKey: `lesson:${lesson.id}`,
    name: lesson.title,
    mime: "video/mp4",
    fileUrl: lesson.video_url,
  });
};

// ─── § VALIDATION RULES ───────────────────────────────────────────────────────
// `rules` is imported from course-content-rules.js (unchanged chains).

// ─── § MODULE HANDLERS ────────────────────────────────────────────────────────

const moduleHandlers = {

  // Read-only outline — defined in course-content-outline.js.
  getCourseContent,

  /**
   * GET /api/courses/:courseId/modules
   * List modules (flat, no lessons).
   */
  list: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("course_modules")
      .select("id, title, description, order_index, created_at")
      .eq("course_id", req.params.courseId)
      .order("order_index", { ascending: true });

    if (error) throw new Error(error.message);
    res200(res, data ?? [], { total: data?.length ?? 0 });
  }),

  /**
   * POST /api/courses/:courseId/modules
   * Create a new module (instructor only).
   */
  create: asyncHandler(async (req, res) => {
    const { courseId }               = req.params;
    const { title, description, order_index } = req.body;

    // Verify instructor owns course
    const { data: course } = await db
      .from("courses")
      .select("instructor_id")
      .eq("id", courseId)
      .single();

    if (!course) return res404(res, "Course not found");
    if (course.instructor_id !== req.user.id && req.user.role !== "admin")
      return res403(res, "You do not own this course");

    const { data, error } = await db
      .from("course_modules")
      .insert({ course_id: courseId, title, description: description ?? null, order_index: order_index ?? 0 })
      .select()
      .single();

    if (error) throw new Error(error.message);
    res201(res, data);
  }),

  /**
   * PUT /api/modules/:moduleId
   */
  update: asyncHandler(async (req, res) => {
    const { moduleId } = req.params;
    const { title, description, order_index } = req.body;
    if (!(await guardModuleWrite(req, res, moduleId))) return;

    const { data, error } = await db
      .from("course_modules")
      .update({ title, description, order_index })
      .eq("id", moduleId)
      .select()
      .single();

    if (error || !data) return res404(res, "Module not found");
    res200(res, data);
  }),

  /**
   * DELETE /api/modules/:moduleId
   */
  delete: asyncHandler(async (req, res) => {
    if (!(await guardModuleWrite(req, res, req.params.moduleId))) return;
    const { error } = await db
      .from("course_modules")
      .delete()
      .eq("id", req.params.moduleId);

    if (error) throw new Error(error.message);
    res204(res);
  }),
};

// ─── § LESSON HANDLERS ────────────────────────────────────────────────────────

const lessonHandlers = {

  /**
   * GET /api/modules/:moduleId/lessons
   */
  list: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("lessons")
      .select("id, title, description, lesson_type, duration_seconds, order_index, is_preview, thumbnail_url")
      .eq("module_id", req.params.moduleId)
      .order("order_index", { ascending: true });

    if (error) throw new Error(error.message);
    res200(res, data ?? [], { total: data?.length ?? 0 });
  }),

  /**
   * GET /api/lessons/:lessonId
   * Full lesson details including video URL and quiz content_json.
   * Requires enrollment (or is_preview).
   */
  get: asyncHandler(async (req, res) => {
    const { data: lesson, error } = await db
      .from("lessons")
      .select(`
        id, title, description, lesson_type,
        video_url, thumbnail_url, duration_seconds,
        order_index, is_preview, content_json,
        course_modules ( course_id )
      `)
      .eq("id", req.params.lessonId)
      .single();

    if (error || !lesson) return res404(res, "Lesson not found");

    const courseId = lesson.course_modules?.course_id;

    // Non-preview lessons require enrollment
    if (!lesson.is_preview && !["instructor", "admin"].includes(req.user.role)) {
      const { data: enrollment } = await db
        .from("enrollments")
        .select("id")
        .eq("user_id", req.user.id)
        .eq("course_id", courseId)
        .eq("status", "active")
        .single();

      if (!enrollment) return res403(res, "Enrol in this course to access this lesson");
    }

    // Attach student progress if enrolled
    const { data: progress } = await db
      .from("lesson_progress")
      .select("completed, last_position_seconds, quiz_score, completed_at")
      .eq("user_id", req.user.id)
      .eq("lesson_id", lesson.id)
      .single();

    res200(res, { ...lesson, progress: progress ?? null });
  }),

  /**
   * POST /api/courses/:courseId/modules/:moduleId/lessons
   * Create lesson (instructor only).
   */
  create: asyncHandler(async (req, res) => {
    const { courseId, moduleId } = req.params;
    // The module must sit in the course named in the path, and the course must be the caller's.
    if ((await courseOfModule(moduleId)) !== courseId) return res404(res, "Module not found in this course");
    if (!(await canManageCourse(req.user, courseId))) return res403(res, "You do not own this course");
    const {
      title, description, lesson_type = "video",
      order_index = 0, is_preview = false,
      duration_seconds, content_json, video_url, thumbnail_url,
    } = req.body;

    const { data, error } = await db
      .from("lessons")
      .insert({
        module_id: moduleId, title, description: description ?? null,
        lesson_type, order_index, is_preview,
        duration_seconds: duration_seconds ?? null,
        content_json:     content_json ?? null,
        video_url:        video_url ?? null,
        thumbnail_url:    thumbnail_url ?? null,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    // "Always extract": a lesson that lands with a video transcribes itself
    // in the background — the transcript is ready before the first learner.
    fireLessonTranscription(data, req.user?.id);
    res201(res, data);
  }),

  /**
   * PUT /api/lessons/:lessonId
   */
  update: asyncHandler(async (req, res) => {
    const allowed = ["title", "description", "lesson_type", "order_index",
                     "is_preview", "duration_seconds", "content_json",
                     "video_url", "thumbnail_url"];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    if (!(await guardLessonWrite(req, res, req.params.lessonId))) return;

    const { data, error } = await db
      .from("lessons")
      .update(updates)
      .eq("id", req.params.lessonId)
      .select()
      .single();

    if (error || !data) return res404(res, "Lesson not found");
    if (updates.video_url !== undefined) fireLessonTranscription(data, req.user?.id);
    res200(res, data);
  }),

  /**
   * DELETE /api/lessons/:lessonId
   */
  delete: asyncHandler(async (req, res) => {
    if (!(await guardLessonWrite(req, res, req.params.lessonId))) return;
    const { error } = await db.from("lessons").delete().eq("id", req.params.lessonId);
    if (error) throw new Error(error.message);
    res204(res);
  }),

  /**
   * POST /api/lessons/:lessonId/progress
   * Auto-save watch position — called every 15 seconds by the video player.
   */
  saveProgress: asyncHandler(async (req, res) => {
    const { lessonId }   = req.params;
    const { position }   = req.body;
    const userId         = req.user.id;

    // Get lesson to find courseId for progress recomputation
    const { data: lesson } = await db
      .from("lessons")
      .select("id, duration_seconds, course_modules(course_id)")
      .eq("id", lessonId)
      .single();

    if (!lesson) return res404(res, "Lesson not found");
    const courseId = lesson.course_modules?.course_id;

    const { error } = await db
      .from("lesson_progress")
      .upsert(
        {
          user_id:              userId,
          lesson_id:            lessonId,
          last_position_seconds: position,
          updated_at:           now(),
        },
        { onConflict: "user_id,lesson_id" }
      );

    if (error) throw new Error(error.message);

    res200(res, { saved: true, position });
  }),

  /**
   * POST /api/lessons/:lessonId/complete
   * Mark a lesson as completed and recompute course progress %.
   */
  complete: asyncHandler(async (req, res) => {
    const { lessonId } = req.params;
    const userId       = req.user.id;

    const { data: lesson } = await db
      .from("lessons")
      .select("id, is_preview, course_modules(course_id)")
      .eq("id", lessonId)
      .single();

    if (!lesson) return res404(res, "Lesson not found");
    if (!(await mayOpenLesson(req.user, lesson))) return res403(res, "Enrol in this course to complete this lesson");
    const courseId = lesson.course_modules?.course_id;

    // Was it already completed? (so XP is awarded once, not on every re-complete)
    const { data: prior } = await db.from("lesson_progress")
      .select("completed").eq("user_id", userId).eq("lesson_id", lessonId).maybeSingle();
    const wasCompleted = !!prior?.completed;

    // Upsert progress as completed
    await db
      .from("lesson_progress")
      .upsert(
        { user_id: userId, lesson_id: lessonId, completed: true, completed_at: now(), updated_at: now() },
        { onConflict: "user_id,lesson_id" }
      );

    // Recompute course progress
    const { data: totalLessons } = await db
      .from("lessons")
      .select("id", { count: "exact" })
      .eq("course_modules.course_id", courseId);

    const { data: doneLessons } = await db
      .from("lesson_progress")
      .select("id", { count: "exact" })
      .eq("user_id", userId)
      .eq("completed", true)
      .in("lesson_id",
        (await db.from("lessons").select("id").eq("course_modules.course_id", courseId)).data?.map((l) => l.id) ?? []
      );

    const total    = totalLessons?.length  ?? 1;
    const done     = doneLessons?.length   ?? 0;
    const progress = Math.round((done / total) * 100);

    await db
      .from("enrollments")
      .update({ progress })
      .eq("user_id", userId)
      .eq("course_id", courseId);

    // Ranking XP — first completion only. Course-completion bonus at 100%.
    if (!wasCompleted && courseId) {
      awardXP({ userId, courseId, reason: "lesson_complete", amount: XP.LESSON_COMPLETE }).catch(() => {});
      if (progress === 100) awardXP({ userId, courseId, reason: "course_complete", amount: XP.COURSE_COMPLETE }).catch(() => {});
    }

    res200(res, { completed: true, courseProgress: progress });
  }),

  /**
   * POST /api/lessons/:lessonId/quiz
   * Submit quiz answers. Evaluates against content_json.questions,
   * returns score and pass/fail, saves to lesson_progress.
   */
  submitQuiz: asyncHandler(async (req, res) => {
    const { lessonId } = req.params;
    const { answers }  = req.body;   // [{ question_id, answer }]

    const { data: lesson } = await db
      .from("lessons")
      .select("id, lesson_type, is_preview, content_json, course_modules(course_id)")
      .eq("id", lessonId)
      .single();

    if (!lesson)                       return res404(res, "Lesson not found");
    if (!(await mayOpenLesson(req.user, lesson))) return res403(res, "Enrol in this course to take this quiz");
    if (lesson.lesson_type !== "quiz") return res400(res, "This lesson is not a quiz");
    if (!lesson.content_json?.questions) return res400(res, "Quiz has no questions configured");

    const { questions, passing_score = 70 } = lesson.content_json;

    // Grade answers
    let correct = 0;
    const feedback = questions.map((q) => {
      const submission = answers.find((a) => a.question_id === q.id);
      const isCorrect  = submission?.answer === q.correct_answer;
      if (isCorrect) correct++;
      return {
        question_id:    q.id,
        correct:        isCorrect,
        your_answer:    submission?.answer ?? null,
        correct_answer: q.correct_answer,
        explanation:    q.explanation ?? null,
      };
    });

    const score  = Math.round((correct / questions.length) * 100);
    const passed = score >= passing_score;

    // Was this quiz already passed? (award XP once)
    const { data: priorQ } = await db.from("lesson_progress")
      .select("completed").eq("user_id", req.user.id).eq("lesson_id", lessonId).maybeSingle();
    const wasPassed = !!priorQ?.completed;

    // Save score to lesson_progress
    await db
      .from("lesson_progress")
      .upsert(
        {
          user_id:     req.user.id,
          lesson_id:   lessonId,
          quiz_score:  score,
          completed:   passed,
          completed_at: passed ? now() : null,
          updated_at:  now(),
        },
        { onConflict: "user_id,lesson_id" }
      );

    // Ranking XP — first pass only; perfect score earns more.
    if (passed && !wasPassed) {
      const courseId = lesson.course_modules?.course_id ?? null;
      awardXP({ userId: req.user.id, courseId, reason: score === 100 ? "quiz_perfect" : "quiz_pass", amount: score === 100 ? XP.QUIZ_PERFECT : XP.QUIZ_PASS }).catch(() => {});
    }

    res200(res, {
      score,
      passing_score,
      passed,
      correct,
      total:    questions.length,
      feedback,
    });
  }),
};

// ─── § PROGRESS HANDLER ───────────────────────────────────────────────────────
// `progressHandler` lives in course-content-outline.js (read-only view).

// ─── § ROUTER ─────────────────────────────────────────────────────────────────

const router = Router();

// Course outline
router.get ("/courses/:courseId/content",                      authenticateToken, moduleHandlers.getCourseContent);
router.get ("/courses/:courseId/progress",                     authenticateToken, progressHandler);

// Modules (instructor only for write)
router.get ("/courses/:courseId/modules",                      authenticateToken, moduleHandlers.list);
router.post("/courses/:courseId/modules",                      authenticateToken, requireRole(["instructor", "admin"]), rules.createModule, runValidation, moduleHandlers.create);
router.put ("/modules/:moduleId",                              authenticateToken, requireRole(["instructor", "admin"]), moduleHandlers.update);
router.delete("/modules/:moduleId",                            authenticateToken, requireRole(["instructor", "admin"]), moduleHandlers.delete);

// Lessons (write = instructor only; read = enrolled student or instructor)
router.get ("/modules/:moduleId/lessons",                      authenticateToken, lessonHandlers.list);
router.get ("/lessons/:lessonId",                              authenticateToken, lessonHandlers.get);
router.post("/courses/:courseId/modules/:moduleId/lessons",   authenticateToken, requireRole(["instructor", "admin"]), rules.createLesson, runValidation, lessonHandlers.create);
router.put ("/lessons/:lessonId",                              authenticateToken, requireRole(["instructor", "admin"]), lessonHandlers.update);
router.delete("/lessons/:lessonId",                            authenticateToken, requireRole(["instructor", "admin"]), lessonHandlers.delete);

// Student progress
router.post("/lessons/:lessonId/progress",                     authenticateToken, rules.saveProgress, runValidation, lessonHandlers.saveProgress);
router.post("/lessons/:lessonId/complete",                     authenticateToken, lessonHandlers.complete);
router.post("/lessons/:lessonId/quiz",                         authenticateToken, rules.submitQuiz,   runValidation, lessonHandlers.submitQuiz);

export default router;
