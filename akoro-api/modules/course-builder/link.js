/**
 * modules/course-builder/link.js — one course record (2026-10-20).
 *
 * Every course is ONE row in public.courses: the table learners, payments,
 * live sessions, materials and the agent's tools read. Course Creator is its
 * editor: edu.builder_courses keeps the outline (sections → lessons) and links
 * to that row by course_id.
 *
 *   created in Course Creator  → its courses row is made at once (unpublished),
 *                                so it can be scheduled from day one
 *   edited in Course Creator   → title, description, cover, type, level,
 *                                language and price follow on the courses row
 *   published (admin review)   → courses.is_published: learners can see it
 *   made on the old Courses page → adopted into My Courses: its modules become
 *                                sections, their lessons and live sessions
 *                                become lessons; its price is kept
 *
 * Prices: Course Creator speaks naira as text ('' unset | 'free' | '4500');
 * courses.price is kobo (payments and the cart read it so).
 */
import db from "../../db.js";

const edu = () => db.schema("edu");

import { builderFieldsFrom, courseFieldsFrom, lessonFromOld, lessonFromSession, slugify } from "./link-map.js";

export { builderFieldsFrom, courseFieldsFrom, lagosWallClock, lessonFromOld, lessonFromSession, priceFromDb, priceToDb, slugify } from "./link-map.js";

/* ── database operations ─────────────────────────────────────────────── */

/** Make the courses row for a new Course Creator course and link it. → the builder row */
export async function createLinkedCourse(builder) {
  const { data: course, error } = await db.from("courses").insert({
    instructor_id: builder.owner_id,
    slug: slugify(builder.title),
    ...courseFieldsFrom(builder),
    is_published: false,
  }).select("id").single();
  if (error) throw error;
  // Only if still unlinked: a request that lost a race removes its spare row (else it would be adopted as a copy).
  const { data: next, error: e2 } = await edu().from("builder_courses")
    .update({ course_id: course.id }).eq("id", builder.id).is("course_id", null).select("*").maybeSingle();
  if (e2 || !next) {
    await db.from("courses").delete().eq("id", course.id);
    if (e2) throw e2;
    const { data: current } = await edu().from("builder_courses").select("*").eq("id", builder.id).maybeSingle();
    return current || builder;
  }
  return next;
}

/** Carry Course Creator's edits onto the courses row (best effort: the builder row is already saved). */
export async function syncLinkedCourse(builder) {
  if (!builder?.course_id) return;
  const { error } = await db.from("courses")
    .update({ ...courseFieldsFrom(builder), updated_at: new Date().toISOString(), last_updated_at: new Date().toISOString() })
    .eq("id", builder.course_id);
  if (error) console.warn("[course-builder] course sync failed:", error.message);
}

/** Publishing in Course Creator is what learners see. */
export async function publishLinkedCourse(builder, published) {
  if (!builder?.course_id) return;
  const { error } = await db.from("courses").update({
    is_published: !!published,
    published_at: published ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", builder.course_id);
  if (error) console.warn("[course-builder] publish sync failed:", error.message);
}

/** A draft's courses row goes with it, unless learners are already on it (then it stays, unlinked). */
export async function removeLinkedCourse(builder) {
  if (!builder?.course_id) return;
  const [{ count: enrolled }, { count: sessions }] = await Promise.all([
    db.from("enrollments").select("id", { count: "exact", head: true }).eq("course_id", builder.course_id),
    db.from("live_sessions").select("id", { count: "exact", head: true }).eq("course_id", builder.course_id),
  ]);
  if ((enrolled ?? 0) > 0 || (sessions ?? 0) > 0) return;
  await db.from("courses").delete().eq("id", builder.course_id).eq("is_published", false);
}

/** Bring an old course's outline in: modules → sections; their lessons and live sessions → lessons. */
export async function importOutline(courseId, builderId) {
  const { data: modules } = await db.from("course_modules").select("*").eq("course_id", courseId).order("order_index");
  const mods = modules ?? [];
  if (!mods.length) return 0;
  const ids = mods.map((m) => m.id);
  const [{ data: lessons }, { data: sessions }] = await Promise.all([
    db.from("lessons").select("*").in("module_id", ids).order("order_index"),
    db.from("live_sessions").select("*").in("module_id", ids).order("scheduled_start"),
  ]);
  for (const [i, m] of mods.entries()) {
    const { data: sec, error } = await edu().from("builder_sections")
      .insert({ course_id: builderId, title: m.title || `Section ${i + 1}`, position: i }).select("id").single();
    if (error) throw error;
    const rows = [
      ...(lessons ?? []).filter((l) => l.module_id === m.id).map((l) => (pos) => lessonFromOld(l, pos)),
      ...(sessions ?? []).filter((s) => s.module_id === m.id).map((s) => (pos) => lessonFromSession(s, pos)),
    ].map((make, pos) => ({ ...make(pos), section_id: sec.id }));
    if (rows.length) {
      const { error: le } = await edu().from("builder_lessons").insert(rows);
      if (le) throw le;
    }
  }
  return mods.length;
}

/**
 * The owner's old courses (made on the Courses page) not yet in Course
 * Creator: adopt each one. Idempotent: builder_courses.course_id is unique,
 * so a second run (or a race) adds nothing.
 */
export async function adoptOldCourses(ownerId) {
  const [{ data: courses }, { data: linked }] = await Promise.all([
    db.from("courses").select("*").eq("instructor_id", ownerId),
    edu().from("builder_courses").select("course_id").eq("owner_id", ownerId).not("course_id", "is", null),
  ]);
  const have = new Set((linked ?? []).map((r) => r.course_id));
  let adopted = 0;
  for (const c of (courses ?? []).filter((x) => !have.has(x.id))) {
    const { data: b, error } = await edu().from("builder_courses").insert(builderFieldsFrom(c)).select("id").single();
    if (error) {
      if (error.code === "23505") continue; // adopted meanwhile
      throw error;
    }
    await importOutline(c.id, b.id).catch((e) => console.warn("[course-builder] outline import failed:", e.message));
    adopted += 1;
  }
  return adopted;
}

/** Course Creator courses made before the link existed: give each its courses row (published ones stay published). */
export async function linkUnlinked(ownerId) {
  const { data: rows } = await edu().from("builder_courses").select("*").eq("owner_id", ownerId).is("course_id", null);
  for (const b of rows ?? []) {
    const linked = await createLinkedCourse(b).catch((e) => { console.warn("[course-builder] backfill link failed:", e.message); return null; });
    if (linked && b.status === "published") await publishLinkedCourse(linked, true);
  }
  return (rows ?? []).length;
}
