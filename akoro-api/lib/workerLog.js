// lib/workerLog.js
//
// One structured line per worker action, so an idle poll is as visible as a
// busy one. Every background worker (cron ticks, interval schedulers, BullMQ
// consumers) logs through here:
//
//   [worker] live-session-scheduler { reason: "poll", jobsFound: 0, jobsProcessed: 0, durationMs: 3 }
//   [worker] battles { event: "done", jobId: "42", durationMs: 812, action: "start-battle" }
//
// `grep "^\[worker\]"` shows every wake-up. A column of `jobsFound: 0` rows is
// the optimization opportunity: a loop that wakes to find nothing — raise the
// interval, gate the tick behind a cheaper condition, or move the work onto
// an event instead of a timer.

/** A polling/cron tick — did it find work, and what did the pass cost? */
export function workerTick(workerName, fields = {}) {
  console.log(`[worker] ${workerName}`, fields);
}

/** Milliseconds a BullMQ job spent between pickup and finish (0 if unknown). */
export function jobDurationMs(job) {
  const start = job?.processedOn ?? job?.timestamp;
  const end = job?.finishedOn ?? Date.now();
  if (!start || !end) return 0;
  return Math.max(0, end - start);
}

/** A BullMQ job lifecycle line: "done" | "failed", with its cost. */
export function workerJob(workerName, event, job, fields = {}) {
  const line = { event, jobId: job?.id ?? null, durationMs: jobDurationMs(job), ...fields };
  if (event === "failed") console.error(`[worker] ${workerName}`, line);
  else console.log(`[worker] ${workerName}`, line);
}
