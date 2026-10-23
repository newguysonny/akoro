/**
 * Redis idle cost (2026-10-23): a far-off job waits in Postgres
 * (edu.deferred_jobs), is released to the shared background queue when due
 * and runs on the one background worker; cancelling drops its row; after the
 * boot clean-up the old per-module queues are empty and no queue that stays
 * in Redis holds a delayed job further out than the hold window.
 */
import { Queue } from "bullmq";

const seen = new Map();   // marker → job data (the probe kind's processor writes here)

export const deferredRelease = {
  name: "ops.deferred_release", area: "ops", risk: "write",
  description: "A job due in 2 h waits as a Postgres row (no Redis), is released when due and runs on the shared background worker; cancel drops the row; the old queues are drained and nothing far-off waits in Redis.",
  async run(ctx) {
    const [{ default: db }, bgq, dj] = await Promise.all([
      import("../../../db.js"), import("../../../lib/backgroundQueue.js"), import("../../../lib/deferredJobs.js"),
    ]);
    if (!process.env.REDIS_URL) ctx.expect.blocked("REDIS_URL is not set on this deployment");
    const rows = () => db.schema("edu").from("deferred_jobs");
    const probe = await rows().select("id").limit(1);
    if (probe.error) ctx.expect.blocked(`edu.deferred_jobs is not readable (migration 2026-deferred-jobs.sql): ${probe.error.message}`);

    const worker = bgq.handleBackground("verify-probe", async (job) => { seen.set(job.data.marker, job.data); return { ok: true }; }, { concurrency: 1 });
    ctx.expect.eq("the shared worker blocks 5 minutes when idle", worker.opts?.drainDelay, 300);
    const q = bgq.backgroundQueue("verify-probe", { attempts: 1, removeOnComplete: true, removeOnFail: true });
    const m = ctx.marker.replace(/[^a-z0-9]/gi, "").slice(-10);
    const key = `verify-probe-${m}`;
    ctx.cleanup(() => rows().delete().eq("queue", bgq.BACKGROUND_QUEUE).like("job_key", `verify-probe-${m}%`));

    // 1. Two hours out: a row, not a Redis job.
    const added = await dj.addLater(q, "probe", { marker: m }, { jobId: key, delay: 2 * 3600_000 });
    ctx.expect.eq("it is deferred", added?.deferred, true);
    const { data: row } = await rows().select("*").eq("queue", bgq.BACKGROUND_QUEUE).eq("job_key", key).maybeSingle();
    ctx.expect.ok("its row is in edu.deferred_jobs", !!row, added);
    ctx.expect.eq("…carrying its kind", row?.data?._bg, "verify-probe");
    ctx.expect.ok("Redis holds no job for it yet", !(await q.getJob(key)));

    // 2. Due now → released → runs on the shared worker.
    await rows().update({ due_at: new Date().toISOString() }).eq("id", row?.id);
    const rel = await dj.releaseDue();
    ctx.note(`release: ${JSON.stringify(rel)}`);
    const ran = await ctx.until(() => seen.get(m), { timeoutMs: 30_000, everyMs: 1_000 }).catch(() => null);
    ctx.expect.ok("the released job ran on the background worker", !!ran);
    const { data: gone } = await rows().select("id").eq("id", row?.id ?? "00000000-0000-0000-0000-000000000000");
    ctx.expect.eq("its row is gone", (gone || []).length, 0);

    // 3. Cancel before it is due: the row goes.
    const key2 = `${key}-c`;
    await dj.addLater(q, "probe", { marker: `${m}-c` }, { jobId: key2, delay: 2 * 3600_000 });
    ctx.expect.eq("cancel drops the row", await dj.cancelLater(q, key2), 1);

    // 4. The old per-module queues are drained; nothing far-off waits in Redis.
    for (const oldName of Object.keys(bgq.MERGED_QUEUES)) {
      const old = new Queue(oldName, { connection: bgq.sharedBackgroundQueue().opts.connection });
      const c = await old.getJobCounts("waiting", "delayed", "prioritized");
      await old.close().catch(() => {});
      ctx.expect.eq(`old queue ${oldName} is empty`, (c.waiting || 0) + (c.delayed || 0) + (c.prioritized || 0), 0);
    }
    for (const live of dj.registeredQueues()) {
      const far = (await live.getJobs(["delayed"], 0, 999)).filter((j) => j && j.timestamp + (j.delay || 0) - Date.now() > dj.HOLD_MS + 60_000);
      ctx.expect.eq(`${live.name}: no delayed job further out than the hold window`, far.map((j) => `${j.name}:${j.id}`), []);
    }
  },
};
