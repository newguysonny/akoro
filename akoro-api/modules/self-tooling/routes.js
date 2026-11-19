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
import db from "../../db.js";
import { BUILTIN_DATA_VIEWS, DATA_VIEWS, dbViewNameSet } from "./views.js";
import { validateViewShape, validateViewForActivation, normalizeViewSpec } from "./viewSpecs.js";
import { refreshDbViews, viewRegistryStatus } from "./viewRegistry.js";
import { agentDeps } from "../../lib/agentDeps.js";

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
// nothing is posted into the chat by the server. The agent's await_decision
// tool call applies what was approved and narrates the outcome itself — in
// the live turn when one is waiting, and otherwise in a continuation turn
// the tap itself starts (Option A, 2026-11-17: no waiting for the learner's
// next message).
router.post("/confirmations/:id/reject", authenticateToken, confirmationRoute(async (req) => {
  return decideConfirmation({ id: req.params.id, userId: req.user.id, decision: "rejected" });
}));
router.post("/confirmations/:id/confirm", authenticateToken, confirmationRoute(async (req) => {
  const decided = await decideConfirmation({ id: req.params.id, userId: req.user.id, decision: "approved" });
  if (decided?.sessionId) {
    const { scheduleDecisionContinuation } = agentDeps();
    scheduleDecisionContinuation({ userId: req.user.id, user: req.user, sessionId: decided.sessionId });
  }
  return decided;
}));

// ── Data-driven Data View registry (admin, 2026-11-18) ───────────────────
// Stored specs in edu.self_tool_views extend what learners' agents can
// build tools over, with no code deploy. A spec may only be ACTIVATED after
// it validates against the live database schema (viewSpecs.js); activation
// and disabling take effect on the next registry refresh, forced here so
// the change is immediate. Built-in views are code-owned and read-only here.
const eduViews = () => db.schema("edu");
const adminOnly = (req, res) => {
  if (req.user?.role === "admin") return true;
  res.status(403).json({ success: false, error: "Admin only" });
  return false;
};
const viewNameOk = (name) => /^[a-z][a-z0-9_]{2,47}$/.test(String(name || ""));

router.get("/views", authenticateToken, asyncHandler(async (req, res) => {
  if (!adminOnly(req, res)) return;
  const { data } = await eduViews().from("self_tool_views").select("name, spec, status, origin, note, proposed_by, approved_by, approved_at, created_at, updated_at").order("created_at", { ascending: false });
  const live = dbViewNameSet();
  res.json({ success: true, data: {
    registry: viewRegistryStatus(),
    builtins: Object.keys(BUILTIN_DATA_VIEWS).map((name) => ({ name, origin: "builtin", live: name in DATA_VIEWS })),
    stored: (data || []).map((r) => ({ ...r, live: live.has(r.name) })),
  } });
}));

router.post("/views", authenticateToken, asyncHandler(async (req, res) => {
  if (!adminOnly(req, res)) return;
  const { name, spec, note, activate } = req.body || {};
  if (!viewNameOk(name)) return res.status(400).json({ success: false, error: "Bad view name" });
  if (name in BUILTIN_DATA_VIEWS) return res.status(409).json({ success: false, error: `"${name}" is a built-in view — stored views are additions only` });
  const shape = validateViewShape(name, spec);
  if (!shape.ok) return res.status(400).json({ success: false, error: shape.errors.join("; ") });
  let stored = normalizeViewSpec(spec);
  if (activate) {
    const gate = await validateViewForActivation(name, spec);
    if (!gate.ok) return res.status(400).json({ success: false, error: gate.errors.join("; ") });
    stored = gate.spec;
  }
  const { data, error } = await eduViews().from("self_tool_views").insert({
    name, spec: stored, status: activate ? "active" : "proposed", origin: "admin",
    note: typeof note === "string" ? note.slice(0, 500) : null,
    proposed_by: req.user.id,
    ...(activate ? { approved_by: req.user.id, approved_at: new Date().toISOString() } : {}),
    updated_at: new Date().toISOString(),
  }).select("name, status").single();
  if (error) return res.status(error.code === "23505" ? 409 : 500).json({ success: false, error: error.message });
  if (activate) await refreshDbViews();
  res.json({ success: true, data });
}));

router.post("/views/:name/approve", authenticateToken, asyncHandler(async (req, res) => {
  if (!adminOnly(req, res)) return;
  if (!viewNameOk(req.params.name)) return res.status(400).json({ success: false, error: "Bad view name" });
  const { data: row } = await eduViews().from("self_tool_views").select("name, spec, status").eq("name", req.params.name).maybeSingle();
  if (!row) return res.status(404).json({ success: false, error: "No such stored view" });
  const gate = await validateViewForActivation(row.name, row.spec);
  if (!gate.ok) return res.status(400).json({ success: false, error: gate.errors.join("; ") });
  const { error } = await eduViews().from("self_tool_views").update({
    spec: gate.spec, status: "active", approved_by: req.user.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("name", row.name);
  if (error) return res.status(500).json({ success: false, error: error.message });
  await refreshDbViews();
  res.json({ success: true, data: { name: row.name, status: "active", live: dbViewNameSet().has(row.name) } });
}));

router.post("/views/:name/disable", authenticateToken, asyncHandler(async (req, res) => {
  if (!adminOnly(req, res)) return;
  if (!viewNameOk(req.params.name)) return res.status(400).json({ success: false, error: "Bad view name" });
  const { error } = await eduViews().from("self_tool_views").update({ status: "disabled", updated_at: new Date().toISOString() }).eq("name", req.params.name);
  if (error) return res.status(500).json({ success: false, error: error.message });
  await refreshDbViews();
  res.json({ success: true, data: { name: req.params.name, status: "disabled", live: dbViewNameSet().has(req.params.name) } });
}));

export default router;
