// lib/aiTelemetry.js
//
// One record per model call: what it was for, which model ran it, how long it
// took, how many tokens it moved and what it cost.
//
// Cost and tokens were already captured — but only for BILLED calls, because
// the only thing writing them was the wallet debit. A system or cron call (no
// user to charge) was invisible, and latency was not recorded anywhere at all.
// Of the three axes you would route a model on — cost, latency, quality — one
// was measured, one was missing, and the measured one had a hole in it.
//
// Two sinks, deliberately:
//
//   · a structured stdout line, always. Costs nothing, works in Railway's log
//     viewer today, and follows securityLog's shape — including a `message`
//     field, because a viewer with nothing to show renders a blank row.
//   · a row in edu.ai_call_log when a table exists. That is what makes a cost
//     dashboard or a p95 latency alert possible without parsing logs.
//
// Both are best-effort and neither can break a completion: telemetry that can
// take down the thing it measures is worse than no telemetry.

import db from "../db.js";

const ENABLED = process.env.AI_TELEMETRY !== "off";
// Persisting a row per call is the part with a real cost. On by default because
// a dashboard needs it; set AI_TELEMETRY_DB=off to keep only the log line.
const PERSIST = process.env.AI_TELEMETRY_DB !== "off";

let tableMissing = false;   // stop retrying once we know it isn't there

/**
 * recordAiCall — call this once per completion, billed or not.
 *
 * `ms` is wall time for the whole call. `ttfbMs` is time to the first streamed
 * chunk, which for chat is the number a user actually feels — a 4-second
 * completion that starts printing in 300ms reads as fast, and averaging the two
 * together would hide exactly that.
 */
export function recordAiCall({
  feature, model, ms, ttfbMs = null,
  tokensIn = 0, tokensOut = 0, cachedIn = 0, costUsd = null,
  userId = null, ref = null, streamed = false, ok = true, errorKind = null,
}) {
  if (!ENABLED) return;

  const entry = {
    ts: new Date().toISOString(),
    event: "AI_CALL",
    message: `AI_CALL ${feature ?? "ai"} ${model} ${ms}ms` +
             (ttfbMs != null ? ` (ttfb ${ttfbMs}ms)` : "") +
             (ok ? "" : ` FAILED ${errorKind ?? ""}`),
    level: ok ? "info" : "error",
    feature: feature ?? null,
    model,
    ms,
    ttfb_ms: ttfbMs,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cached_in: cachedIn,
    cost_usd: costUsd,
    streamed,
    ok,
    error_kind: errorKind,
    user_id: userId,
    ref,
  };
  const line = JSON.stringify(entry) + "\n";
  // A failed call is worth someone's attention; a successful one is not.
  if (ok) process.stdout.write(line);
  else    process.stderr.write(line);

  if (!PERSIST || tableMissing) return;
  // Fire and forget. Awaiting this would put the database on the critical path
  // of every completion, and a slow insert would show up as model latency —
  // the measurement corrupting the measurement.
  db.schema("edu").from("ai_call_log").insert({
    feature: feature ?? null, model, ms, ttfb_ms: ttfbMs,
    tokens_in: tokensIn, tokens_out: tokensOut, cached_in: cachedIn,
    cost_usd: costUsd, streamed, ok, error_kind: errorKind,
    user_id: userId, ref: typeof ref === "string" ? ref : null,
  }).then(({ error }) => {
    if (!error) return;
    // 42P01 = undefined_table. The migration has not run here; stop trying
    // rather than logging the same failure on every subsequent call.
    if (error.code === "42P01" || /does not exist/i.test(error.message ?? "")) {
      tableMissing = true;
      console.warn("[ai-telemetry] edu.ai_call_log missing — logging only");
    } else {
      console.warn("[ai-telemetry] insert failed:", error.message);
    }
  }).catch(() => { /* never surfaces to the caller */ });
}

/** Coarse error label — the class of failure, never the message. */
export function errorKindOf(err) {
  const status = err?.status ?? err?.response?.status;
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "upstream_5xx";
  if (err?.name === "AbortError") return "aborted";
  if (/timeout/i.test(err?.message ?? "")) return "timeout";
  return status ? `http_${status}` : "error";
}
