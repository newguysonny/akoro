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
import { listGoals, createGoal, updateGoal } from "./service.js";

const router = Router();

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok  = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const bad = (res, m, status = 400) => res.status(status).json({ success: false, error: m });
const notFound = (res) => res.status(404).json({ success: false, error: "Not found" });

/* GET / — my goals (active first, then paused/achieved; newest first). */
router.get("/", authenticateToken, asyncHandler(async (req, res) => {
  const { goals, error, status } = await listGoals(req.user.id);
  if (error) return bad(res, error, status ?? 503);
  ok(res, goals);
}));

/* POST / — create a goal (the learner's own; agent rows arrive via approval). */
router.post("/", authenticateToken, asyncHandler(async (req, res) => {
  const { goal, error, status } = await createGoal(req.user.id, req.body || {});
  if (error) return bad(res, error, status ?? 400);
  ok(res, goal, { created: true });
}));

/* PATCH /:id — edit or re-status my goal (achieve, pause, reactivate…). */
router.patch("/:id", authenticateToken, asyncHandler(async (req, res) => {
  const { goal, error, status, notFound: gone } = await updateGoal(req.user.id, req.params.id, req.body || {});
  if (gone) return notFound(res);
  if (error) return bad(res, error, status ?? 400);
  ok(res, goal);
}));

/* DELETE /:id — remove my goal entirely. */
router.delete("/:id", authenticateToken, asyncHandler(async (req, res) => {
  // Deletion stays a learner-owned UI action — the agent's tools never delete.
  const { data, error } = await db.schema("edu").from("learner_goals")
    .delete().eq("id", req.params.id).eq("user_id", req.user.id).select("id");
  if (error) return bad(res, "Could not remove the goal", 503);
  if (!data?.length) return notFound(res);
  ok(res, { removed: data[0].id });
}));

export default router;
