/**
 * Admin: watch-only mode for proactive work (Grand Plan Phase 18 item 1).
 *
 *   GET   /api/admin/proactive-kinds                       every kind: mode, scope, who set it, 30-day counts
 *   GET   /api/admin/proactive-kinds/:kind/observations    "would have proposed" records, real outcomes beside them
 *   PATCH /api/admin/proactive-kinds/:kind                 { mode, scope?: { mode, userIds?, schoolIds? }, note? }
 *
 * Admin-only. A switch is recorded with who and when (the kind's history and
 * admin_audit_log). The rules live in modules/autonomy/kindModesCore.js.
 */
import { Router } from "express";
import { authenticateToken, requireRole } from "../auth/index.js";
import { kindModeHistory, listKindModes, listObservations, setKindMode } from "../autonomy/index.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const KIND = /^[a-z][a-z0-9_]{1,40}$/;
const actorOf = (req) => ({ id: req.user?.id ?? null, label: req.user?.full_name || req.user?.email || "admin" });

router.get("/proactive-kinds", adminOnly, asyncHandler(async (_req, res) => {
  try {
    res.json({ success: true, data: { kinds: await listKindModes() } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}));

router.get("/proactive-kinds/:kind/observations", adminOnly, asyncHandler(async (req, res) => {
  if (!KIND.test(req.params.kind)) return res.status(422).json({ success: false, error: "kind is invalid" });
  try {
    const [observations, history] = await Promise.all([
      listObservations(req.params.kind, { limit: req.query.limit }),
      kindModeHistory(req.params.kind),
    ]);
    res.json({ success: true, data: { kind: req.params.kind, observations, history } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}));

router.patch("/proactive-kinds/:kind", adminOnly, asyncHandler(async (req, res) => {
  try {
    const row = await setKindMode(req.params.kind, req.body || {}, actorOf(req));
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
}));

export default router;
