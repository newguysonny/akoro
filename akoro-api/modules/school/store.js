/**
 * modules/school/store.js — every Supabase query for the school portal's core
 * tables (profile, people, classrooms, settings, roles, backups, audit).
 *
 * No Express import and no response shaping that needs request state: callers
 * get the raw rows / `{ data, error }` results they had from `db` before.
 */

import db from "../../db.js";
import { AGENT_SELECT } from "./rules.js";

const edu = () => db.schema("edu");
const mgmt = () => db.schema("mgmt");

// ── school_profiles ──────────────────────────────────────────────────────────
export const schoolProfileByAdmin = (userId) => db
  .from("school_profiles")
  .select("id, name, description, logo_url, website, address, phone, is_active, verification_status, created_at, slug, acronym, principal_name, country, state, lga, city, education_levels, ownership_type, curriculum, year_established, gender_type, boarding_type, student_band, favicon_url, principal_signature_url")
  .eq("admin_user_id", userId)
  .order("created_at", { ascending: true })
  .limit(1)
  .maybeSingle();

export const schoolProfileIdByAdmin = (userId) => db
  .from("school_profiles")
  .select("id").eq("admin_user_id", userId)
  .order("created_at", { ascending: true }).limit(1).maybeSingle();

export const schoolProfileFull = (schoolId) => db
  .from("school_profiles")
  .select("name, acronym, logo_url, address, phone, principal_name, city, state, lga, country, admin_user_id")
  .eq("id", schoolId).maybeSingle();

export const schoolProfileBySlug = (slug) => db
  .from("school_profiles")
  .select("id, name, slug, logo_url, address, phone, acronym, principal_name")
  .eq("slug", slug).maybeSingle();

export const schoolSlugClash = (slug) => db
  .from("school_profiles").select("id").eq("slug", slug).maybeSingle();

export const schoolProfileSlug = (schoolId, slug) => db
  .from("school_profiles").update({ slug }).eq("id", schoolId);

export const schoolProfileUpdate = (schoolId, patch) => db
  .from("school_profiles").update(patch).eq("id", schoolId);

// ── users ────────────────────────────────────────────────────────────────────
export const userByEmailLite = (email) => db
  .from("users").select("id, full_name, email").eq("email", email).maybeSingle();

export const userByEmailFull = (email) => db
  .from("users").select("*").eq("email", email).maybeSingle();

export const userByIdFull = (userId) => db
  .from("users").select("*").eq("id", userId).maybeSingle();

export const userEmailById = (userId) => db
  .from("users").select("email").eq("id", userId).maybeSingle();

export const userNameEmailById = (userId) => db
  .from("users").select("full_name, email").eq("id", userId).maybeSingle();

export const userRoleUpdate = (userId, role) => db
  .from("users").update({ role }).eq("id", userId);

export const userInsert = (row) => db
  .from("users").insert(row).select("id, full_name, email").single();

export const authUserEmail = (userId) => db.auth.admin.getUserById(userId);

// ── school_teachers ──────────────────────────────────────────────────────────
export const teacherLinksApproved = (schoolId) => db
  .from("school_teachers")
  .select("teacher_id, created_at, status, users:users!school_teachers_teacher_id_fkey(id, full_name, email, avatar_url, subjects)")
  .eq("school_id", schoolId)
  .eq("status", "approved")
  .order("created_at", { ascending: false });

export const teacherLinksPending = (schoolId) => db
  .from("school_teachers")
  .select("teacher_id, requested_at, status, users:users!school_teachers_teacher_id_fkey(id, full_name, email, avatar_url, subjects)")
  .eq("school_id", schoolId).eq("status", "pending").order("requested_at", { ascending: true });

export const teacherIdsBySchool = (schoolId) => db
  .from("school_teachers").select("teacher_id").eq("school_id", schoolId);

export const teacherLink = (schoolId, teacherId) => db
  .from("school_teachers").select("teacher_id").eq("school_id", schoolId).eq("teacher_id", teacherId).maybeSingle();

export const teacherLinkUpsert = (schoolId, teacherId) => db
  .from("school_teachers").upsert({ school_id: schoolId, teacher_id: teacherId }, { onConflict: "school_id,teacher_id" });

export const teacherRequestDecide = (schoolId, teacherId, patch) => db
  .from("school_teachers")
  .update(patch)
  .eq("school_id", schoolId).eq("teacher_id", teacherId).eq("status", "pending")
  .select("teacher_id").maybeSingle();

export const teacherSiteLinks = (schoolId) => db
  .from("school_teachers")
  .select("users:users!school_teachers_teacher_id_fkey(id, full_name)").eq("school_id", schoolId);

export const teacherAccessRows = (userId) => edu()
  .from("instructor_tool_access")
  .select("tool_id, access_granted, platform_tools!inner(key, kind)")
  .eq("instructor_id", userId).eq("access_granted", true)
  .eq("platform_tools.kind", "management");

// ── classrooms ───────────────────────────────────────────────────────────────
export const classroomIdsBySchool = (schoolId) => db
  .from("classrooms").select("id").eq("school_id", schoolId);

export const classroomsWithStudents = (schoolId) => db
  .from("classrooms")
  .select("id, name, description, teacher_id, teacher:users!classrooms_teacher_id_fkey(full_name), classroom_students(id)")
  .eq("school_id", schoolId)
  .order("created_at", { ascending: false });

export const classroomById = (classroomId) => db
  .from("classrooms").select("id, school_id, name").eq("id", classroomId).maybeSingle();

export const classroomInsert = (row) => db
  .from("classrooms").insert(row).select("id, name, description, teacher_id").single();

export const classroomTeacherUpdate = (classroomId, teacherId) => db
  .from("classrooms").update({ teacher_id: teacherId }).eq("id", classroomId);

export const classroomsBySite = (schoolId) => db
  .from("classrooms").select("name").eq("school_id", schoolId);

export const classroomFirstForSchool = (schoolId) => db
  .from("classrooms").select("id").eq("school_id", schoolId).order("created_at", { ascending: true }).limit(1).maybeSingle();

export const classroomCreateGeneral = (row) => db
  .from("classrooms").insert(row).select("id").single();

export const classroomsAdoptUnassigned = (schoolId, teacherId) => db
  .from("classrooms").update({ school_id: schoolId }).eq("teacher_id", teacherId).is("school_id", null);

// ── classroom_students ───────────────────────────────────────────────────────
export const classroomStudentCount = (cids) => db
  .from("classroom_students").select("id", { count: "exact", head: true }).in("classroom_id", cids);

export const classroomStudentsByCids = (cids) => db
  .from("classroom_students")
  .select("user_id, status, classroom_id, users:users!classroom_students_user_id_fkey(id, full_name, email, avatar_url)")
  .in("classroom_id", cids);

export const classroomStudentLink = (classroomId, userId) => db
  .from("classroom_students").select("id").eq("classroom_id", classroomId).eq("user_id", userId).maybeSingle();

export const classroomStudentInsert = (row) => db
  .from("classroom_students").insert(row);

export const classroomStudentAny = (userId, cids) => db
  .from("classroom_students").select("id").eq("user_id", userId).in("classroom_id", cids).limit(1).maybeSingle();

// ── courses / enrollments ────────────────────────────────────────────────────
export const courseCountByInstructors = (ids) => db
  .from("courses").select("id", { count: "exact", head: true }).in("instructor_id", ids);

export const coursesByInstructors = (ids) => db
  .from("courses")
  .select("id, slug, title, description, subject, level, is_published, is_free, price, course_type, cover_image_url, total_students, rating, total_hours, created_at, instructor:users!instructor_id(full_name)")
  .in("instructor_id", ids)
  .order("created_at", { ascending: false });

export const enrollmentCount = (courseId) => db
  .from("enrollments").select("id", { count: "exact", head: true }).eq("course_id", courseId).eq("status", "active");

export const coursesForSite = (teacherIds) => db
  .from("courses").select("title, subject, level, price, is_free").in("instructor_id", teacherIds).eq("is_published", true).limit(24);

// ── user_agents ──────────────────────────────────────────────────────────────
export const agentByUser = (userId) => db
  .from("user_agents").select(AGENT_SELECT).eq("user_id", userId).maybeSingle();

export const agentInsert = (row) => db
  .from("user_agents").insert(row).select(AGENT_SELECT).single();

export const agentUpdate = (userId, patch) => db
  .from("user_agents").update(patch).eq("user_id", userId).select(AGENT_SELECT).single();

// ── user_settings ────────────────────────────────────────────────────────────
export const userSettings = (userId) => db
  .from("user_settings").select("settings").eq("user_id", userId).maybeSingle();

// ── edu.school_portal_settings ───────────────────────────────────────────────
export const portalSettingsBySchool = (schoolId) => edu()
  .from("school_portal_settings").select("*").eq("school_id", schoolId).maybeSingle();

export const portalSettingsCreate = (schoolId) => edu()
  .from("school_portal_settings").insert({ school_id: schoolId }).select("*").single();

export const portalSettingsSetColumn = (schoolId, column, value) => edu()
  .from("school_portal_settings")
  .update({ [column]: value, updated_at: new Date() })
  .eq("school_id", schoolId)
  .select(column)
  .single();

export const portalSettingsMerge = (schoolId, patch) => edu()
  .from("school_portal_settings")
  .update({ ...patch, updated_at: new Date() }).eq("school_id", schoolId);

// ── edu.school_audit_logs ────────────────────────────────────────────────────
export const auditLogInsert = (row) => edu().from("school_audit_logs").insert(row);

export const auditLogs = (schoolId, { limit, offset, entityType, method }) => {
  let q = edu().from("school_audit_logs")
    .select("id, actor_name, method, entity_type, entity_label, path, status_code, details, created_at", { count: "exact" })
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (entityType) q = q.eq("entity_type", entityType);
  if (method) q = q.eq("method", method);
  return q;
};

export const auditLogEntityTypes = (schoolId) => edu()
  .from("school_audit_logs").select("entity_type").eq("school_id", schoolId);

// ── edu.school_roles ─────────────────────────────────────────────────────────
export const systemRole = (schoolId) => edu()
  .from("school_roles").select("id").eq("school_id", schoolId).eq("is_system", true).maybeSingle();

export const roleInsert = (row) => edu().from("school_roles").insert(row);

export const rolesBySchool = (schoolId) => edu()
  .from("school_roles")
  .select("id, name, description, is_system, permissions, member_count, updated_at")
  .eq("school_id", schoolId)
  .order("is_system", { ascending: false })
  .order("created_at", { ascending: true });

export const roleById = (schoolId, roleId) => edu()
  .from("school_roles").select("is_system").eq("id", roleId).eq("school_id", schoolId).maybeSingle();

export const roleInsertFull = (row) => edu()
  .from("school_roles").insert(row)
  .select("id, name, description, is_system, permissions, member_count, updated_at").single();

export const roleUpdate = (schoolId, roleId, patch) => edu()
  .from("school_roles")
  .update(patch).eq("id", roleId).eq("school_id", schoolId)
  .select("id, name, description, is_system, permissions, member_count, updated_at").single();

export const roleDelete = (schoolId, roleId) => edu()
  .from("school_roles").delete().eq("id", roleId).eq("school_id", schoolId);

// ── edu.school_backups ───────────────────────────────────────────────────────
export const backupsBySchool = (schoolId) => edu()
  .from("school_backups")
  .select("id, label, type, status, size_bytes, record_count, created_at")
  .eq("school_id", schoolId)
  .order("created_at", { ascending: false })
  .limit(50);

export const backupInsert = (row) => edu()
  .from("school_backups").insert(row)
  .select("id, label, type, status, size_bytes, record_count, created_at").single();

export const backupDelete = (schoolId, backupId) => edu()
  .from("school_backups").delete().eq("id", backupId).eq("school_id", schoolId);

export const teacherCountBySchool = (schoolId) => db
  .from("school_teachers").select("teacher_id", { count: "exact", head: true }).eq("school_id", schoolId);

// ── edu.school_telegram_config ───────────────────────────────────────────────
export const telegramConfig = (schoolId) => edu()
  .from("school_telegram_config").select("*").eq("school_id", schoolId).maybeSingle();

export const telegramTokens = (schoolId) => edu()
  .from("school_telegram_config").select("bot_token, chat_id").eq("school_id", schoolId).maybeSingle();

export const telegramUpsert = (patch) => edu()
  .from("school_telegram_config").upsert(patch, { onConflict: "school_id" });

// ── edu.school_domains ───────────────────────────────────────────────────────
export const domainsBySchool = (schoolId) => edu()
  .from("school_domains").select("*").eq("school_id", schoolId).order("created_at", { ascending: true });

export const domainInsert = (row) => edu()
  .from("school_domains").insert(row).select("*").single();

export const domainUpdate = (domainId, patch) => edu()
  .from("school_domains").update(patch).eq("id", domainId);

export const domainById = (schoolId, domainId) => edu()
  .from("school_domains").select("*").eq("id", domainId).eq("school_id", schoolId).maybeSingle();

export const domainDelete = (schoolId, domainId) => edu()
  .from("school_domains").delete().eq("id", domainId).eq("school_id", schoolId);

export const verifiedDomainFirst = (schoolId) => edu()
  .from("school_domains")
  .select("domain").eq("school_id", schoolId).eq("verified", true)
  .order("created_at", { ascending: true }).limit(1).maybeSingle();

export const domainSummaryById = (schoolId, domainId) => edu()
  .from("school_domains").select("domain, vercel_added").eq("id", domainId).eq("school_id", schoolId).maybeSingle();

// ── edu.school_social_accounts ───────────────────────────────────────────────
export const socialAccountsBySchool = (schoolId) => edu()
  .from("school_social_accounts").select("*").eq("school_id", schoolId).order("connected_at", { ascending: false });

export const socialAccountUpdate = (schoolId, accountId, patch) => edu()
  .from("school_social_accounts").update(patch).eq("id", accountId).eq("school_id", schoolId);

// ── mgmt.students (SIS roster) ───────────────────────────────────────────────
export const sisStudentByUser = (schoolId, userId) => mgmt()
  .from("students").select("id").eq("school_id", schoolId).eq("user_id", userId).maybeSingle();

export const sisStudentInsert = (row) => mgmt()
  .from("students").insert(row).select("id").maybeSingle();

export const sisGuardianKids = (schoolId, email) => mgmt()
  .from("students").select("id, guardian_email")
  .eq("school_id", schoolId).eq("status", "active").ilike("guardian_email", email).limit(10);
