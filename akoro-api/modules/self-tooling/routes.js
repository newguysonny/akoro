/**
 * modules/self-tooling/routes.js — the learner's own tools (Settings → Agent → My tools).
 *   GET   /api/self-tooling/tools          { enabled, tools: [...] }
 *   PATCH /api/self-tooling/tools/:id      { label? | status: active|disabled | delete: true }
 *   GET   /api/self-tooling/requests       permissions the agent asked an admin for (S3)
 *   POST  /api/self-tooling/requests/:id/cancel   withdraw a waiting one
 *   GET   /api/self-tooling/confirmations            changes still waiting for the learner (resurface after reload)
 *   GET   /api/self-tooling/confirmations/:id        a change a tool proposed (S6)
 *   POST  /api/self-tooling/confirmations/:id/confirm | /reject   ONLY the learner's tap runs a write (or, on a
 *         permission card, turns the change on for them and builds the tool)
 * No definitions or internal names are returned (rule 36) — label, goal, status, usage.
 */
import express from "express";
import { authenticateToken } from "../auth/routes.js";
import { listMyTools, updateMyTool } from "./pipeline.js";
import { selfToolingAllowedFor } from "./access.js";
import { listMyRequests, cancelMyRequest } from "./escalation.js";
import { getConfirmation, confirmWrite, rejectWrite, listPendingConfirmations } from "./confirmations.js";

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/tools", authenticateToken, asyncHandler(async (req, res) => {
  const enabled = await selfToolingAllowedFor(req.user.id);
  const tools = enabled ? await listMyTools(req.user.id) : [];
  res.json({ success: true, data: { enabled, tools: tools.map((t) => ({ id: t.id, label: t.label, goal: t.goal, status: t.status, uses: t.usage_count, lastUsedAt: t.last_used_at, createdAt: t.created_at })) } });
}));

router.patch("/tools/:id", authenticateToken, asyncHandler(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ success: false, error: "Bad tool id" });
  try {
    const t = await updateMyTool(req.user.id, req.params.id, req.body || {});
    res.json({ success: true, data: { id: t.id, label: t.label, status: t.status } });
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
router.post("/confirmations/:id/reject", authenticateToken, confirmationRoute((req) => rejectWrite({ id: req.params.id, userId: req.user.id })));
router.post("/confirmations/:id/confirm", authenticateToken, confirmationRoute(async (req) => {
  const [{ executeChatTool, selfToolDeps }, { createTool }, { postIntoChat }] = await Promise.all([
    import("../adaptive-learning/chat.js"), import("./pipeline.js"), import("./escalation.js")]);
  return confirmWrite({ id: req.params.id, userId: req.user.id,
    callTool: (tool, args) => executeChatTool(tool, args, req.user.id, { role: "student", channel: "self_tooling_confirmed" }),
    // A permission card: approving builds the tool, as this learner.
    buildTool: (args) => createTool({ ...args, ...selfToolDeps(req.user.id, "student") }), postIntoChat,
    toolDeps: selfToolDeps(req.user.id, "student") });
}));

export default router;
