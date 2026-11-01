// modules/admin/ticks.js
//
// POST /api/internal/ticks/:name — the endpoint Cloudflare's cron ticker
// calls. Guarded by x-internal-secret (the same shared secret as every
// internal seam), NOT by JWT: a scheduler is not a user. The work runs
// inside this API process, exactly as the local node-cron schedules ran
// it — only the clock moved to the edge.

import { Router } from "express";
import { runTick, listTicks } from "../../lib/cronTicks.js";

const router = Router();

const secret = (req, res, next) => {
  if (!process.env.INTERNAL_SECRET) {
    return res.status(503).json({ success: false, error: "INTERNAL_SECRET is not set — ticks are not callable." });
  }
  if (req.headers["x-internal-secret"] !== process.env.INTERNAL_SECRET) {
    return res.status(403).json({ success: false, error: "Forbidden" });
  }
  next();
};

router.get("/", secret, (_req, res) => {
  res.json({ success: true, data: { ticks: listTicks() } });
});

router.post("/:name", secret, async (req, res) => {
  const outcome = await runTick(req.params.name);
  if (!outcome.ok) {
    return res.status(outcome.status).json({ success: false, error: outcome.error });
  }
  res.json({ success: true, data: outcome.data });
});

export default router;
