/**
 * modules/learner-goals/routes.js — the learner's educational goals.
 *
 * The data spine of Full Autonomy (docs/learner-full-autonomy-plan.md):
 * the nightly cycle reads these to align every proposal, and progress is
 * reported against them. CRUD is the learner's own; the agent NEVER writes
 * here directly — 'agent'-sourced rows appear only when the learner
 * approves a proposal (human-in-the-loop, same as every autonomous action).
 */
import { Router } from "express";
import db from "../../db.js";
import { authenticateToken } from "../auth/routes.js";

const router = Router();
const edu = () => db.schema("edu");

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok  = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const bad = (res, m) => res.status(400).json({ success: false, error: m });
const notFound = (res) => res.status(404).json({ success: false, error: "Not found" });

const GOAL_STATUSES = ["active", "paused", "achieved", "dismissed"];
const MAX_ACTIVE_GOALS = 10;

const clean = (v, max) => {
  const s = String(v ?? "").trim();
  return (s && s.length <= max) ? s : null;
};

/* GET / — my goals (active first, then paused/achieved; newest first). */
router.get("/", authenticateToken, asyncHandler(async (req, res) => {
  const { data, error } = await edu().from("learner_goals")
    .select("*")
    .eq("user_id", req.user.id)
    .in("status", ["active", "paused", "achieved"])
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) return res.status(503).json({ success: false, error: "Could not load goals" });
  const rows = data || [];
  rows.sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1));
  ok(res, rows);
}));

/* POST / — create a goal (the learner's own; agent rows arrive via approval). */
router.post("/", authenticateToken, asyncHandler(async (req, res) => {
  const title = clean(req.body?.title, 120);
  if (!title) return bad(res, "Give the goal a title (max 120 characters).");

  const { count: activeCount, error: countError } = await edu().from("learner_goals")
    .select("id", { count: "exact", head: true })
    .eq("user_id", req.user.id).eq("status", "active");
  if (countError) return res.status(503).json({ success: false, error: "Could not check your goals" });
  if ((activeCount ?? 0) >= MAX_ACTIVE_GOALS) {
    return bad(res, `You already have ${MAX_ACTIVE_GOALS} active goals — achieve, pause or remove one first.`);
  }

  let targetDate = null;
  if (req.body?.target_date) {
    const d = new Date(req.body.target_date);
    if (Number.isNaN(d.getTime())) return bad(res, "The target date could not be parsed.");
    targetDate = d.toISOString().slice(0, 10);
  }

  const { data, error } = await edu().from("learner_goals")
    .insert({
      user_id: req.user.id,
      title,
      category: clean(req.body?.category, 40),
      metric:   clean(req.body?.metric, 160),
      exam:     clean(req.body?.exam, 40),
      target_date: targetDate,
      source: "learner",
    })
    .select("*")
    .single();
  if (error) return res.status(503).json({ success: false, error: "Could not save the goal" });
  ok(res, data, { created: true });
}));

/* PATCH /:id — edit or re-status my goal (achieve, pause, reactivate…). */
router.patch("/:id", authenticateToken, asyncHandler(async (req, res) => {
  const { data: row } = await edu().from("learner_goals")
    .select("id").eq("id", req.params.id).eq("user_id", req.user.id).maybeSingle();
  if (!row) return notFound(res);

  const patch = { updated_at: new Date().toISOString() };
  if (req.body?.title !== undefined) {
    const title = clean(req.body.title, 120);
    if (!title) return bad(res, "Give the goal a title (max 120 characters).");
    patch.title = title;
  }
  for (const f of ["category", "metric", "exam", "progress_note"]) {
    if (req.body?.[f] !== undefined) patch[f] = clean(req.body[f], f === "metric" ? 160 : f === "progress_note" ? 500 : 40);
  }
  if (req.body?.target_date !== undefined) {
    if (req.body.target_date === null || req.body.target_date === "") patch.target_date = null;
    else {
      const d = new Date(req.body.target_date);
      if (Number.isNaN(d.getTime())) return bad(res, "The target date could not be parsed.");
      patch.target_date = d.toISOString().slice(0, 10);
    }
  }
  if (req.body?.status !== undefined) {
    if (!GOAL_STATUSES.includes(req.body.status)) return bad(res, "Unknown goal status.");
    patch.status = req.body.status;
  }

  const { data, error } = await edu().from("learner_goals")
    .update(patch).eq("id", row.id).select("*").single();
  if (error) return res.status(503).json({ success: false, error: "Could not update the goal" });
  ok(res, data);
}));

/* DELETE /:id — remove my goal entirely. */
router.delete("/:id", authenticateToken, asyncHandler(async (req, res) => {
  const { data, error } = await edu().from("learner_goals")
    .delete().eq("id", req.params.id).eq("user_id", req.user.id).select("id");
  if (error) return res.status(503).json({ success: false, error: "Could not remove the goal" });
  if (!data?.length) return notFound(res);
  ok(res, { removed: data[0].id });
}));

export default router;
