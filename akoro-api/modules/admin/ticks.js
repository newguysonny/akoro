// modules/admin/ticks.js
//
// POST /api/internal/ticks/:name — the endpoint Cloudflare's cron ticker
// calls. Guarded by x-internal-secret (the same shared secret as every
// internal seam), NOT by JWT: a scheduler is not a user. The work runs
// inside this API process, exactly as the local node-cron schedules ran
// it — only the clock moved to the edge.

import { Router } from "express";
import { runTick, listTicks } from "../../lib/cronTicks.js";
import { requireSharedSecret } from "../../lib/safeCompare.js";

const router = Router();

// Unset INTERNAL_SECRET → 503 (ticks not callable); wrong/missing header → 403. Constant-time.
const secret = requireSharedSecret("INTERNAL_SECRET");

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
