/**
 * modules/autonomy/index.js — queue + nightly scheduler for the planner.
 *
 * Redis-quota hygiene (the 500k-commands lesson): the scheduler is ONE 60s
 * tick that enqueues at most a small batch of due learners per night window
 * — O(users) jobs per DAY, not per minute; the worker idles cheaply with
 * the tuned drainDelay/stalledInterval the other workers use.
 */
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import db from "../../db.js";
import { bullRedisOptions } from "../../lib/redisOptions.js";
import { runAutonomyCycleForUser } from "./cycle.js";

const edu = () => db.schema("edu");
const QUEUE_NAME = "autonomy-cycle";

let autonomyCycleQueue = null;

const queue = () => {
  if (!autonomyCycleQueue) {
    autonomyCycleQueue = new Queue(QUEUE_NAME, {
      connection: new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", bullRedisOptions),
    });
  }
  return autonomyCycleQueue;
};

/** Enqueue one learner's cycle (used by the scheduler and future events). */
export async function enqueueAutonomyCycle(userId, trigger = "nightly") {
  await queue().add("run-cycle", { userId, trigger }, {
    jobId: `cycle:${userId}:${new Date().toISOString().slice(0, 13)}`,  // ~hourly dedupe
    removeOnComplete: { age: 3600, count: 500 },
    removeOnFail: { age: 6 * 3600 },
  });
}

/** Learners due for a nightly run: autonomy on, level ≥ 2, last run ≥ 20h. */
async function duePlanners(limit = 40) {
  const cutoff = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  const { data, error } = await edu().from("learner_agent_autonomy")
    .select("user_id")
    .eq("enabled", true)
    .gte("level", 2)
    .or(`last_cycle_at.is.null,last_cycle_at.lt.${cutoff}`)
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The nightly window check — 21:00–23:00 Africa/Lagos. */
export function inNightlyWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h === 21 || (h === 22 && m === 0); // 21:00–22:00, one pacing tick
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

  // The nightly stagger: one tick per minute paces at most one batch into
  // the queue during the 21:00 window (and claims rows atomically so a
  // multi-replica deploy cannot double-enqueue the same learner).
  schedulerTimer = setInterval(async () => {
    try {
      if (!inNightlyWindow()) return;
      const due = await duePlanners();
      if (!due.length) return;
      const cutoff = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
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
  }, 60_000);
  schedulerTimer.unref?.();

  console.log("[autonomy] planner worker started (nightly cycle, level ≥ 2)");
  return worker;
}

/** Test/cleanup hook. */
export async function stopAutonomyCycleWorker() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  if (worker) await worker.close();
  if (autonomyCycleQueue) await autonomyCycleQueue.close();
}
