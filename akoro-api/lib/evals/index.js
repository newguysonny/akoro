// lib/evals/index.js
//
// The suite registry and the runner that executes one.
//
// Imported by BOTH the CLI (scripts/evals/run.mjs) and the queue worker, so a
// run started from the admin page and a run started from a terminal execute
// identical code. A green result has to mean the same thing either way, or the
// suite is two suites wearing one name.

import db from "../../db.js";
import { questionsSuite } from "./questions.js";
import { routingSuite }   from "./routing.js";

export const SUITES = [questionsSuite, routingSuite];
export const suiteByKey = (key) => SUITES.find((s) => s.key === key) ?? null;

/**
 * Models worth comparing. Only tiers priced in aiPricing.js, because a run
 * whose cost cannot be computed is a run that answers half the question.
 */
export const EVAL_MODELS = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o", "gpt-4.1"];

/** Rough per-run cost, so the page can warn before anything is spent. */
export function estimateUsd(suite, model) {
  // Order-of-magnitude only: ~1.2k in / ~1.2k out for a generation case, far
  // less for a routing case. Presented as "about", never as a quote.
  const perCall = { "gpt-4o-mini": 0.0009, "gpt-4.1-mini": 0.0024, "gpt-4o": 0.015, "gpt-4.1": 0.012 };
  return Number(((perCall[model] ?? 0.002) * (suite.estimatedCalls ?? suite.cases.length)).toFixed(4));
}

/**
 * runSuite — execute every case, writing results as they finish.
 *
 * Results are written per case rather than at the end so the page fills in
 * live: a suite takes minutes, and a spinner that reveals everything at once
 * cannot be told apart from one that has hung.
 *
 * A case that throws is a FAILED case, not a failed run. One model refusing one
 * prompt should not destroy the other nine results.
 */
export async function runSuite({ suite, model, runId, userId = null, onCase = null }) {
  const started = Date.now();
  let passed = 0, failed = 0;

  const costBefore = await evalSpend(runId ? started : null);

  for (const c of suite.cases) {
    // Cancellation is checked BETWEEN cases, not inside one: aborting a call
    // already in flight still bills for it and would record nothing, so the
    // run stops after the case it is on.
    if (runId && await wasCancelled(runId)) {
      return { passed, failed, total: suite.cases.length, ms: Date.now() - started,
               costUsd: Math.max(0, Number(((await evalSpend(started)) - costBefore).toFixed(8))),
               cancelled: true };
    }
    const t0 = Date.now();
    let result;
    try {
      result = await c.run({ model, userId });
    } catch (e) {
      result = { passed: false, expected: "a result", actual: "threw", detail: e.message?.slice(0, 300) ?? String(e) };
    }
    const ms = Date.now() - t0;
    result.passed ? passed++ : failed++;

    if (runId) {
      await db.schema("edu").from("eval_results").insert({
        run_id: runId, case_key: c.key, name: c.name,
        passed: !!result.passed,
        expected: result.expected ?? null, actual: result.actual ?? null,
        detail: result.detail ?? null, ms,
      }).then(({ error }) => { if (error) console.warn("[evals] result insert failed:", error.message); });

      await db.schema("edu").from("eval_runs")
        .update({ cases_passed: passed, cases_failed: failed }).eq("id", runId);
    }
    onCase?.({ ...result, name: c.name, key: c.key, ms });
  }

  // What it cost, taken from the telemetry rather than estimated — the eval
  // calls are tagged feature='eval', so this is the real figure.
  const costAfter = await evalSpend(started);
  const costUsd = Math.max(0, Number((costAfter - costBefore).toFixed(8)));

  return { passed, failed, total: suite.cases.length, ms: Date.now() - started, costUsd };
}

async function wasCancelled(runId) {
  try {
    const { data } = await db.schema("edu").from("eval_runs").select("status").eq("id", runId).maybeSingle();
    return data?.status === "cancelled";
  } catch { return false; }
}

/** Total spend on eval-tagged calls since a moment. */
async function evalSpend(sinceMs) {
  if (!sinceMs) return 0;
  try {
    const { data } = await db.schema("edu").from("ai_call_log")
      .select("cost_usd").eq("feature", "eval").gte("created_at", new Date(sinceMs).toISOString());
    return (data ?? []).reduce((s, r) => s + Number(r.cost_usd || 0), 0);
  } catch { return 0; }
}
