/**
 * lib/deferredJobsCore.js — the pure rules behind lib/deferredJobs.js (no
 * database, no Redis), so the contract tests can run without either.
 */
import cronParser from "cron-parser";

/** Jobs due within this window go straight to Redis; later ones wait in Postgres. */
export const HOLD_MS = Math.max(60_000, Number(process.env.DEFERRED_HOLD_MS) || 10 * 60_000);

/** How far ahead of its due time a waiting job is handed to its queue (the release tick runs every minute). */
export const RELEASE_LEAD_MS = 90_000;

/** PURE: the next run of a cron pattern after `from`. → Date */
export function nextCronRun(pattern, tz = "Africa/Lagos", from = new Date()) {
  return cronParser.parseExpression(pattern, { currentDate: from, tz }).next().toDate();
}

/**
 * PURE: where a job goes. → { direct: true } | { direct: false, dueAt: Date, repeat }
 * Recurring jobs always wait in Postgres (their next run is the due time).
 */
export function planAdd(opts = {}, now = Date.now()) {
  if (opts.repeat?.pattern) {
    return { direct: false, dueAt: nextCronRun(opts.repeat.pattern, opts.repeat.tz, new Date(now)), repeat: { pattern: opts.repeat.pattern, tz: opts.repeat.tz || "Africa/Lagos" } };
  }
  const delay = Math.max(0, Number(opts.delay) || 0);
  if (delay <= HOLD_MS) return { direct: true };
  return { direct: false, dueAt: new Date(now + delay), repeat: null };
}

/** PURE: the options a job is stored with (no delay / repeat: the row's due_at and repeat hold those). */
export function storedOpts(opts = {}) {
  const { delay, repeat, jobId, ...rest } = opts;
  return rest;
}

/** PURE: the jobId a released row is added with. A recurring row gets one per run. */
export function releaseJobId(row) {
  return row.repeat ? `${row.job_key}-${new Date(row.due_at).getTime()}` : row.job_key;
}
