/**
 * battle/store-people.js — every query the battle routes make against the
 * people and course tables: users, agents, courses, enrolments, classrooms,
 * school links, drafts and the curriculum tables that name a class's subjects.
 *
 * No Express, no socket, no policy: the shape of the answer comes from here,
 * what it means is decided in service.js and rules.js.
 */
import db from "../../db.js";

// ─── courses / enrolments ─────────────────────────────────────────────────────

export const courseInstructor = (courseId) =>
  db.from("courses").select("instructor_id").eq("id", courseId).single();

export const coursesByIds = (ids) =>
  ids.length ? db.from("courses").select("id, title").in("id", ids) : { data: [] };

export const coursesOfTeacher = (teacherId) =>
  db.from("courses").select("id").eq("instructor_id", teacherId);

/** A course's active learners with their profile fields (the roster picker). */
export const enrolledUsers = (courseId) =>
  db.from("enrollments")
    .select("user_id, users!inner(id, username, full_name, avatar_url, avatar_emoji)")
    .eq("course_id", courseId).eq("status", "active");

export const enrolledUserIds = (courseId) =>
  db.from("enrollments").select("user_id").eq("course_id", courseId).eq("status", "active");

export const enrolledUserIdsExcept = (courseId, exceptUserId) =>
  db.from("enrollments").select("user_id")
    .eq("course_id", courseId).eq("status", "active").neq("user_id", exceptUserId);

export const enrolledUserIdsWithin = (courseId, ids) =>
  db.from("enrollments").select("user_id").eq("course_id", courseId).eq("status", "active").in("user_id", ids);

/** Active learners of a course who have an agent, except `exceptUserId`. */
export const enrolledLearnersWithAgents = (courseId, exceptUserId) =>
  db.from("enrollments")
    .select("user_id, user_agents!inner(id)")
    .eq("course_id", courseId).eq("status", "active").neq("user_id", exceptUserId);

export const enrolmentForUser = (userId, courseId) =>
  db.from("enrollments").select("id")
    .eq("user_id", userId).eq("course_id", courseId).eq("status", "active").single();

// ─── users / agents ───────────────────────────────────────────────────────────

export const userProfile = (userId) =>
  db.from("users").select("full_name, avatar_url").eq("id", userId).single();

export const userName = (userId) =>
  db.from("users").select("full_name").eq("id", userId).single();

export const userById = (userId) =>
  db.from("users").select("id, role").eq("id", userId).maybeSingle();

export const userByHandle = (handle, fields = "id") =>
  db.from("users").select(fields).or(`username.ilike.${handle},email.ilike.${handle}`).limit(1);

export const usersByIds = (ids, fields) =>
  ids.length ? db.from("users").select(fields).in("id", ids) : { data: [] };

export const agentOfUser = (userId) =>
  db.from("user_agents").select("*").eq("user_id", userId).single();

export const agentWithXp = (userId) =>
  db.from("user_agents").select("total_xp").eq("user_id", userId).single();

export const agentIdsForUsers = (ids) =>
  db.from("user_agents").select("user_id, id").in("user_id", ids);

export const agentsForUsers = (ids) =>
  ids.length ? db.from("user_agents").select("user_id").in("user_id", ids) : { data: [] };

// ─── classrooms / school links ────────────────────────────────────────────────

export const classroomMemberships = (userId) =>
  db.from("classroom_students")
    .select("classroom_id, classrooms!inner(id, name, school_id)")
    .eq("user_id", userId).eq("status", "active");

export const schoolAdministeredBy = (userId) =>
  db.from("school_profiles").select("id").eq("admin_user_id", userId).limit(1).maybeSingle();

export const classroomsTaughtBy = (userId, schoolId) => {
  const q = db.from("classrooms").select("id, name, school_id");
  return schoolId ? q.or(`teacher_id.eq.${userId},school_id.eq.${schoolId}`) : q.eq("teacher_id", userId);
};

export const classroom = (classroomId) =>
  db.from("classrooms").select("id, teacher_id, school_id").eq("id", classroomId).maybeSingle();

export const classroomName = (classroomId) =>
  db.from("classrooms").select("name").eq("id", classroomId).maybeSingle();

export const classroomsByIds = (ids) =>
  ids.length ? db.from("classrooms").select("id, name").in("id", ids) : { data: [] };

export const schoolAdminOfClass = (userId, schoolId) =>
  db.from("school_profiles").select("id").eq("admin_user_id", userId).eq("id", schoolId).maybeSingle();

export const schoolTeacherLink = (schoolId, teacherId) =>
  db.from("school_teachers").select("id").eq("school_id", schoolId).eq("teacher_id", teacherId).maybeSingle();

export const classEnrolment = (userId, classroomId) =>
  db.from("classroom_students").select("id")
    .eq("user_id", userId).eq("classroom_id", classroomId).eq("status", "active").maybeSingle();

export const classroomStudentIds = (classroomId) =>
  db.from("classroom_students").select("user_id").eq("classroom_id", classroomId).eq("status", "active");

export const classroomMembersWithin = (classroomId, ids) =>
  db.from("classroom_students").select("user_id").eq("classroom_id", classroomId).eq("status", "active").in("user_id", ids);

export const classroomStudentsWithProfiles = (classroomId) =>
  db.from("classroom_students")
    .select("user_id, users!inner(id, username, full_name, avatar_url, avatar_emoji)")
    .eq("classroom_id", classroomId).eq("status", "active");

export const classroomStudentCount = (classroomId) =>
  db.from("classroom_students").select("id", { count: "exact", head: true })
    .eq("classroom_id", classroomId).eq("status", "active");

// ─── curriculum / questions archive ───────────────────────────────────────────

export const curriculumClass = (schoolId, name) =>
  db.schema("mgmt").from("classes")
    .select("id").eq("school_id", schoolId).ilike("name", name).limit(1);

export const classSubjects = (classId) =>
  db.schema("mgmt").from("class_subjects").select("subjects:subject_id(name)").eq("class_id", classId);

export const pastQuestionSubjects = () =>
  db.schema("edu").from("past_questions")
    .select("subject").eq("type", "mcq").eq("verified", true).not("subject", "is", null).limit(2000);

// ─── drafts ───────────────────────────────────────────────────────────────────

export const activityDraft = (id) =>
  db.from("activity_drafts").select("type, status, created_by, payload").eq("id", id).maybeSingle();
