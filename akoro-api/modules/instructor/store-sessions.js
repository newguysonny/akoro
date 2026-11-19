/**
 * instructor/store-sessions.js — every query the instructor routes make
 * against live sessions. No Express, no policy.
 */
import db from "../../db.js";

export const sessionsForCourses = (courseIds) =>
  db.from("live_sessions")
    .select(`
      id, title, description, session_type, module_id, order_index,
      scheduled_start, scheduled_end, status, platform, meeting_url,
      max_participants, current_participants, recording_url, course_id,
      courses ( id, title )
    `)
    .in("course_id", courseIds)
    .order("scheduled_start", { ascending: false });

export const sessionsForModules = (moduleIds) =>
  db.from("live_sessions").select("*").in("module_id", moduleIds)
    .order("scheduled_start", { ascending: true });

export const sessionWithOwner = (id) =>
  db.from("live_sessions").select("id, course_id, instructor_id").eq("id", id).single();

export const sessionCourseRef = (id) =>
  db.from("live_sessions").select("id, course_id").eq("id", id).single();

export const sessionOwnerRef = (id) =>
  db.from("live_sessions").select("id, course_id").eq("id", id).maybeSingle();

export const insertSession = (row) =>
  db.from("live_sessions").insert(row).select().single();

export const updateSession = (id, updates) =>
  db.from("live_sessions").update(updates).eq("id", id).select().single();

export const deleteSession = (id) =>
  db.from("live_sessions").delete().eq("id", id);
