/**
 * lib/backgroundMigrate.js — once at boot, after the switch to one background
 * queue and Postgres-held far-off jobs (2026-10-23):
 *
 *   1. jobs still waiting in the six old queues (MERGED_QUEUES) move into the
 *      shared queue, with their ids, options and remaining delay; nothing
 *      polls the old queues any more, so a job left there would never run;
 *   2. on every queue this process releases into, delayed jobs further out
 *      than HOLD_MS and repeatable jobs move into edu.deferred_jobs.
 *
 * Idempotent: a second boot finds nothing to move. Costs a few Redis commands
 * per queue, once per boot.
 */
import { Queue } from "bullmq";
import Redis from "ioredis";
import { redisConnectionOptions } from "./redisOptions.js";
import { traceRedis } from "./redisTrace.js";
import { MERGED_QUEUES, backgroundQueue, sharedBackgroundQueue } from "./backgroundQueue.js";
import { absorbFarJobs, addLater, registeredQueues } from "./deferredJobs.js";

/** The data a recurring job is released with, when Redis no longer holds a sample of it. */
const repeatData = (r, sample) => sample?.data || (r.name.startsWith("task-") ? { taskId: r.name.slice(5) } : {});

export async function migrateBackgroundQueues() {
  const conn = traceRedis(new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", redisConnectionOptions({ label: "background-migrate" })), "background-migrate");
  conn.on("error", (e) => console.error("[background-migrate Redis]", e.message));
  const moved = {};
  try {
    for (const [oldName, kind] of Object.entries(MERGED_QUEUES)) {
      const old = new Queue(oldName, { connection: conn });
      try {
        let n = 0;
        for (const j of await old.getJobs(["waiting", "delayed", "prioritized", "paused"], 0, 999)) {
          if (!j) continue;
          const remaining = j.delay ? Math.max(0, j.timestamp + j.delay - Date.now()) : 0;
          const { delay, repeat, jobId, ...opts } = j.opts || {};
          const keep = /^\d+$/.test(String(j.id)) ? {} : { jobId: j.id };   // BullMQ refuses integer custom ids
          await addLater(backgroundQueue(kind), j.name, j.data || {}, { ...opts, ...keep, delay: remaining });
          await j.remove();
          n++;
        }
        for (const r of await old.getRepeatableJobs()) await old.removeRepeatableByKey(r.key);
        if (n) moved[oldName] = n;
      } finally {
        await old.close().catch(() => {});
      }
    }
    sharedBackgroundQueue();   // make sure it is registered for the absorb below
    const absorbed = {};
    for (const q of registeredQueues()) {
      const r = await absorbFarJobs(q, { repeatData });
      if (r.moved || r.repeats) absorbed[q.name] = r;
    }
    return { moved, absorbed };
  } finally {
    await conn.quit().catch(() => {});
  }
}
