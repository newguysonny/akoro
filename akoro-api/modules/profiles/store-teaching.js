/**
 * Supabase queries for classrooms, classroom seats, teacher↔school links and
 * the school SIS mirror (mgmt.students). Every ownership predicate lives in
 * the query it belongs to.
 */
import db from "../../db.js";

export const listTeacherClassroomsWithCounts = (teacherId) =>
  db.from("classrooms")
    .select(`
      id, name, description, student_limit, is_upgraded, created_at,
      classroom_students ( count )
    `)
    .eq("teacher_id", teacherId);

export const listTeacherClassrooms = (teacherId) =>
  db.from("classrooms")
    .select(`
      id, name, description, student_limit, is_upgraded, created_at,
      classroom_students ( id )
    `)
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false });

export const listTeacherClassroomFlags = (teacherId) =>
  db.from("classrooms")
    .select("id, is_upgraded")
    .eq("teacher_id", teacherId);

export const insertClassroom = (row) =>
  db.from("classrooms")
    .insert(row)
    .select()
    .single();

export const getClassroomForTeacher = (classroomId) =>
  db.from("classrooms")
    .select("id, teacher_id, school_id, name, student_limit, is_upgraded")
    .eq("id", classroomId)
    .single();

export const getClassroomTeacher = (classroomId) =>
  db.from("classrooms").select("teacher_id").eq("id", classroomId).single();

export const getClassroomTeacherName = (classroomId) =>
  db.from("classrooms").select("teacher_id, name").eq("id", classroomId).single();

export const getClassroomTeacherUpgrade = (classroomId) =>
  db.from("classrooms").select("teacher_id, is_upgraded").eq("id", classroomId).single();

export const getClassroomNameSchool = (classroomId) =>
  db.from("classrooms").select("name, school_id").eq("id", classroomId).single();

export const getClassroomForImport = (classroomId) =>
  db.from("classrooms")
    .select("id, teacher_id, school_id").eq("id", classroomId).maybeSingle();

export const getFirstClassroomWithSchool = (teacherId) =>
  db.from("classrooms")
    .select("id, school_id").eq("teacher_id", teacherId)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();

export const getFirstClassroomForTeacher = (teacherId) =>
  db.from("classrooms")
    .select("id").eq("teacher_id", teacherId)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();

export const listTeacherClassroomsIdName = (teacherId) =>
  db.from("classrooms").select("id, name").eq("teacher_id", teacherId);

export const listTeacherClassroomIds = (teacherId) =>
  db.from("classrooms").select("id").eq("teacher_id", teacherId);

export const updateClassroom = (classroomId, patch) =>
  db.from("classrooms").update(patch).eq("id", classroomId);

export const updateClassroomInSchool = (classroomId, schoolId, patch) =>
  db.from("classrooms")
    .update(patch)
    .eq("id", classroomId)
    .eq("school_id", schoolId);

export const updateTeacherClassroomsSchool = (teacherId, schoolId) =>
  db.from("classrooms").update({ school_id: schoolId }).eq("teacher_id", teacherId).is("school_id", null);

export const countClassroomStudents = (classroomId) =>
  db.from("classroom_students")
    .select("id", { count: "exact", head: true })
    .eq("classroom_id", classroomId);

export const listClassroomStudents = (classroomId) =>
  db.from("classroom_students")
    .select(`
      id, joined_at, status,
      users ( id, full_name, username, email, phone, avatar_url )
    `)
    .eq("classroom_id", classroomId)
    .order("joined_at", { ascending: false });

export const findClassroomStudent = (classroomId, userId) =>
  db.from("classroom_students").select("id")
    .eq("classroom_id", classroomId).eq("user_id", userId).single();

export const findClassroomStudentStatus = (classroomId, userId) =>
  db.from("classroom_students").select("id, status")
    .eq("classroom_id", classroomId).eq("user_id", userId).maybeSingle();

export const insertClassroomStudent = (row) =>
  db.from("classroom_students").insert(row);

export const upsertClassroomStudent = (row) =>
  db.from("classroom_students").upsert(
    row,
    { onConflict: "classroom_id,user_id" }
  );

export const deleteClassroomStudent = (classroomId, userId) =>
  db.from("classroom_students")
    .delete()
    .eq("classroom_id", classroomId)
    .eq("user_id", userId);

export const updateClassroomStudent = (id, patch) =>
  db.from("classroom_students").update(patch).eq("id", id);

export const findActiveSeat = (userId, roomIds) =>
  db.from("classroom_students").select("id")
    .eq("user_id", userId).in("classroom_id", roomIds).eq("status", "active").limit(1);

/** The school a teacher has been approved into (or null). */
export const getApprovedSchoolId = (teacherId) =>
  db.from("school_teachers")
    .select("school_id").eq("teacher_id", teacherId).eq("status", "approved")
    .order("created_at", { ascending: true }).limit(1).maybeSingle();

export const getLatestSchoolLink = (teacherId) =>
  db.from("school_teachers")
    .select("school_id, status, school_profiles ( name, logo_url )").eq("teacher_id", teacherId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

export const upsertSchoolTeacher = (row) =>
  db.from("school_teachers").upsert(row, { onConflict: "school_id,teacher_id" });

export const upsertSchoolTeacherReturningStatus = (row) =>
  db.from("school_teachers").upsert(row, { onConflict: "school_id,teacher_id" }).select("status").single();

export const updateSchoolTeacher = (schoolId, teacherId, patch) =>
  db.from("school_teachers").update(patch)
    .eq("school_id", schoolId).eq("teacher_id", teacherId);

export const listSchoolTeacherRequests = (schoolId, status) =>
  db.from("school_teachers")
    .select("id, teacher_id, status, requested_at, users ( full_name, email, avatar_url )")
    .eq("school_id", schoolId).eq("status", status).order("requested_at", { ascending: true });

export const findSisStudent = (schoolId, userId) =>
  db.schema("mgmt").from("students").select("id").eq("school_id", schoolId).eq("user_id", userId).maybeSingle();

export const insertSisStudent = (row) =>
  db.schema("mgmt").from("students").insert(row);

export const getTeacherLink = (userId) =>
  db.from("classroom_students")
    .select("status, classrooms ( teacher_id, name, users:teacher_id ( full_name ) )")
    .eq("user_id", userId).in("status", ["pending", "active"])
    .order("requested_at", { ascending: false }).limit(1).maybeSingle();

export const listLearnerClassrooms = (userId) =>
  db.from("classroom_students")
    .select("classroom_id, classrooms!inner(id, name, teacher_id, school_id)")
    .eq("user_id", userId).eq("status", "active").limit(20);

export const listPendingJoinRequests = (classroomIds) =>
  db.from("classroom_students")
    .select("id, classroom_id, user_id, requested_at, users ( full_name, email, avatar_url )")
    .in("classroom_id", classroomIds).eq("status", "pending").order("requested_at", { ascending: true });

export const getJoinRequest = (id) =>
  db.from("classroom_students")
    .select("id, classroom_id, user_id, classrooms ( teacher_id, school_id )").eq("id", id).maybeSingle();
