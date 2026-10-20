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

/** GET /api/admin/embeddings — what is missing or stale in the vector stores. */
router.get("/embeddings", adminOnly, asyncHandler(async (req, res) => {
  const { embeddingHealth } = await import("../../lib/embeddingSweeper.js");
  const stores = await embeddingHealth();
  res.json({
    success: true,
    stores,
    // The number that matters: rows nothing can find. A store with missing
    // embeddings is not degraded, it is partly invisible, and before this there
    // was no way to see that from outside.
    totalMissing: stores.reduce((n, s) => n + (s.missing ?? 0), 0),
    // A model switch in progress (POST /embeddings/reembed-all).
    reembed: (await import("../../lib/embeddingCutover.js")).cutoverState(),
  });
}));

/**
 * Embeddings provider + the model switch (lib/embeddingCutover.js).
 * GET  /api/admin/embeddings/provider       — which provider, and a live probe
 * POST /api/admin/embeddings/reembed-all    — { confirm: true }: probe, clear every vector, refill in the background
 * POST /api/admin/embeddings/compare        — the fixed test set on every deployed model, side by side (stores untouched)
 */
router.get("/embeddings/provider", adminOnly, asyncHandler(async (req, res) => {
  const { probeEmbeddings, cutoverState } = await import("../../lib/embeddingCutover.js");
  res.json({ success: true, probe: await probeEmbeddings(), reembed: cutoverState() });
}));
router.post("/embeddings/reembed-all", adminOnly, asyncHandler(async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ success: false, message: "This clears every stored vector and re-embeds them all with the current provider. Send { confirm: true }." });
  const { startReembedAll } = await import("../../lib/embeddingCutover.js");
  const out = await startReembedAll({ allowOpenAI: req.body?.allowOpenAI === true });
  res.status(out.started ? 202 : 409).json({ success: out.started, ...out });
}));

router.post("/embeddings/compare", adminOnly, asyncHandler(async (req, res) => {
  const { compareEmbeddings } = await import("../../lib/embeddingCompare.js");
  res.json({ success: true, ...(await compareEmbeddings()) });
}));

/** POST /api/admin/embeddings/sweep — fill some in now instead of waiting. */
router.post("/embeddings/sweep", adminOnly, asyncHandler(async (req, res) => {
  const { sweepOnce } = await import("../../lib/embeddingSweeper.js");
  const batch = Math.min(200, Math.max(1, parseInt(req.body?.batch, 10) || 25));
  res.json({ success: true, did: await sweepOnce({ batch }) });
}));

/**
 * GET /api/admin/voice/diagnose — open a real transcription session and report.
 *
 * Voice failed three times in a row, and each time the only evidence available
 * was a learner saying "nothing happens". Every layer swallowed the reason: the
 * client logged it to a console nobody has open, the socket close code was
 * discarded, and the one place the truth existed — OpenAI's handshake response
 * — was never surfaced anywhere.
 *
 * This opens the same session the teaching session opens, using the same code,
 * and returns exactly what happened. No microphone, no frontend deploy, no
 * learner needed. If it says ok:true the transport works and any remaining
 * problem is in the browser; if it says ok:false the message is the answer.
 */
router.get("/voice/diagnose", adminOnly, asyncHandler(async (req, res) => {
  const { createRealtimeTranscriber } = await import("../../modules/voice/openaiRealtime.js");
  const started = Date.now();

  const outcome = await new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };

    let conn;
    try {
      conn = createRealtimeTranscriber({
        onOpen:  () => done({ ok: true,  stage: "configured",
                              detail: "Session opened and confirmed — transcription is working." }),
        onError: (e) => done({ ok: false, stage: "failed", detail: e?.message ?? String(e) }),
      });
    } catch (e) {
      return done({ ok: false, stage: "threw", detail: e?.message ?? String(e) });
    }

    // Longer than the transcriber's own 8s confirmation window, so its more
    // specific error wins the race rather than this catch-all.
    setTimeout(() => { try { conn?.close(); } catch { /* going anyway */ } 
      done({ ok: false, stage: "timeout", detail: "No response from the transcription service." }); }, 12_000);
  });

  res.json({
    success: true,
    ...outcome,
    ms: Date.now() - started,
    // The settings that have each broken this at least once.
    using: {
      url: process.env.REALTIME_STT_URL || "wss://api.openai.com/v1/realtime?intent=transcription",
      model: process.env.REALTIME_STT_MODEL || "gpt-4o-mini-transcribe",
      keyPresent: !!process.env.OPENAI_API_KEY,
    },
  });
}));

export default router;
