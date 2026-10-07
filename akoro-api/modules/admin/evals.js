// modules/admin/evals.js
//
// Starting eval runs and reading their results, from the admin app.
//
// The one thing that makes this different from every other admin endpoint:
// pressing the button spends real money. So it estimates before it starts,
// refuses a second concurrent run, and refuses outright without a live key —
// because falling back to the stand-in model would return a perfect score that
// proves nothing, which is worse than an error.

import { Router } from "express";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { SUITES, suiteByKey, EVAL_MODELS, estimateUsd } from "../../lib/evals/index.js";
import { evalQueue } from "../../lib/evalWorker.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** GET /api/admin/evals/suites — what can be run, and roughly what it costs. */
router.get("/evals/suites", adminOnly, asyncHandler(async (req, res) => {
  // Last run per (suite, model) — the comparison that decides a model swap.
  const { data: recent } = await db.schema("edu").from("eval_runs")
    .select("suite, model, status, cases_passed, cases_total, cost_usd, ms, created_at, threshold, met_threshold")
    .eq("status", "done").order("created_at", { ascending: false }).limit(60);

  const lastBy = new Map();
  for (const r of (recent ?? [])) {
    const k = `${r.suite}|${r.model}`;
    if (!lastBy.has(k)) lastBy.set(k, r);
  }

  res.json({
    success: true,
    // Named plainly so the page can refuse before the operator spends anything.
    liveKey: !!process.env.OPENAI_API_KEY,
    models: EVAL_MODELS,
    suites: SUITES.map((s) => ({
      key: s.key, title: s.title, purpose: s.purpose,
      cases: s.cases.length,
      // The bar, and why it is where it is. Shown on the card so nobody has to
      // guess whether 9/10 is a pass for this suite.
      threshold: s.threshold ?? 1,
      thresholdNote: s.thresholdNote ?? null,
      estimates: Object.fromEntries(EVAL_MODELS.map((m) => [m, estimateUsd(s, m)])),
      lastRuns: EVAL_MODELS
        .map((m) => lastBy.get(`${s.key}|${m}`))
        .filter(Boolean)
        .map((r) => ({
          model: r.model, passed: r.cases_passed, total: r.cases_total,
          rate: r.cases_total ? Number((r.cases_passed / r.cases_total).toFixed(3)) : null,
          // The verdict as recorded, not recomputed against today's bar —
          // raising the threshold must not rewrite history.
          met: r.met_threshold, threshold: r.threshold == null ? null : Number(r.threshold),
          costUsd: Number(r.cost_usd ?? 0), ms: r.ms, at: r.created_at,
        })),
    })),
  });
}));

/** POST /api/admin/evals/run — queue a run. */
router.post("/evals/run", adminOnly, asyncHandler(async (req, res) => {
  const suite = suiteByKey(req.body?.suite);
  const model = String(req.body?.model ?? "");

  if (!suite) return res.status(400).json({ success: false, error: `Unknown suite. Try one of: ${SUITES.map(s => s.key).join(", ")}` });
  if (!EVAL_MODELS.includes(model)) {
    return res.status(400).json({ success: false, error: `Unknown model. Try one of: ${EVAL_MODELS.join(", ")}` });
  }
  // A green board from the stand-in model would be worse than no board.
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      success: false,
      error: "Evals need a live OPENAI_API_KEY. Without one this would run against the stand-in model and pass everything, which proves nothing.",
    });
  }

  const { data: active } = await db.schema("edu").from("eval_runs")
    .select("id, suite, model").in("status", ["queued", "running"]).limit(1);
  if (active?.length) {
    return res.status(409).json({
      success: false,
      error: `A run is already going (${active[0].suite} on ${active[0].model}). Wait for it — two at once doubles the bill and races the same tables.`,
      runId: active[0].id,
    });
  }

  const { data: run, error } = await db.schema("edu").from("eval_runs").insert({
    suite: suite.key, model, status: "queued",
    cases_total: suite.cases.length, created_by: req.user.id,
  }).select().single();
  if (error) throw new Error(error.message);

  // Backpressure: an eval suite is minutes of model calls — reject the run
  // when a backlog already exists instead of queueing behind it invisibly.
  await assertQueueCapacity(evalQueue, { name: "evals" });
  await evalQueue.add(`eval-${run.id}`, { runId: run.id });

  res.status(202).json({
    success: true,
    runId: run.id,
    cases: suite.cases.length,
    threshold: suite.threshold ?? 1,
    estimatedUsd: estimateUsd(suite, model),
  });
}));

/** GET /api/admin/evals — recent runs. */
router.get("/evals", adminOnly, asyncHandler(async (req, res) => {
  const { data } = await db.schema("edu").from("eval_runs")
    .select("*").order("created_at", { ascending: false })
    .limit(Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20)));
  res.json({ success: true, runs: data ?? [] });
}));

/** GET /api/admin/evals/:id — one run, failures first. */
router.get("/evals/:id", adminOnly, asyncHandler(async (req, res) => {
  const { data: run } = await db.schema("edu").from("eval_runs")
    .select("*").eq("id", req.params.id).maybeSingle();
  if (!run) return res.status(404).json({ success: false, error: "Run not found" });

  // Failures first: that is the only order anyone reads results in.
  const { data: results } = await db.schema("edu").from("eval_results")
    .select("*").eq("run_id", run.id).order("passed").order("id");

  res.json({ success: true, run, results: results ?? [] });
}));

/** POST /api/admin/evals/:id/cancel — stop a run that is still going. */
router.post("/evals/:id/cancel", adminOnly, asyncHandler(async (req, res) => {
  const { data: run } = await db.schema("edu").from("eval_runs")
    .select("id, status").eq("id", req.params.id).maybeSingle();
  if (!run) return res.status(404).json({ success: false, error: "Run not found" });
  if (!["queued", "running"].includes(run.status)) {
    return res.status(400).json({ success: false, error: `That run is already ${run.status}.` });
  }

  await db.schema("edu").from("eval_runs")
    .update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", run.id);
  // The worker checks the status before each case, so an in-flight run stops
  // after the case it is on rather than being killed mid-call and billed for a
  // result nobody records.
  try { await evalQueue.remove(`eval-${run.id}`); } catch { /* already started */ }

  res.json({ success: true });
}));

export default router;
