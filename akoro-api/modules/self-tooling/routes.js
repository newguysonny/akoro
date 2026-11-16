/**
 * modules/self-tooling/routes.js — the learner's own tools (Settings → Agent → My tools).
 *   GET   /api/self-tooling/tools          { enabled, tools: [...] }
 *   PATCH /api/self-tooling/tools/:id      { label? | status: active|disabled | delete: true |
 *                                            action + actionStatus: active|disabled | deleteAction }
 *   GET   /api/self-tooling/requests       permissions the agent asked an admin for (S3)
 *   POST  /api/self-tooling/requests/:id/cancel   withdraw a waiting one
 *   GET   /api/self-tooling/confirmations            changes still waiting for the learner (resurface after reload)
 *   GET   /api/self-tooling/confirmations/:id        a change a tool proposed (S6)
 *   POST  /api/self-tooling/confirmations/:id/confirm | /reject   the learner's tap records the decision only; the agent's
 *         await_decision call applies it and narrates the outcome (no server post)
 * No definitions or internal names are returned (rule 36) — label, goal, status, usage.
 */
import express from "express";
import { authenticateToken } from "../auth/routes.js";
import { listMyTools, updateMyTool } from "./pipeline.js";
import { selfToolingAllowedFor } from "./access.js";
import { listMyRequests, cancelMyRequest } from "./escalation.js";
import { getConfirmation, decideConfirmation, listPendingConfirmations } from "./confirmations.js";

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/tools", authenticateToken, asyncHandler(async (req, res) => {
  const enabled = await selfToolingAllowedFor(req.user.id);
  const tools = enabled ? await listMyTools(req.user.id) : [];
  res.json({ success: true, data: { enabled, tools: tools.map((t) => ({ id: t.id, label: t.label, goal: t.goal, status: t.status, uses: t.usage_count, lastUsedAt: t.last_used_at, createdAt: t.created_at, domain: t.domain || null, actions: t.actions || [], disabledActions: t.disabled_actions || [], area: t.area || null, secondaryAreas: t.secondary_areas || [], tags: t.tags || [] })) } });
}));

router.patch("/tools/:id", authenticateToken, asyncHandler(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ success: false, error: "Bad tool id" });
  try {
    const t = await updateMyTool(req.user.id, req.params.id, req.body || {});
    res.json({ success: true, data: { id: t.id, label: t.label, status: t.status, domain: t.domain || null, actions: t.actions || [], disabledActions: t.disabled_actions || [], area: t.area || null, secondaryAreas: t.secondary_areas || [], tags: t.tags || [] } });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
}));

router.get("/requests", authenticateToken, asyncHandler(async (req, res) => {
  res.json({ success: true, data: { requests: await listMyRequests(req.user.id) } });
}));

router.post("/requests/:id/cancel", authenticateToken, asyncHandler(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ success: false, error: "Bad request id" });
  try {
    await cancelMyRequest(req.user.id, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
}));

const confirmationRoute = (fn) => asyncHandler(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ success: false, error: "Bad confirmation id" });
  try { res.json({ success: true, data: await fn(req) }); }
  catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});
router.get("/confirmations", authenticateToken, asyncHandler(async (req, res) => {
  res.json({ success: true, data: { pending: await listPendingConfirmations(req.user.id) } });
}));
router.get("/confirmations/:id", authenticateToken, confirmationRoute((req) => getConfirmation(req.params.id, req.user.id)));
// The tap records ONLY the decision (2026-11-16): nothing executes here and
// nothing is posted into the chat. The agent's await_decision tool call —
// in the live turn, or the next turn in that chat — applies what was
// approved and narrates the outcome itself.
router.post("/confirmations/:id/reject", authenticateToken, confirmationRoute(async (req) => {
  return decideConfirmation({ id: req.params.id, userId: req.user.id, decision: "rejected" });
}));
router.post("/confirmations/:id/confirm", authenticateToken, confirmationRoute(async (req) => {
  return decideConfirmation({ id: req.params.id, userId: req.user.id, decision: "approved" });
}));

export default router;
