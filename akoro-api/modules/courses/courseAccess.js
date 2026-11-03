/**
 * modules/courses/courseAccess.js — who may manage or use a course (Phase 15 item 6).
 *
 * The API talks to Supabase with the service-role key, so row-level security
 * protects nothing: every route that takes a course, module, lesson or
 * session id has to check here that the row belongs to the caller. The
 * `instructor` role alone is not ownership — it is held by every teacher.
 *
 *   canManageCourse(user, courseId)   the course's instructor, or an admin
 *   canUseCourse(user, courseId)      the above, or an active enrolment
 *   courseOfModule / courseOfLesson   the course a module or lesson sits in
 */
import db from "../../db.js";

export const isAdmin = (user) => user?.role === "admin";

/** The course's instructor id, or null when there is no such course. */
async function instructorOf(courseId) {
  if (!courseId) return null;
  const { data } = await db.from("courses").select("instructor_id").eq("id", courseId).maybeSingle();
  return data ? data.instructor_id : null;
}

/** The course's own instructor, or an admin. */
export async function canManageCourse(user, courseId) {
  if (!user?.id || !courseId) return false;
  if (isAdmin(user)) return true;
  return (await instructorOf(courseId)) === user.id;
}

/** An active enrolment in the course. */
export async function isEnrolled(userId, courseId) {
  if (!userId || !courseId) return false;
  const { data } = await db.from("enrollments").select("id")
    .eq("user_id", userId).eq("course_id", courseId).eq("status", "active").maybeSingle();
  return !!data;
}

/** Someone who belongs in the course: its instructor, an admin, or an enrolled learner. */
export async function canUseCourse(user, courseId) {
  if (await canManageCourse(user, courseId)) return true;
  return isEnrolled(user?.id, courseId);
}

/** Route guard: the `:courseId` (or another param) must be the caller's own course. */
export const requireCourseManager = (param = "courseId") => async (req, res, next) => {
  try {
    if (await canManageCourse(req.user, req.params[param])) return next();
    return res.status(403).json({ success: false, message: "You do not own this course" });
  } catch (e) { return next(e); }
};

/** The course a module belongs to, or null. */
export async function courseOfModule(moduleId) {
  if (!moduleId) return null;
  const { data } = await db.from("course_modules").select("course_id").eq("id", moduleId).maybeSingle();
  return data?.course_id ?? null;
}

/** The course a lesson belongs to, or null. */
export async function courseOfLesson(lessonId) {
  if (!lessonId) return null;
  const { data } = await db.from("lessons").select("course_modules ( course_id )").eq("id", lessonId).maybeSingle();
  return data?.course_modules?.course_id ?? null;
}
