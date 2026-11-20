/**
 * live-sessions-store.js — every Supabase query for the live-session lifecycle.
 *
 * No Express import and no request/response objects: the service layer passes
 * plain ids, columns and payloads. Queries are the originals, unchanged, so the
 * join shapes and status semantics stay identical.
 */

import db from "../../db.js";

// ─── § SESSIONS ───────────────────────────────────────────────────────────────

export async function findCourse(courseId) {
  const { data } = await db
    .from("courses")
    .select("id, title, instructor_id, subject")
    .eq("id", courseId)
    .single();
  return data;
}

export async function insertSession(payload) {
  return db.from("live_sessions").insert(payload).select().single();
}

export async function listCourseSessions(courseId, { status, upcoming, offset, limit } = {}) {
  let query = db
    .from("live_sessions")
    .select(`
      id, title, description, topic, session_type,
      scheduled_start, scheduled_end, actual_start, actual_end,
      platform, join_url, meeting_password,
      max_participants, current_participants, waitlist_enabled,
      status, recording_url, created_at,
      users!live_sessions_instructor_id_fkey ( id, full_name, avatar_url )
    `)
    .eq("course_id", courseId)
    .order("scheduled_start", { ascending: true })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (status && status !== "all") query = query.eq("status", status);
  if (upcoming) query = query.gt("scheduled_start", new Date().toISOString()).eq("status", "scheduled");

  return query;
}

export async function getSessionFull(sessionId) {
  return db
    .from("live_sessions")
    .select(`
      *,
      users!live_sessions_instructor_id_fkey ( id, full_name, avatar_url, username )
    `)
    .eq("id", sessionId)
    .single();
}

export async function getSession(sessionId, columns) {
  const { data } = await db
    .from("live_sessions")
    .select(columns)
    .eq("id", sessionId)
    .single();
  return data;
}

export async function findSessionHost(sessionId) {
  const { data } = await db.from("live_sessions")
    .select("instructor_id").eq("id", sessionId).maybeSingle();
  return data;
}

export async function updateSession(sessionId, updates) {
  await db.from("live_sessions").update(updates).eq("id", sessionId);
}

export async function updateSessionOwned(sessionId, instructorId, updates) {
  return db
    .from("live_sessions")
    .update(updates)
    .eq("id", sessionId)
    .eq("instructor_id", instructorId)
    .select()
    .single();
}

export async function listInstructorSessions(instructorId) {
  return db
    .from("live_sessions")
    .select(`
      id, title, session_type, scheduled_start, status,
      max_participants, current_participants, recording_url,
      courses ( id, title )
    `)
    .eq("instructor_id", instructorId)
    .order("scheduled_start", { ascending: false });
}

// ─── § PARTICIPANTS ───────────────────────────────────────────────────────────

export async function listActiveEnrollments(courseId) {
  const { data } = await db
    .from("enrollments")
    .select("id, user_id")
    .eq("course_id", courseId)
    .eq("status", "active");
  return data;
}

export async function insertParticipants(rows) {
  await db.from("session_participants").insert(rows);
}

export async function getParticipant(sessionId, userId, columns = "status, joined_at") {
  const { data } = await db
    .from("session_participants")
    .select(columns)
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .single();
  return data;
}

export async function insertParticipant(row) {
  await db.from("session_participants").insert(row);
}

export async function updateParticipant(id, updates) {
  await db.from("session_participants").update(updates).eq("id", id);
}

export async function listJoinedParticipants(sessionId) {
  const { data } = await db
    .from("session_participants")
    .select("id, joined_at")
    .eq("session_id", sessionId)
    .eq("status", "joined");
  return data;
}

export async function listParticipants(sessionId) {
  return db
    .from("session_participants")
    .select(`
      id, status, joined_at, left_at, duration_minutes,
      attended, feedback_rating, feedback_text,
      users ( id, full_name, username, email, avatar_url )
    `)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
}

export async function setParticipantFeedback(sessionId, userId, rating, text) {
  return db
    .from("session_participants")
    .update({ feedback_rating: rating, feedback_text: text })
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .select()
    .single();
}

export async function listFeedbackRatings(sessionId) {
  const { data } = await db
    .from("session_participants")
    .select("feedback_rating")
    .eq("session_id", sessionId)
    .not("feedback_rating", "is", null);
  return data;
}

export async function countParticipants(sessionId, { status, attended } = {}) {
  let query = db
    .from("session_participants")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);
  if (status) query = query.eq("status", status);
  if (attended) query = query.eq("attended", attended);
  const { count } = await query;
  return count;
}

export async function listRegisteredParticipantsWithUsers(sessionId) {
  const { data } = await db
    .from("session_participants")
    .select("user_id, users(email, full_name, phone)")
    .eq("session_id", sessionId)
    .eq("status", "registered");
  return data;
}

export async function listAttendedParticipantsWithUsers(sessionId) {
  const { data } = await db
    .from("session_participants")
    .select("user_id, users(email, full_name)")
    .eq("session_id", sessionId)
    .eq("attended", true);
  return data;
}

// ─── § WAITLIST ───────────────────────────────────────────────────────────────

export async function countWaitlist(sessionId) {
  const { count } = await db
    .from("session_waitlist")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);
  return count;
}

export async function insertWaitlist(row) {
  await db.from("session_waitlist").insert(row);
}

export async function upsertWaitlist(sessionId, userId) {
  await db.from("session_waitlist").upsert(
    { session_id: sessionId, user_id: userId },
    { onConflict: "session_id,user_id" },
  );
}

// ─── § ENROLMENTS ─────────────────────────────────────────────────────────────

export async function findActiveEnrollment(userId, courseId) {
  const { data } = await db
    .from("enrollments")
    .select("id")
    .eq("user_id", userId)
    .eq("course_id", courseId)
    .eq("status", "active")
    .single();
  return data;
}

export async function findActiveEnrollmentMaybe(userId, courseId) {
  const { data } = await db
    .from("enrollments")
    .select("id").eq("user_id", userId).eq("course_id", courseId).eq("status", "active").maybeSingle();
  return data;
}

export async function listEnrolledUserIds(courseId) {
  const { data } = await db
    .from("enrollments").select("user_id")
    .eq("course_id", courseId).eq("status", "active");
  return data;
}

// ─── § ANALYTICS ──────────────────────────────────────────────────────────────

export async function insertAnalytics(row) {
  await db.from("session_analytics").insert(row);
}

export async function updateAnalytics(sessionId, updates) {
  await db.from("session_analytics").update(updates).eq("session_id", sessionId);
}

export async function raisePeakConcurrent(sessionId, count) {
  await db
    .from("session_analytics")
    .update({ peak_concurrent: count })
    .eq("session_id", sessionId)
    .lt("peak_concurrent", count);
}

export async function getAnalytics(sessionId) {
  return db
    .from("session_analytics")
    .select("*")
    .eq("session_id", sessionId)
    .single();
}

// ─── § DASHBOARDS ─────────────────────────────────────────────────────────────

export async function listStudentSessions(userId) {
  return db
    .from("session_participants")
    .select(`
      status,
      live_sessions (
        id, title, description, topic, session_type,
        scheduled_start, status, join_url, platform,
        courses ( id, title, cover_image_url ),
        users!live_sessions_instructor_id_fkey ( full_name, avatar_url )
      )
    `)
    .eq("user_id", userId)
    .in("live_sessions.status", ["scheduled", "live"])
    .order("live_sessions.scheduled_start", { ascending: true })
    .limit(10);
}

// ─── § CURRICULUM ─────────────────────────────────────────────────────────────

export async function findCurriculumCourse(courseId) {
  const { data } = await db
    .from("courses")
    .select("id, title, description, cover_image_url, instructor_id")
    .eq("id", courseId)
    .maybeSingle();
  return data;
}

export async function listCourseModules(courseId) {
  const { data } = await db
    .from("course_modules").select("id, title, description, order_index")
    .eq("course_id", courseId).order("order_index", { ascending: true });
  return data;
}

export async function listCurriculumSessions(courseId) {
  const { data } = await db.from("live_sessions")
    .select(`
      id, title, topic, description, session_type, module_id, order_index,
      scheduled_start, scheduled_end, status, platform, join_url, meeting_password,
      recording_url, max_participants, current_participants
    `)
    .eq("course_id", courseId)
    .order("scheduled_start", { ascending: true });
  return data;
}

export async function listParticipantStatuses(userId, sessionIds) {
  const { data } = await db.from("session_participants")
    .select("session_id, status").eq("user_id", userId).in("session_id", sessionIds);
  return data;
}

export async function listSessionMaterials(sessionIds) {
  const { data } = await db.from("session_materials")
    .select("id, session_id, title, kind, url, order_index")
    .in("session_id", sessionIds)
    .order("order_index", { ascending: true });
  return data;
}

// ─── § REPLAY ─────────────────────────────────────────────────────────────────

export async function getReplaySession(sessionId) {
  return db
    .from("live_sessions")
    .select("id, course_id, title, recording_url, status, instructor_id, scheduled_start, scheduled_end, actual_start, actual_end")
    .eq("id", sessionId)
    .single();
}
