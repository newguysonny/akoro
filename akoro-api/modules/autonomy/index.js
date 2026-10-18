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
import { deliverDue } from "./deliver.js";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import db from "../../db.js";
import { redisConnectionOptions } from "../../lib/redisOptions.js";
import { traceRedis } from "../../lib/redisTrace.js";
import { workerTick, workerJob } from "../../lib/workerLog.js";
import { runAutonomyCycleForUser } from "./cycle.js";
import { autonomyCadence, fmtMs, inNightlyWindow, minCycleCutoff, minCycleMs, weeklyRunsCap } from "./cadence.js";
import { guardWorker } from "../../lib/redisQuotaGuard.js";

// Re-exported so the module's public surface (and the contract tests) keep
// finding inNightlyWindow here; the logic itself lives in cadence.js.
export { inNightlyWindow, autonomyCadence };

const edu = () => db.schema("edu");
const QUEUE_NAME = "autonomy-cycle";

let autonomyCycleQueue = null;
let queueRedis = null;
let workerRedis = null;

/* Both connections are traced and REDIS_URL-backed, with error listeners
 * (an un-listened ioredis error throws). NEVER let BullMQ default them:
 * its fallback is 127.0.0.1:6379, which is exactly how the planner went
 * silently dead on remote-Redis deploys (Render et al.) — the scheduler
 * enqueued into the real Redis while the worker listened on localhost,
 * so jobs were added but never processed. */
function queueConnection() {
  if (queueRedis) return queueRedis;
  queueRedis = traceRedis(new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", redisConnectionOptions({ label: "autonomy-cycle" })), "autonomy-cycle");
  queueRedis.on("error", (error) => console.error("[autonomy/cycle queue Redis]", error.message));
  return queueRedis;
}

function workerConnection() {
  if (workerRedis) return workerRedis;
  workerRedis = traceRedis(new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", redisConnectionOptions({ label: "autonomy-worker" })), "autonomy-worker");
  workerRedis.on("error", (error) => console.error("[autonomy/cycle worker Redis]", error.message));
  return workerRedis;
}

const queue = () => {
  if (!autonomyCycleQueue) {
    autonomyCycleQueue = new Queue(QUEUE_NAME, { connection: queueConnection() });
  }
  return autonomyCycleQueue;
};

/** Enqueue one learner's cycle (used by the scheduler and future events). */
export async function enqueueAutonomyCycle(userId, trigger = "nightly") {
  await queue().add("run-cycle", { userId, trigger }, {
    // minute-granular dedupe per user+trigger: bursts collapse, while
    // continuous-mode test cycles (5-minute pace) still get unique jobs.
    // Dashes + digits-only minute stamp — BullMQ REJECTS ":" in custom
    // ids (its Redis-key separator); the old colon-joined ids failed
    // every enqueue with "Custom Id cannot contain :".
    jobId: `cycle-${userId}-${trigger}-${new Date().toISOString().slice(0, 16).replace(/\D/g, "")}`,
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
    const result = await runAutonomyCycleForUser(userId, trigger || "nightly");
    // Skips are the planner's normal vocabulary (pace, inbox full,
    // budget) — and THE answer to "why no suggestions?": say which
    // gate held the run, per user, instead of failing silently.
    if (result?.skipped) console.log(`[autonomy/cycle] skipped user ${userId} (${trigger || "nightly"}): ${result.skipped}`);
    return result;
  }, {
    connection: workerConnection(),
    concurrency: 2,
    drainDelay: 60,   // seconds (60_000 was 16 hours)
    stalledInterval: 300_000,   // 5 min between stalled-job scans. Top level: BullMQ ignores it inside `settings`, which left every worker scanning every 30 s.
  });
  // Quota errors pause every worker instead of a 100 ms retry storm (lib/redisQuotaGuard.js).
  guardWorker(worker, "autonomy cycle worker");
  worker.on("completed", (job, result) =>
    workerJob("autonomy-cycle", "done", job, { skipped: result?.skipped ?? null })
  );
  worker.on("failed", (job, err) => {
    console.error(`[autonomy/cycle] job ${job?.id} failed:`, err?.message);
    workerJob("autonomy-cycle", "failed", job, { error: err?.message });
  });

  // The nightly stagger: one tick paces at most one batch into the queue
  // during the window (and claims rows atomically so a multi-replica deploy
  // cannot double-enqueue the same learner). Tick, window, batch size and
  // per-learner cadence all come from AKORO_AUTONOMY_* (cadence.js).
  let deliveryTicks = 0;
  schedulerTimer = setInterval(async () => {
    const tickStart = Date.now();
    let inWindow = false, jobsFound = 0, jobsProcessed = 0;
    // Proposals held back (the chat was busy, quiet hours) are posted on a
    // later tick — every ~10 minutes, any time of day (deliver.js keeps the rules).
    if (++deliveryTicks % 10 === 0) deliverDue().catch((e) => console.warn("[autonomy/deliver] sweep failed:", e.message));
    try {
      const cadence = autonomyCadence();
      inWindow = inNightlyWindow(new Date(), cadence);
      if (inWindow) {
        const due = await duePlanners(cadence.batchLimit);
        jobsFound = due.length;
        if (due.length) {
          const cutoff = minCycleCutoff(cadence);
          const claimed = await edu().from("learner_agent_autonomy")
            .update({ last_cycle_at: new Date().toISOString() })
            .in("user_id", due.map((d) => d.user_id))
            .or(`last_cycle_at.is.null,last_cycle_at.lt.${cutoff}`)
            .select("user_id");
          let enqueued = 0;
          for (const row of claimed?.data ?? []) {
            await enqueueAutonomyCycle(row.user_id)
              .then(() => { enqueued += 1; })
              .catch(async (e) => {
                console.warn("[autonomy/cycle] enqueue failed:", e.message);
                // Give the claim back so the next tick retries instead of
                // locking the learner out for a whole pace window on a
                // transient failure.
                edu().from("learner_agent_autonomy")
                  .update({ last_cycle_at: null })
                  .eq("user_id", row.user_id)
                  .then(() => {}, () => {});
              });
          }
          jobsProcessed = enqueued;
          if (enqueued) console.log(`[autonomy/cycle] enqueued ${enqueued} nightly planner run(s)`);
        }
      }
    } catch (e) {
      console.error("[autonomy/cycle] scheduler tick failed:", e.message);
    } finally {
      // Every tick logs, idle ones included: outside the nightly window or
      // with no due learners is the normal case, and a run of jobsFound: 0
      // rows is the signal to widen the tick or gate it behind a cheaper
      // condition.
      workerTick("autonomy-cycle-scheduler", {
        reason: "poll", inWindow, jobsFound, jobsProcessed, durationMs: Date.now() - tickStart,
      });
    }
  }, autonomyCadence().tickMs);
  schedulerTimer.unref?.();

  const cadence = autonomyCadence();
  const cap = weeklyRunsCap();
  const shape = cadence.loopEveryMs > 0
    ? `LOOP every ${fmtMs(cadence.loopEveryMs)}`
    : cadence.mode === "continuous"
      ? "continuous, window open"
      : `window ${String(cadence.windowStart).padStart(2, "0")}:00–${String(cadence.windowEnd).padStart(2, "0")}:00 Africa/Lagos`;
  let bootLine = `[autonomy] planner worker started (level ≥ 2 — ${shape}, tick ${Math.round(cadence.tickMs / 1000)}s, ` +
    `≤${cadence.batchLimit}/tick, pace ${fmtMs(minCycleMs(cadence))}/learner, budget ${cap} runs/week)`;
  // A loop the weekly budget can't sustain stops mid-week — say so at boot,
  // not in a ticket three days later.
  if (cadence.loopEveryMs > 0 && cap * cadence.loopEveryMs < 7 * 86_400_000) {
    bootLine += ` — NOTE: budget ${cap} ≈ ${(cap * cadence.loopEveryMs / 3_600_000).toFixed(1)}h of looping; ` +
      `raise AKORO_AUTONOMY_MAX_WEEKLY_RUNS to sustain the loop all week`;
  }
  console.log(bootLine);
  return worker;
}

/** Test/cleanup hook. */
export async function stopAutonomyCycleWorker() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  if (worker) await worker.close();
  if (autonomyCycleQueue) await autonomyCycleQueue.close();
  if (workerRedis) await workerRedis.quit().catch(() => {});
  if (queueRedis) await queueRedis.quit().catch(() => {});
}
