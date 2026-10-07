/**
 * lib/jobsGate.js — the one background-jobs kill switch, shared.
 *
 * app.js defined these dials inline; two module-level crons (the 1-minute
 * live-session scheduler, the 15-minute leaderboard rebuild) registered
 * themselves on import with NO gate at all — with every BullMQ worker
 * disabled, they still ticked around the clock, querying Supabase and
 * (for sessions with OAuth providers) calling Zoom/Google. Same dials,
 * one place, so a job cannot exist outside them:
 *
 *   AKORO_JOBS_ENABLED="chat follow-ups worker,learner-autonomy worker"
 *     → ONLY the named jobs run
 *   AKORO_JOBS_DISABLED="eval worker,battle worker"
 *     → all jobs EXCEPT the named ones run
 *   AKORO_BACKGROUND_JOBS_ENABLED=false
 *     → the everything switch
 */

const backgroundJobsEnabled =
  String(process.env.AKORO_BACKGROUND_JOBS_ENABLED ?? "true").trim().toLowerCase() === "true";
const JOBS_ONLY = String(process.env.AKORO_JOBS_ENABLED ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const JOBS_DISABLED = String(process.env.AKORO_JOBS_DISABLED ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function skipJob(name) {
  if (JOBS_ONLY.length && !JOBS_ONLY.includes(name)) {
    console.log(`[jobs] ${name} skipped (not listed in AKORO_JOBS_ENABLED)`);
    return true;
  }
  if (JOBS_DISABLED.includes(name)) {
    console.log(`[jobs] ${name} skipped (AKORO_JOBS_DISABLED)`);
    return true;
  }
  if (backgroundJobsEnabled) return false;
  console.log(`[jobs] ${name} skipped (AKORO_BACKGROUND_JOBS_ENABLED=false)`);
  return true;
}
