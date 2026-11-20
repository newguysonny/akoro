/**
 * modules/self-study/draft-store.js — Supabase queries behind activity
 * drafts: classroom lookup, the lazy TTL sweep and the open-draft cap.
 */

import db from "../../db.js";
import { invalid } from "./createAssignment.js";
import { DRAFT_TTL_DAYS } from "./draft-rules.js";

/** Find the instructor's classroom by loose name ("my jss2 class" → id). */
// Classrooms an instructor can assign to. Ownership is `teacher_id` (the
// seeded/bench path) OR `created_by` (rows created by other tools) — filtering
// by created_by alone made every seeded class invisible to the agent, which
// surfaced as "there are no classes listed in my system for you".
export async function instructorClassrooms(instructorId) {
  // created_by did not always exist on classrooms — if the combined filter
  // runs on a not-yet-migrated env it ERRORS, so fall back to teacher_id
  // instead of quietly answering "no classes".
  let data, error;
  ({ data, error } = await db.from("classrooms").select("id, name")
    .or(`teacher_id.eq.${instructorId},created_by.eq.${instructorId}`)
    .order("created_at", { ascending: true }).limit(50));
  if (error) {
    ({ data, error } = await db.from("classrooms").select("id, name")
      .eq("teacher_id", instructorId).order("created_at", { ascending: true }).limit(50));
  }
  if (error) throw invalid(error.message, 500);
  return data ?? [];
}

export async function resolveClassroomByName(instructorId, name) {
  const q = String(name || "").trim();
  if (!q) return null;
  let data;
  try {
    // Supabase builders are thenables WITHOUT .catch — errors must be
    // handled by try/catch around the await (chaining .catch here threw
    // 'catch is not a function' and killed every prepare that named a class).
    ({ data } = await db.from("classrooms")
      .select("id, name").or(`teacher_id.eq.${instructorId},created_by.eq.${instructorId}`).ilike("name", `%${q}%`).limit(1));
  } catch {
    ({ data } = await db.from("classrooms")
      .select("id, name").eq("teacher_id", instructorId).ilike("name", `%${q}%`).limit(1));
  }
  if (!data) {
    ({ data } = await db.from("classrooms")
      .select("id, name").eq("teacher_id", instructorId).ilike("name", `%${q}%`).limit(1));
  }
  if (data?.length) return data[0];
  // School admins may not own classrooms directly — try their school scope.
  const { data: school } = await db.from("school_profiles")
    .select("id").eq("admin_user_id", instructorId).limit(1).maybeSingle();
  if (school?.id) {
    const { data: sc } = await db.from("classrooms")
      .select("id, name").eq("school_id", school.id).ilike("name", `%${q}%`).limit(1);
    if (sc?.length) return sc[0];
  }
  return null;
}

/** A classroom's name (the preview's "Class" row) — null when it can't be read. */
export async function classroomName(id) {
  if (!id) return null;
  try {
    const { data } = await db.from("classrooms").select("name").eq("id", id).maybeSingle();
    return data?.name || null;
  } catch { return null; }
}

/**
 * expireStaleDrafts — lazy TTL sweep; a stale pending draft is never shown
 * and never assignable. Runs on read, so no worker is needed.
 */
export async function expireStaleDrafts(instructorId) {
  const cutoff = new Date(Date.now() - DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.from("activity_drafts")
    .update({ status: "expired", resolved_at: new Date().toISOString() })
    .eq("created_by", instructorId).eq("status", "draft").lt("created_at", cutoff);
}

/** Cap open drafts per instructor; the oldest quietly expires to make room. */
export async function enforceDraftCap(instructorId, cap = 20) {
  const { data } = await db.from("activity_drafts")
    .select("id").eq("created_by", instructorId).eq("status", "draft")
    .order("created_at", { ascending: true });
  const rows = data ?? [];
  if (rows.length < cap) return;
  const excess = rows.slice(0, rows.length - cap + 1);
  await db.from("activity_drafts")
    .update({ status: "expired", resolved_at: new Date().toISOString() })
    .in("id", excess.map(r => r.id));
}
