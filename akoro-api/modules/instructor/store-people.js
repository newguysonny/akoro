/**
 * instructor/store-people.js — every query the instructor routes make against
 * people and classrooms: users, agents, notification preferences and records,
 * the school link, classrooms and their rosters.
 *
 * No Express, no policy.
 */
import db from "../../db.js";

// ─── users ───────────────────────────────────────────────────────────────────

export const profileUser = (userId) =>
  db.from("users")
    .select("id, full_name, username, email, phone, bio, avatar_url, role, country, school_name, school_type, subjects, language, display_mode, accent_color, two_factor_enabled, created_at")
    .eq("id", userId).single();

export const updateProfileUser = (userId, updates) =>
  db.from("users")
    .update(updates)
    .eq("id", userId)
    .select("id, full_name, username, email, phone, bio, avatar_url, role, country, school_name, school_type, subjects, language, display_mode, accent_color, two_factor_enabled")
    .single();

export const userByEmail = (email) =>
  db.from("users").select("id, full_name, email").eq("email", email).maybeSingle();

export const insertUser = (row) =>
  db.from("users").insert(row).select().single();

// ─── agents ──────────────────────────────────────────────────────────────────

export const agentSummary = (userId) =>
  db.from("user_agents")
    .select("id, agent_name, agent_emoji, agent_color, agent_bg, total_xp")
    .eq("user_id", userId).maybeSingle();

export const agentXp = (userId) =>
  db.from("user_agents").select("total_xp").eq("user_id", userId).maybeSingle();

export const activeAgent = (userId) =>
  db.from("user_agents").select("id").eq("user_id", userId).eq("is_active", true).maybeSingle();

export const agentsForUsers = (ids) =>
  db.from("user_agents").select("user_id").in("user_id", ids);

export const upsertAgent = (row) =>
  db.from("user_agents").upsert(row, { onConflict: "user_id" }).select().single();

// ─── notifications ───────────────────────────────────────────────────────────

export const notificationPreferences = (userId) =>
  db.from("user_notification_preferences").select("*").eq("user_id", userId).maybeSingle();

export const upsertNotificationPreferences = (row) =>
  db.from("user_notification_preferences").upsert(row, { onConflict: "user_id" });

export const insertNotification = (row) =>
  db.from("notifications").insert(row);

export const insertNotifications = (rows) =>
  db.from("notifications").insert(rows);

// ─── school link ─────────────────────────────────────────────────────────────

export const schoolAdminOf = (userId) =>
  db.from("school_profiles").select("id").eq("admin_user_id", userId).limit(1).maybeSingle();

export const schoolAdminForClass = (userId, schoolId) =>
  db.from("school_profiles").select("id").eq("admin_user_id", userId).eq("id", schoolId).maybeSingle();

// ─── classrooms ──────────────────────────────────────────────────────────────

export const classroomsListed = (userId, schoolId) => {
  let q = db.from("classrooms")
    .select("id, name, description, school_id, teacher_id, classroom_students(id)")
    .order("name");
  return schoolId
    ? q.or(`teacher_id.eq.${userId},school_id.eq.${schoolId}`)
    : q.eq("teacher_id", userId);
};

export const classroomsBasic = (userId, schoolId, classroomId = null) => {
  let q = db.from("classrooms").select("id, name");
  q = schoolId
    ? q.or(`teacher_id.eq.${userId},school_id.eq.${schoolId}`)
    : q.eq("teacher_id", userId);
  if (classroomId) q = q.eq("id", classroomId);
  return q;
};

export const classroomAccess = (id) =>
  db.from("classrooms").select("id, teacher_id, school_id").eq("id", id).maybeSingle();

export const classroomForEnrolment = (classroomId) =>
  db.from("classrooms").select("id, name, teacher_id, school_id").eq("id", classroomId).maybeSingle();

export const classroomStudentsForClass = (classroomId) =>
  db.from("classroom_students")
    .select("user_id, users!inner(id, username, full_name, avatar_url, avatar_emoji)")
    .eq("classroom_id", classroomId).eq("status", "active");

export const classroomStudentsWithUsers = (roomIds) =>
  db.from("classroom_students")
    .select(`id, classroom_id, status, joined_at,
             users!inner ( id, full_name, email, avatar_url, phone, role )`)
    .in("classroom_id", roomIds).eq("status", "active");

export const upsertClassroomStudent = (row) =>
  db.from("classroom_students").upsert(row, { onConflict: "classroom_id,user_id", ignoreDuplicates: false });
