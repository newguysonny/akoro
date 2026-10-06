/**
 * modules/pharmd/routes.js — the PHARM.D programme catalogue API
 *
 * Backs the learner app's Pharm D discovery pages with the tables
 * seeded by migrations/2026-pharmd-courses.sql and filled by
 * scripts/upload-pharmd-courses.mjs:
 *
 *   GET  /programme           → the programme tree: years → courses
 *                               with topic counts. Public — a course
 *                               catalogue is browseable like
 *                               /api/courses/published.
 *   GET  /courses/:code       → one course + its topics, each with
 *                               the public PDF url. Public.
 *   GET  /progress            → my completed topic ids (learner).
 *   POST /topics/:id/complete → mark a topic done / undone
 *                               ({ done: true|false }). Learner.
 *
 * Everything below /programme and /courses/:code is behind
 * authenticateToken — completion is per-learner state
 * (edu.pharmd_topic_progress), and the frontend reads it once for
 * the whole programme (the folder's done-checks).
 *
 * Mounted at /api/pharmd (app.js).
 */
import { Router }             from "express";
import db                     from "../../db.js";
import { authenticateToken }  from "../auth/routes.js";

const edu = () => db.schema("edu");

const router = Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok  = (res, data)  => res.json({ success: true, data });
const bad = (res, m)     => res.status(400).json({ success: false, error: m });
const missing = (res, m) => res.status(404).json({ success: false, error: m });

/* The public URL of a topic's PDF — bucket objects are public, so
   this is a pure string build (no storage round-trip). */
const publicFileUrl = (bucket, path) =>
  path ? db.storage.from(bucket || "pharmd-courses").getPublicUrl(path).data.publicUrl : null;

/* ── Programme tree — the browse view ─────────────────────────── */
router.get("/programme", asyncHandler(async (_req, res) => {
  const { data: programme } = await edu().from("pharmd_programmes")
    .select("id, code, name, subtitle").eq("code", "PHARMD").maybeSingle();
  if (!programme) return bad(res, "No PHARM.D programme yet — run the migrations.");

  const [{ data: years }, { data: courses }] = await Promise.all([
    edu().from("pharmd_years").select("id, number, label")
      .eq("programme_id", programme.id).order("number"),
    edu().from("pharmd_courses").select("id, code, title, year_id, sort_order")
      .eq("programme_id", programme.id).order("sort_order"),
  ]);

  // Topic counts per course in one query (the pilot is ~130 rows).
  const ids = (courses ?? []).map((c) => c.id);
  const { data: topicRows } = ids.length
    ? await edu().from("pharmd_topics").select("course_id").in("course_id", ids)
    : { data: [] };
  const countByCourse = new Map();
  for (const row of topicRows ?? []) countByCourse.set(row.course_id, (countByCourse.get(row.course_id) ?? 0) + 1);

  ok(res, {
    programme: { code: programme.code, name: programme.name, subtitle: programme.subtitle },
    years: (years ?? []).map((y) => ({
      number: y.number,
      label: y.label,
      courses: (courses ?? []).filter((c) => c.year_id === y.id).map((c) => ({
        id: c.id,
        code: c.code,
        title: c.title || c.code,
        topics: countByCourse.get(c.id) ?? 0,
      })),
    })),
  });
}));

/* ── One course + its topics — the folder view ────────────────── */
router.get("/courses/:code", asyncHandler(async (req, res) => {
  const { data: course } = await edu().from("pharmd_courses")
    .select("id, code, title, programme_id").eq("code", req.params.code).maybeSingle();
  if (!course) return missing(res, "Course not found");

  const { data: topics } = await edu().from("pharmd_topics")
    .select("id, position, title, read_minutes, file_bucket, file_path, file_mime, file_size")
    .eq("course_id", course.id).order("position");

  ok(res, {
    course: { id: course.id, code: course.code, title: course.title || course.code },
    topics: (topics ?? []).map((t) => ({
      id: t.id,
      position: t.position,
      title: t.title,
      read_minutes: t.read_minutes,
      mime: t.file_mime,
      size: t.file_size,
      file_url: publicFileUrl(t.file_bucket, t.file_path),
    })),
  });
}));

/* ── Learner state — everything below needs a signed-in learner ── */
router.use(authenticateToken);

router.get("/progress", asyncHandler(async (req, res) => {
  const { data } = await edu().from("pharmd_topic_progress")
    .select("topic_id").eq("user_id", req.user.id).eq("done", true);
  ok(res, { done: (data ?? []).map((r) => r.topic_id) });
}));

router.post("/topics/:id/complete", asyncHandler(async (req, res) => {
  const done = req.body?.done !== false;   // absent = true (an explicit "mark done")
  const { data: topic } = await edu().from("pharmd_topics")
    .select("id").eq("id", req.params.id).maybeSingle();
  if (!topic) return missing(res, "Topic not found");

  if (done) {
    const { error } = await edu().from("pharmd_topic_progress").upsert({
      user_id: req.user.id, topic_id: topic.id, done: true, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,topic_id" });
    if (error) return bad(res, "Could not save that — try again.");
  } else {
    const { error } = await edu().from("pharmd_topic_progress")
      .delete().eq("user_id", req.user.id).eq("topic_id", topic.id);
    if (error) return bad(res, "Could not save that — try again.");
  }
  ok(res, { topic_id: topic.id, done });
}));

export default router;
