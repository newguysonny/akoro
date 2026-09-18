/**
 * modules/autonomy/index.js — queue + nightly scheduler for the planner.
 *
 * Redis-quota hygiene (the 500k-commands lesson): the scheduler is ONE tick
 * that enqueues at most a small batch of due learners per night window —
 * O(users) jobs per DAY, not per minute; the worker idles cheaply with the
 * tuned drainDelay/stalledInterval the other workers use.
 *
 * Every cadence knob (tick interval, batch size, per-learner dedupe, nightly
 * window) is env-tunable via AKORO_AUTONOMY_* — see ./cadence.js.
 */
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import db from "../../db.js";
import { redisConnectionOptions } from "../../lib/redisOptions.js";
import { traceRedis } from "../../lib/redisTrace.js";
import { runAutonomyCycleForUser } from "./cycle.js";
import { autonomyCadence, inNightlyWindow, minCycleCutoff } from "./cadence.js";

// Re-exported so the module's public surface (and the contract tests) keep
// finding inNightlyWindow here; the logic itself lives in cadence.js.
export { inNightlyWindow, autonomyCadence };

const edu = () => db.schema("edu");
const QUEUE_NAME = "autonomy-cycle";

let autonomyCycleQueue = null;

const queue = () => {
  if (!autonomyCycleQueue) {
    autonomyCycleQueue = new Queue(QUEUE_NAME, {
      connection: traceRedis(new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", redisConnectionOptions({ label: "autonomy-cycle" })), "autonomy-cycle"),
    });
  }
  return autonomyCycleQueue;
};

/** Enqueue one learner's cycle (used by the scheduler and future events). */
export async function enqueueAutonomyCycle(userId, trigger = "nightly") {
  await queue().add("run-cycle", { userId, trigger }, {
    // minute-granular dedupe per user+trigger: bursts collapse, while
    // continuous-mode test cycles (5-minute pace) still get unique jobs
    jobId: `cycle:${userId}:${trigger}:${new Date().toISOString().slice(0, 16)}`,
    removeOnComplete: { age: 3600, count: 500 },
    removeOnFail: { age: 6 * 3600 },
  });
}

/** Learners due for a nightly run: autonomy on, level ≥ 2, last cycle older
 *  than the env-tunable min-cycle window (default 20h). */
async function duePlanners(limit = autonomyCadence().batchLimit) {
  const cutoff = minCycleCutoff();
  const { data, error } = await edu().from("learner_agent_autonomy")
    .select("user_id")
    .eq("enabled", true)
    .gte("level", 2)
    .or(`last_cycle_at.is.null,last_cycle_at.lt.${cutoff}`)
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

let schedulerTimer = null;
let worker = null;

/** Start the worker + the nightly scheduler. Redis-guarded by the caller. */
export function startAutonomyCycleWorker() {
  worker = new Worker(QUEUE_NAME, async (job) => {
    const { userId, trigger } = job.data || {};
    if (!userId) return;
    return runAutonomyCycleForUser(userId, trigger || "nightly");
  }, {
    concurrency: 2,
    drainDelay: 60_000,
    settings: { stalledInterval: 300_000 },
  });
  worker.on("failed", (job, err) => console.error(`[autonomy/cycle] job ${job?.id} failed:`, err?.message));

  // The nightly stagger: one tick paces at most one batch into the queue
  // during the window (and claims rows atomically so a multi-replica deploy
  // cannot double-enqueue the same learner). Tick, window, batch size and
  // per-learner cadence all come from AKORO_AUTONOMY_* (cadence.js).
  schedulerTimer = setInterval(async () => {
    try {
      const cadence = autonomyCadence();
      if (!inNightlyWindow(new Date(), cadence)) return;
      const due = await duePlanners(cadence.batchLimit);
      if (!due.length) return;
      const cutoff = minCycleCutoff(cadence);
      const claimed = await edu().from("learner_agent_autonomy")
        .update({ last_cycle_at: new Date().toISOString() })
        .in("user_id", due.map((d) => d.user_id))
        .or(`last_cycle_at.is.null,last_cycle_at.lt.${cutoff}`)
        .select("user_id");
      for (const row of claimed?.data ?? []) {
        await enqueueAutonomyCycle(row.user_id).catch((e) =>
          console.warn("[autonomy/cycle] enqueue failed:", e.message));
      }
      if (claimed?.data?.length) console.log(`[autonomy/cycle] enqueued ${claimed.data.length} nightly planner run(s)`);
    } catch (e) {
      console.error("[autonomy/cycle] scheduler tick failed:", e.message);
    }
  }, autonomyCadence().tickMs);
  schedulerTimer.unref?.();

  const cadence = autonomyCadence();
  console.log(
    `[autonomy] planner worker started (nightly cycle, level ≥ 2 — tick ${Math.round(cadence.tickMs / 1000)}s, ` +
    `window ${String(cadence.windowStart).padStart(2, "0")}:00–${String(cadence.windowEnd).padStart(2, "0")}:00 Africa/Lagos, ` +
    `≤${cadence.batchLimit}/tick, ≥${cadence.minCycleHours}h/learner)`);
  return worker;
}

/** Test/cleanup hook. */
export async function stopAutonomyCycleWorker() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  if (worker) await worker.close();
  if (autonomyCycleQueue) await autonomyCycleQueue.close();
}
