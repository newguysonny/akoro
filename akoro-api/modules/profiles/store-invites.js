/**
 * Supabase queries for course ownership, enrolments and course invites.
 */
import db from "../../db.js";

export const listOwnedCourses = (teacherId) =>
  db.from("courses").select("id, title").eq("instructor_id", teacherId);

export const listOwnedCourseIds = (teacherId) =>
  db.from("courses").select("id").eq("instructor_id", teacherId);

export const getCourseForImport = (courseId) =>
  db.from("courses").select("id, title, instructor_id").eq("id", courseId).maybeSingle();

export const listCoursesOwnedByIds = (courseIds, teacherId) =>
  db.from("courses")
    .select("id, title, instructor_id")
    .in("id", courseIds)
    .eq("instructor_id", teacherId);

export const listCoursesOwnedByInvite = (invite) =>
  db.from("courses").select("id, title")
    .in("id", invite.courseIds).eq("instructor_id", invite.teacherId);

export async function listEnrollmentsForCourses(courseIds, { status, limit, offset }) {
  let q = db.from("enrollments")
    .select(`
      id, status, progress, enrolled_at,
      users!enrollments_user_id_fkey ( id, full_name, username, email, phone, avatar_url, created_at, must_change_password ),
      courses!enrollments_course_id_fkey ( id, title )
    `, { count: "exact" })
    .in("course_id", courseIds)
    .order("enrolled_at", { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (status) q = q.eq("status", status);

  return q;
}

export const listEnrollmentSeats = (userId, courseIds) =>
  db.from("enrollments")
    .select("course_id, status").eq("user_id", userId).in("course_id", courseIds);

export const upsertEnrollment = (userId, courseId) =>
  db.from("enrollments").upsert(
    { user_id: userId, course_id: courseId, status: "active" },
    { onConflict: "user_id,course_id" }
  );

export const incrementCourseStudents = (courseId) =>
  db.rpc("increment_course_students", { course_id_input: courseId });

export const findEnrollmentForLearner = (userId, courseIds) =>
  db.from("enrollments").select("id")
    .eq("user_id", userId).in("course_id", courseIds).limit(1);

export const findEnrollmentForStudent = (userId, courseIds) =>
  db.from("enrollments").select("id")
    .eq("user_id", userId).in("course_id", courseIds).limit(1).single();
