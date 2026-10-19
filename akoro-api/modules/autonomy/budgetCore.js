/**
 * modules/autonomy/budgetCore.js — the weekly agent budget's pure rules
 * (budget.js reads the spend). Grand Plan §7.16.7, D46.
 */
import { localMinutes } from "./quietHours.js";

export const BACKGROUND_FEATURES = Object.freeze(["agent_autonomy", "quiet_learning", "agent_ideas", "agent_prepare"]);
export const WARN_AT = 0.8;

export function weeklyBudgetUsd(env = process.env) {
  const v = Number(env.AKORO_AUTONOMY_WEEKLY_BUDGET_USD);
  return Number.isFinite(v) && v > 0 ? v : 0.10;
}

/** Monday 00:00 of this week in their time zone, as an instant. Pure. */
export function weekStartFor(now = new Date(), timeZone = "Africa/Lagos") {
  const dayName = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(now);
  const back = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(dayName);
  const sinceMidnight = localMinutes(now, timeZone);
  const start = new Date(now.getTime() - (Math.max(0, back) * 1440 + sinceMidnight) * 60_000);
  start.setUTCSeconds(0, 0);
  return start;
}

/** Pure: spent + budget → the state the planner and Settings use. */
export function budgetFrom(spentUsd, budgetUsd, weekStart) {
  const usedPct = budgetUsd > 0 ? Math.min(100, Math.round((spentUsd / budgetUsd) * 100)) : 0;
  return {
    spentUsd: Number(spentUsd.toFixed(6)), budgetUsd, usedPct,
    resetsAt: new Date(weekStart.getTime() + 7 * 86_400_000).toISOString(),
    stop: spentUsd >= budgetUsd, warn: spentUsd >= budgetUsd * WARN_AT,
  };
}
