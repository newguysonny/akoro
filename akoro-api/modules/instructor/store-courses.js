/**
 * instructor/store-courses.js — every query the instructor routes make against
 * courses, course modules, lessons, session materials and enrolments.
 *
 * No Express, no policy: the shape of the answer comes from here; what it
 * means is decided in the services and rules.js.
 */
import db from "../../db.js";

// ─── courses ─────────────────────────────────────────────────────────────────

export const coursesOfTeacher = (teacherId, onlyCourseId = null) => {
  let q = db.from("courses").select("id").eq("instructor_id", teacherId);
  if (onlyCourseId) q = q.eq("id", onlyCourseId);
  return q;
};

export const coursesForStats = (teacherId) =>
  db.from("courses").select("id, price, is_published").eq("instructor_id", teacherId);

export const coursesByInstructor = (instructorId) =>
  db.from("courses").select("*").eq("instructor_id", instructorId)
    .order("created_at", { ascending: false });

export const courseForOwnership = (courseId) =>
  db.from("courses").select("id, instructor_id").eq("id", courseId).maybeSingle();

export const courseOwnerSingle = (courseId) =>
  db.from("courses").select("id, instructor_id").eq("id", courseId).single();

export const courseWithTitle = (courseId) =>
  db.from("courses").select("id, instructor_id, title").eq("id", courseId).single();

export const courseForDelete = (courseId) =>
  db.from("courses").select("id, instructor_id, title").eq("id", courseId).single();

export const latestCourseOfTeacher = (teacherId) =>
  db.from("courses").select("id").eq("instructor_id", teacherId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

export const insertCourse = (row) =>
  db.from("courses").insert(row).select().single();

export const updateCourse = (courseId, updates) =>
  db.from("courses").update(updates).eq("id", courseId).select().single();

export const deleteCourse = (courseId) =>
  db.from("courses").delete().eq("id", courseId);

export const setScheduleConfig = (courseId, scheduleConfig, updatedAt) =>
  db.from("courses").update({ schedule_config: scheduleConfig, updated_at: updatedAt }).eq("id", courseId);

// ─── course modules ──────────────────────────────────────────────────────────

export const modulesForCourse = (courseId) =>
  db.from("course_modules").select("*").eq("course_id", courseId)
    .order("order_index", { ascending: true });

export const moduleById = (id) =>
  db.from("course_modules").select("id, course_id").eq("id", id).maybeSingle();

export const insertModule = (row) =>
  db.from("course_modules").insert(row).select().single();

export const updateModule = (id, updates) =>
  db.from("course_modules").update(updates).eq("id", id).select().single();

export const deleteModule = (id) =>
  db.from("course_modules").delete().eq("id", id);

// ─── lessons ─────────────────────────────────────────────────────────────────

export const insertLesson = (row) =>
  db.from("lessons").insert(row).select().single();

// ─── session materials ───────────────────────────────────────────────────────

export const materialsForSession = (sessionId) =>
  db.from("session_materials").select("*").eq("session_id", sessionId)
    .order("order_index", { ascending: true });

export const insertMaterials = (rows) =>
  db.from("session_materials").insert(rows);

export const insertMaterial = (row) =>
  db.from("session_materials").insert(row).select().single();

export const materialById = (id) =>
  db.from("session_materials").select("id, session_id").eq("id", id).maybeSingle();

export const deleteMaterial = (id) =>
  db.from("session_materials").delete().eq("id", id);

// ─── enrolments ──────────────────────────────────────────────────────────────

export const activeEnrollmentCount = (courseIds) =>
  db.from("enrollments").select("id", { count: "exact", head: true })
    .in("course_id", courseIds).eq("status", "active");

export const activeEnrollmentCountForCourse = (courseId) =>
  db.from("enrollments").select("id", { count: "exact", head: true })
    .eq("course_id", courseId).eq("status", "active");

export const paidEnrollments = (courseIds) =>
  db.from("enrollments").select("course_id").in("course_id", courseIds)
    .eq("status", "active").not("payment_id", "is", null);

export const activeStudentIds = (courseId) =>
  db.from("enrollments").select("user_id").eq("course_id", courseId).eq("status", "active");

export const enrollmentsForCourses = (courseIds, status = null) => {
  let q = db.from("enrollments")
    .select(`id, course_id, status, progress, enrolled_at,
             users ( id, full_name, email, avatar_url, phone ),
             courses ( id, title )`)
    .in("course_id", courseIds);
  if (status) q = q.eq("status", status);
  return q.order("enrolled_at", { ascending: false });
};

export const enrollmentForUser = (userId, courseId) =>
  db.from("enrollments").select("id, status").eq("user_id", userId).eq("course_id", courseId).maybeSingle();

export const enrollmentById = (enrollmentId) =>
  db.from("enrollments").select("id, course_id").eq("id", enrollmentId).single();

export const reactivateEnrollment = (id, patch) =>
  db.from("enrollments").update(patch).eq("id", id).select().single();

export const insertEnrollment = (row) =>
  db.from("enrollments").insert(row).select().single();

export const deleteEnrollment = (enrollmentId) =>
  db.from("enrollments").delete().eq("id", enrollmentId);
