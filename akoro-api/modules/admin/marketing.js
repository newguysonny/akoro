/**
 * modules/admin/marketing.js
 * Admin-only proxy to the lead-scout Python service (lead generation for
 * partnerships outreach — schools with weak/no websites).
 * Mounted under /api/admin (see ./index.js):
 *   POST /api/admin/marketing/jobs          start a lead-scout job
 *   GET  /api/admin/marketing/jobs/:id      poll job status + lead preview
 *   GET  /api/admin/marketing/jobs/:id/csv  download results as CSV
 *   GET  /api/admin/marketing/health        provider/key availability
 */
import { Router } from "express";
import { authenticateToken, requireRole } from "../auth/routes.js";

const router    = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];

const SCOUT  = () => (process.env.LEAD_SCOUT_URL || "http://localhost:8100").replace(/\/$/, "");
const HEADERS = () => ({
  "Content-Type": "application/json",
  ...(process.env.LEAD_SCOUT_SECRET ? { "X-Internal-Secret": process.env.LEAD_SCOUT_SECRET } : {}),
});

const proxyError = (res, e) => {
  const msg = /fetch failed|ECONNREFUSED/i.test(String(e?.message ?? e))
    ? "Lead-scout service is not running (set LEAD_SCOUT_URL / start lead-scout)"
    : String(e?.message ?? e);
  res.status(502).json({ success: false, message: msg });
};

router.get("/marketing/health", ...adminOnly, async (_req, res) => {
  try {
    const r = await fetch(`${SCOUT()}/health`, { headers: HEADERS() });
    res.status(r.status).json(await r.json());
  } catch (e) { proxyError(res, e); }
});

router.post("/marketing/jobs", ...adminOnly, async (req, res) => {
  try {
    const r = await fetch(`${SCOUT()}/jobs`, {
      method: "POST", headers: HEADERS(), body: JSON.stringify(req.body ?? {}),
    });
    res.status(r.status).json(await r.json());
  } catch (e) { proxyError(res, e); }
});

router.get("/marketing/jobs/:id", ...adminOnly, async (req, res) => {
  try {
    const r = await fetch(`${SCOUT()}/jobs/${encodeURIComponent(req.params.id)}`, { headers: HEADERS() });
    res.status(r.status).json(await r.json());
  } catch (e) { proxyError(res, e); }
});

router.get("/marketing/jobs/:id/csv", ...adminOnly, async (req, res) => {
  try {
    const r = await fetch(`${SCOUT()}/jobs/${encodeURIComponent(req.params.id)}/csv`, { headers: HEADERS() });
    if (!r.ok) return res.status(r.status).json(await r.json().catch(() => ({ error: "CSV not ready" })));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", r.headers.get("content-disposition") || `attachment; filename="leads-${req.params.id}.csv"`);
    res.send(await r.text());
  } catch (e) { proxyError(res, e); }
});

export default router;
