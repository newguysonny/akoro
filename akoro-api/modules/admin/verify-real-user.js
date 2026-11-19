/**
 * Admin: Verification Gate checks on a REAL account (phase V4).
 *
 *   GET  /api/admin/verify/real-user-runs            { enabled, scenarios, runs }
 *   GET  /api/admin/verify/real-user-account?handle=  who that is (before approving)
 *   POST /api/admin/verify/real-user-runs             { account, scenario, reason } → approve + start
 *   GET  /api/admin/verify/real-user-runs/:id         one run: approval row + the gate's verdict
 *
 * Admin-only. This is the only way a gate run may write to a real account:
 * the gate API itself (coding agent key) never can. The owner is notified
 * after every run (in-app, email, SMS) and every run is audit-logged.
 */
import { Router } from "express";
import { authenticateToken, requireRole } from "../auth/index.js";
import { startRealUserRun, listRealUserRuns, realUserScenarios } from "../verify/index.js";
import { realUserWritesEnabled, resolveAccount, TARGET } from "../verify/index.js";
import { getRun } from "../verify/index.js";
import db from "../../db.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const adminActor = (req) => ({ id: req.user?.id ?? null, label: req.user?.full_name || req.user?.email || "admin" });
const UUID = /^[0-9a-f-]{36}$/i;
const mask = (email) => String(email || "").replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => `${a}${"•".repeat(Math.min(6, b.length))}${c}`);

router.get("/verify/real-user-runs", adminOnly, asyncHandler(async (req, res) => {
  try {
    res.json({ success: true, data: { enabled: realUserWritesEnabled(), target: TARGET, scenarios: realUserScenarios(), runs: await listRealUserRuns({ limit: req.query.limit }) } });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
}));

router.get("/verify/real-user-account", adminOnly, asyncHandler(async (req, res) => {
  try {
    const a = await resolveAccount(String(req.query.handle || ""));
    const { data: u } = await db.from("users").select("phone").eq("id", a.id).maybeSingle();
    res.json({ success: true, data: { username: a.username, name: a.name, role: a.role, email: mask(a.email), hasPhone: !!u?.phone, tester: a.tester } });
  } catch (e) {
    res.status(404).json({ success: false, error: e.message });
  }
}));

router.post("/verify/real-user-runs", adminOnly, asyncHandler(async (req, res) => {
  const { account, scenario, reason } = req.body || {};
  try {
    const out = await startRealUserRun({ admin: adminActor(req), account: String(account || ""), scenario: String(scenario || ""), reason: String(reason || "") });
    out.finished.catch(() => {});
    res.status(202).json({ success: true, data: { id: out.approval.id, runId: out.run.id, status: "running" } });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
}));

router.get("/verify/real-user-runs/:id", adminOnly, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(422).json({ success: false, error: "id is invalid" });
  const [row] = await listRealUserRuns({ id: req.params.id, limit: 1 });
  if (!row) return res.status(404).json({ success: false, error: "Not found" });
  const run = row.runId ? await getRun(row.runId) : null;
  res.json({ success: true, data: { ...row, run: run && { verdict: run.verdict, reason: run.reason, status: run.status,
    failed: (run.scenarios || []).flatMap((s) => s.failed || []).map((a) => ({ name: a.name, expected: a.expected, actual: a.actual })) } } });
}));

export default router;
