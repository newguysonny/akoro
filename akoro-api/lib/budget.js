/**
 * lib/budget.js — the weekly USD budget for a learner's
 * background agent work (Grand Plan §7.16.7, D46): noticing, preparing,
 * remembering and ideas are paid by the platform, capped per learner per
 * week. At 80% ops hear about it (lib/alerts rule autonomy_budget); at 100%
 * the background work stops until the week turns (Monday, their time).
 *
 *   weeklyBudgetUsd()                 AKORO_AUTONOMY_WEEKLY_BUDGET_USD (default 0.10)
 *   weekStartFor(now, timeZone)       Monday 00:00 in their time zone
 *   budgetState(userId, { timeZone }) → { spentUsd, budgetUsd, usedPct, resetsAt, stop, warn }
 *   noteBudget(userId, state)         marks the 80% warning once a week
 *
 * What counts: the platform-paid background features, which carry the
 * learner's id as their ref in edu.ai_call_log.
 */
import db from "../db.js";
import { BACKGROUND_FEATURES, budgetFrom, weekStartFor, weeklyBudgetUsd } from "./budgetCore.js";

export { BACKGROUND_FEATURES, budgetFrom, weekStartFor, weeklyBudgetUsd };

export async function budgetState(userId, { timeZone = "Africa/Lagos", now = new Date() } = {}) {
  const start = weekStartFor(now, timeZone);
  const { data, error } = await db.schema("edu").from("ai_call_log").select("cost_usd")
    .eq("ref", String(userId)).in("feature", BACKGROUND_FEATURES).gte("created_at", start.toISOString()).limit(5000);
  if (error) return { ...budgetFrom(0, weeklyBudgetUsd(), start), unknown: true };
  const spent = (data || []).reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
  return budgetFrom(spent, weeklyBudgetUsd(), start);
}

/** The 80% mark, once a week per learner: the alert rule counts these. Never throws. */
export async function noteBudget(userId, state) {
  if (!state?.warn) return;
  try {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    await db.schema("edu").from("learner_agent_autonomy").update({ budget_alerted_at: new Date().toISOString() })
      .eq("user_id", userId).or(`budget_alerted_at.is.null,budget_alerted_at.lt.${weekAgo}`);
  } catch { /* the alert is best-effort; the stop at 100% is not */ }
}
