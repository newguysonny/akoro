/**
 * Admin tool library for self-tooling (plan §7.12, phase S4).
 *
 *   GET  /api/admin/agent-tools?scope=&status=&mode=&search=&limit=&offset=
 *   GET  /api/admin/agent-tools/similar          merge candidates
 *   GET  /api/admin/agent-tools/:id              definition + verification
 *   POST /api/admin/agent-tools/:id/status       { status: active|disabled|revoked }
 *   POST /api/admin/agent-tools/:id/promote      { name?, label?, goal?, replaces?: [ids] }
 *   GET  /api/admin/self-tooling/analytics?days=
 *   GET  /api/admin/self-tooling/audit?days=&limit=   builds and changes, each asked or inferred (+ rule)
 *   GET  /api/admin/agent-capabilities/tools      built-in + promoted, with examples
 *   GET  /api/admin/agent-capabilities/features   what the agent does that isn't a tool
 *
 * Promotion runs the gate scenario selftool.promotion_check first and only
 * goes through on PASS; the run id is stored with the platform tool.
 */
import { Router } from "express";

import { authenticateToken, requireRole } from "../auth/index.js";
import { agentFeaturesCatalogue, agentToolsCatalogue } from "../agent-capabilities/index.js";
import { listTools, getTool, setToolStatus, promoteTool, similarTools, analytics, auditRows } from "../self-tooling/index.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  if (e.status) return res.status(e.status).json({ success: false, error: e.message, ...(e.runId ? { runId: e.runId, verdict: e.verdict } : {}) });
  return next(e);
});
const adminActor = (req) => ({ id: req.user?.id ?? null, label: req.user?.full_name || req.user?.email || "admin" });
const badId = (res) => res.status(422).json({ success: false, error: "id is invalid" });

router.get("/agent-tools", adminOnly, asyncHandler(async (req, res) => {
  const out = await listTools({
    scope: req.query.scope, status: req.query.status, mode: req.query.mode, search: req.query.search,
    limit: Number.parseInt(req.query.limit, 10) || 50, offset: Math.max(0, Number.parseInt(req.query.offset, 10) || 0),
  });
  res.json({ success: true, ...out });
}));

router.get("/agent-tools/similar", adminOnly, asyncHandler(async (_req, res) => {
  res.json({ success: true, groups: await similarTools() });
}));

router.get("/agent-tools/:id", adminOnly, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return badId(res);
  res.json({ success: true, tool: await getTool(req.params.id) });
}));

router.post("/agent-tools/:id/status", adminOnly, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return badId(res);
  res.json({ success: true, tool: await setToolStatus({ id: req.params.id, status: String(req.body?.status || ""), admin: adminActor(req) }) });
}));

router.post("/agent-tools/:id/promote", adminOnly, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return badId(res);
  const [{ startRun }, { selfToolDeps }] = await Promise.all([import("../verify/index.js"), import("../adaptive-learning/index.js")]);
  const out = await promoteTool({
    id: req.params.id, name: req.body?.name, label: req.body?.label, goal: req.body?.goal,
    replaces: Array.isArray(req.body?.replaces) ? req.body.replaces.filter((x) => UUID.test(String(x))) : [],
    admin: adminActor(req), builtIn: selfToolDeps(null).builtIn,
    // An instructor tool is checked on the instructor testers, as an instructor (S7).
    runGate: async (toolId, audience) => startRun({ scenario: "selftool.promotion_check", actor: "admin",
      params: { toolId, ...(audience === "instructor" ? { testers: ["@tester51", "@tester52"] } : {}) } }).done,
  });
  res.json({ success: true, ...out });
}));

router.get("/self-tooling/analytics", adminOnly, asyncHandler(async (req, res) => {
  res.json({ success: true, analytics: await analytics({ days: req.query.days }) });
}));

router.get("/self-tooling/audit", adminOnly, asyncHandler(async (req, res) => {
  res.json({ success: true, rows: await auditRows({ days: req.query.days, limit: req.query.limit }) });
}));

router.get("/agent-capabilities/tools", adminOnly, asyncHandler(async (_req, res) => {
  res.json({ success: true, ...await agentToolsCatalogue() });
}));

router.get("/agent-capabilities/features", adminOnly, asyncHandler(async (_req, res) => {
  res.json({ success: true, ...await agentFeaturesCatalogue() });
}));

export default router;
