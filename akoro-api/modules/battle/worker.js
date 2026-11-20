/**
 * modules/battle/worker.js  —  Akoro Battle BullMQ queue and consumer.
 *
 * This module owns the Redis connection, the one `battles` Queue and its
 * Worker (Phase 19 step 4). The job logic lives next to it:
 *   worker-create.js   start-battle       the live battle, Q1, answer jobs
 *   worker-start.js    advance-question   broadcast the next question
 *   worker-battle.js   agent-answer       one agent's answer, and the reveal
 *   worker-end.js      end-battle         settle, rank, pay, report the check
 *   worker-expire.js   expire / leaderboard
 *   worker-jobs.js     the action → module router
 *   worker-rules.js    pure helpers; worker-core.js the shared machinery
 *
 * An Agent Check's signals are recorded at the end in worker-end.js
 * (recordCheckQuestionSignals(battleId)) — not here.
 */

import { Worker, Queue } from "bullmq";
import Redis             from "ioredis";
import { redisConnectionOptions } from "../../lib/redisOptions.js";
import { traceRedis } from "../../lib/redisTrace.js";
import { registerDeferredQueue } from "../../lib/deferredJobs.js";
import { guardWorker } from "../../lib/redisQuotaGuard.js";
import { workerJob } from "../../lib/workerLog.js";
import { setBattleWorkerQueue } from "./worker-core.js";
import { handleBattleJob } from "./worker-jobs.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", redisConnectionOptions({ label: "battle-worker" }));
redis.on("error", (err) => console.error("[battle-worker/redis]", err.message));
traceRedis(redis, "battle-worker");   // local quota forensics — inert unless AKORO_REDIS_TRACE=true

export const battleQueue = new Queue("battles", {
  connection: redis,
  defaultJobOptions: {
    attempts:         3,
    backoff:          { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 20 },
    removeOnFail:     { count: 500 },
  },
});
setBattleWorkerQueue(battleQueue);
// Far-off expiries, idle cleanups and scheduled starts wait in Postgres (lib/deferredJobs.js).
registerDeferredQueue(battleQueue);

const worker = new Worker("battles", handleBattleJob, {
  connection:  redis,
  concurrency: 10,
  // Reduce idle Redis traffic on per-request-billed providers (Upstash):
  // block the poll longer and check for stalled jobs far less often.
  drainDelay:  300,                         // seconds the idle poll blocks (a new job still wakes it at once)
  stalledInterval: 300_000,   // 5 min between stalled-job scans. Top level: BullMQ ignores it inside `settings`, which left every worker scanning every 30 s.
});
// Quota errors pause every worker instead of a 100 ms retry storm (lib/redisQuotaGuard.js).
guardWorker(worker, "battle worker");

// ─── Worker events ────────────────────────────────────────────────────────────
worker.on("completed", (job) => {
  console.log(`[battle-worker] ✅ ${job.data.action} battle=${job.data.battleId ?? ""}`);
  workerJob("battles", "done", job, { action: job.data?.action });
});
worker.on("failed",    (job, err) => {
  console.error(`[battle-worker] ❌ ${job?.data.action} failed:`, err.message);
  workerJob("battles", "failed", job, { action: job?.data?.action, error: err?.message });
});

export default worker;
