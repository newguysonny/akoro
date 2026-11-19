/**
 * Supabase queries for school profiles, school ownership, admin listings and
 * the onboarding directories.
 */
import db from "../../db.js";

export const slugExists = (slug) =>
  db.from("school_profiles").select("id").eq("slug", slug).maybeSingle();

export const insertSchoolProfile = (row) =>
  db.from("school_profiles")
    .insert(row)
    .select()
    .single();

export const upsertSchoolPortalSettings = (schoolId, modules) =>
  db.schema("edu").from("school_portal_settings")
    .upsert({ school_id: schoolId, modules }, { onConflict: "school_id" });

export const getSchoolOwner = (schoolId) =>
  db.from("school_profiles").select("admin_user_id").eq("id", schoolId).single();

export const getSchoolOwnerWithName = (schoolId) =>
  db.from("school_profiles").select("admin_user_id, name").eq("id", schoolId).single();

export const getOwnedSchool = (schoolId, adminUserId) =>
  db.from("school_profiles").select("id")
    .eq("id", schoolId).eq("admin_user_id", adminUserId).maybeSingle();

export const getOwnedSchoolProfile = (schoolId, adminUserId) =>
  db.from("school_profiles")
    .select(`
      id, name, description, logo_url, website, address, phone, is_active, created_at,
      classrooms ( id, name, student_limit, is_upgraded,
        classroom_students ( id ) )
    `)
    .eq("id", schoolId)
    .eq("admin_user_id", adminUserId)   // owner-scoped: no cross-tenant reads
    .single();

export const listSchoolClassrooms = (schoolId) =>
  db.from("classrooms")
    .select(`
      id, name, description, is_upgraded, created_at,
      users!classrooms_teacher_id_fkey ( id, full_name, username ),
      classroom_students ( id )
    `)
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false });

export const getSchoolName = (schoolId) =>
  db.from("school_profiles").select("name").eq("id", schoolId).maybeSingle();

export const getSchoolForPrefill = (schoolId) =>
  db.from("school_profiles").select("id, name").eq("id", schoolId).maybeSingle();

export const getActiveSchool = (schoolId) =>
  db.from("school_profiles").select("id").eq("id", schoolId).eq("is_active", true).maybeSingle();

export const listAdminSchools = () =>
  db.from("school_profiles")
    .select("id, name, logo_url, is_active, created_at, users!school_profiles_admin_user_id_fkey(full_name, email)")
    .order("created_at", { ascending: false });

export const listActiveSchoolsDirectory = () =>
  db.from("school_profiles")
    .select("id, name, logo_url, address").eq("is_active", true).order("name", { ascending: true }).limit(500);

export const listApprovedSchoolLinks = (teacherIds) =>
  db.from("school_teachers")
    .select("teacher_id, school_profiles ( name )").in("teacher_id", teacherIds).eq("status", "approved");

export const listDirectoryTeacherClassrooms = (teacherIds) =>
  db.from("classrooms")
    .select("id, teacher_id, name, created_at").in("teacher_id", teacherIds)
    .order("created_at", { ascending: true });

export const listDirectoryClassroomRolls = (classroomIds) =>
  db.from("classroom_students")
    .select("classroom_id, user_id").in("classroom_id", classroomIds).eq("status", "active");

export const listMgmtClassesByName = (schoolId, name) =>
  db.schema("mgmt").from("classes")
    .select("id").eq("school_id", schoolId).ilike("name", name).limit(1);

export const listMgmtClassSubjects = (classId) =>
  db.schema("mgmt").from("class_subjects")
    .select("subjects:subject_id(name)").eq("class_id", classId);
