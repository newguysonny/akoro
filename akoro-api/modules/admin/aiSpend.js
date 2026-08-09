// modules/admin/aiSpend.js
//
// What the platform's AI is costing, how slow it is, and what is failing —
// read from edu.ai_call_log, which carries one row per model call whether or
// not it was billed to anyone.
//
// Three questions, three shapes, deliberately kept apart:
//
//   · BY FEATURE — where the money goes. This is the one that drives a routing
//     decision, so it carries p95 latency next to cost: a feature that is
//     expensive AND fast is a candidate for a cheaper model; one that is
//     expensive and already slow is not.
//   · BY MODEL — what each tier actually costs in practice, as opposed to on
//     the price list. Needed to say "we moved X to the cheap tier and saved Y"
//     with a number rather than an estimate.
//   · OVER TIME — whether today is normal. A single total answers nothing
//     without the days either side of it.
//
// Percentiles are computed in SQL, not in JS over a fetched array: p95 over a
// day of calls should not mean shipping a day of calls to the API process.

import { Router } from "express";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { currentAlerts, evaluateAll } from "../../lib/alerts.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Clamp the window so nobody asks for a year of rows by accident. */
const windowHours = (q) => Math.min(24 * 90, Math.max(1, parseInt(q.hours, 10) || 24));

/**
 * The aggregates run as one SQL statement through an RPC, because PostgREST
 * cannot express percentile_disc and a per-feature GROUP BY in a REST query.
 * If the function is missing (migration not run) the endpoint says so plainly
 * rather than returning an empty dashboard that looks like "no usage".
 */
async function callRpc(name, args) {
  const { data, error } = await db.schema("edu").rpc(name, args);
  if (error) {
    const missing = error.code === "42883" || /does not exist/i.test(error.message ?? "");
    const err = new Error(missing
      ? `AI spend reporting is not installed — run migration 2026-ai-spend-reporting.sql (${name})`
      : error.message);
    err.status = missing ? 503 : 500;
    throw err;
  }
  return data ?? [];
}

/**
 * GET /api/admin/ai-spend?hours=24
 * Everything the dashboard needs, in one round trip — a dashboard that fires
 * four requests shows four different moments in time.
 */
router.get("/ai-spend", adminOnly, asyncHandler(async (req, res) => {
  const hours = windowHours(req.query);

  const [byFeature, byModel, series, failures] = await Promise.all([
    callRpc("ai_spend_by_feature", { p_hours: hours }),
    callRpc("ai_spend_by_model",   { p_hours: hours }),
    callRpc("ai_spend_series",     { p_hours: hours }),
    callRpc("ai_spend_failures",   { p_hours: hours }),
  ]);

  const totals = byFeature.reduce((acc, r) => ({
    calls:      acc.calls + Number(r.calls || 0),
    usd:        acc.usd   + Number(r.usd   || 0),
    tokensIn:   acc.tokensIn  + Number(r.tokens_in  || 0),
    tokensOut:  acc.tokensOut + Number(r.tokens_out || 0),
    failed:     acc.failed + Number(r.failed || 0),
  }), { calls: 0, usd: 0, tokensIn: 0, tokensOut: 0, failed: 0 });

  res.json({
    success: true,
    windowHours: hours,
    generatedAt: new Date().toISOString(),
    totals: {
      ...totals,
      usd: Number(totals.usd.toFixed(6)),
      // Cost per call is the number that moves when routing changes, so it is
      // computed here rather than left to whoever reads this.
      usdPerCall: totals.calls ? Number((totals.usd / totals.calls).toFixed(8)) : 0,
      failureRate: totals.calls ? Number((totals.failed / totals.calls).toFixed(4)) : 0,
    },
    byFeature, byModel, series, failures,
  });
}));

/**
 * GET /api/admin/alerts — the current state of every rule.
 *
 * Every rule, not only the firing ones: a page that shows an empty list cannot
 * distinguish "nothing is wrong" from "nothing is being checked", and those are
 * very different situations to be looking at during an incident.
 */
router.get("/alerts", adminOnly, asyncHandler(async (req, res) => {
  const rules = await currentAlerts();
  res.json({
    success: true,
    firing: rules.filter((r) => r.firing).length,
    rules,
  });
}));

/**
 * POST /api/admin/alerts/check — run the rules now.
 *
 * `?deliver=1` actually sends. Default is a dry run, because the common reason
 * to press this is "did I set the threshold right?", and finding out should not
 * mean emailing everyone.
 */
router.post("/alerts/check", adminOnly, asyncHandler(async (req, res) => {
  const deliver = req.query.deliver === "1" || req.body?.deliver === true;
  const results = await evaluateAll({ deliver });
  res.json({ success: true, delivered: deliver, results });
}));

export default router;
