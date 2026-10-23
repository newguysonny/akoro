/**
 * lib/deferredJobs.js — far-future queue jobs wait in Postgres, not Redis.
 *
 * Why: a BullMQ queue holding ANY delayed job makes its worker poll Redis
 * every 10 seconds (BullMQ caps the blocking wait at 10 s whenever a delayed
 * job exists), however far away that job is and whatever drainDelay says.
 * A battle's 48-hour idle cleanup, a learner's next review, a recurring
 * task's next run: each kept a worker polling around the clock, ~17k
 * commands a day per worker on per-command-billed Redis.
 *
 *   addLater(queue, name, data, opts)   instead of queue.add(...) for jobs that
 *                                       may be far off. Due within HOLD_MS (10
 *                                       min) → straight to the queue, as before.
 *                                       Later, or { repeat: { pattern, tz } } →
 *                                       a row in edu.deferred_jobs.
 *   cancelLater(queue, jobKey)          drop a waiting row (with the job id it
 *                                       would be released under).
 *   releaseDue()                        every minute: rows due within ~90 s are
 *                                       added to their queue with the remaining
 *                                       delay; a recurring row moves on to its
 *                                       next run. No Redis is touched while
 *                                       nothing is due.
 *
 * Semantics kept from BullMQ: a row released under a jobId that is already in
 * the queue (any state) is not added again — exactly what queue.add does with
 * a duplicate jobId. The rules themselves live in deferredJobsCore.js.
 */
import { randomUUID } from "node:crypto";
import db from "../db.js";
import { HOLD_MS, RELEASE_LEAD_MS, nextCronRun, planAdd, releaseJobId, storedOpts } from "./deferredJobsCore.js";

export { HOLD_MS };

const table = () => db.schema("edu").from("deferred_jobs");
const queues = new Map();   // queue name → the BullMQ Queue rows are released into
const rawOf = (q) => (typeof q?.raw === "function" ? q.raw() : q);

/** Make a queue's waiting rows releasable from this process. */
export function registerDeferredQueue(q) {
  const raw = rawOf(q);
  if (raw?.name) queues.set(raw.name, raw);
  return q;
}

/** The queues this process can release into (the boot clean-up walks them). */
export const registeredQueues = () => [...queues.values()];

/** queue.add, but a far-off or recurring job waits in Postgres. → { id, name, deferred } */
export async function addLater(q, name, data = {}, opts = {}) {
  const plan = planAdd(opts);
  if (plan.direct) return q.add(name, data, opts);
  registerDeferredQueue(q);
  // A facade (lib/backgroundQueue.js) folds its own defaults and routing into the job first.
  const prepared = typeof q.prepare === "function" ? q.prepare(name, data, opts) : { data, opts };
  const row = {
    queue: rawOf(q).name,
    job_key: opts.jobId || `deferred-${randomUUID()}`,
    name,
    data: prepared.data,
    opts: storedOpts(prepared.opts),
    repeat: plan.repeat,
    due_at: plan.dueAt.toISOString(),
  };
  // Same jobId again: kept as is (BullMQ's rule), unless replace — then it is pushed back / updated.
  const { error } = await table().upsert(row, { onConflict: "queue,job_key", ignoreDuplicates: !opts.replace });
  if (error) throw new Error(`could not defer job ${name}: ${error.message}`);
  return { id: row.job_key, name, deferred: true, dueAt: row.due_at };
}

/** Drop a waiting row. Never throws (the job's own status check is the authority). */
export async function cancelLater(q, jobKey) {
  if (!jobKey) return 0;
  const { data, error } = await table().delete().eq("queue", rawOf(q).name).eq("job_key", jobKey).select("id");
  if (error) console.warn("[deferred-jobs] cancel failed:", error.message);
  return (data || []).length;
}

/** Hand every row due within ~90 s to its queue. → { released, skipped, kept } */
export async function releaseDue(now = Date.now()) {
  const { data: rows, error } = await table().select("*")
    .lte("due_at", new Date(now + RELEASE_LEAD_MS).toISOString())
    .order("due_at").limit(200);
  if (error) throw new Error(`deferred jobs read failed: ${error.message}`);
  let released = 0, skipped = 0, kept = 0;
  for (const r of rows || []) {
    const q = queues.get(r.queue);
    if (!q) { kept++; continue; }   // its queue isn't open in this process
    // Claim the row first, so two processes never release it twice.
    let claimed;
    if (r.repeat) {
      const next = nextCronRun(r.repeat.pattern, r.repeat.tz, new Date(Math.max(now, Date.parse(r.due_at)) + 1000));
      ({ data: claimed } = await table().update({ due_at: next.toISOString() }).eq("id", r.id).eq("due_at", r.due_at).select("id"));
    } else {
      ({ data: claimed } = await table().delete().eq("id", r.id).select("id"));
    }
    if (!claimed?.length) continue;
    const jobId = releaseJobId(r);
    try {
      if (await q.getJob(jobId)) { skipped++; continue; }   // already queued under that id
      await q.add(r.name, r.data || {}, { ...(r.opts || {}), jobId, delay: Math.max(0, Date.parse(r.due_at) - Date.now()) });
      released++;
    } catch (e) {
      console.warn(`[deferred-jobs] release of ${r.queue}/${r.name} failed:`, e.message);
      // A one-off row goes back so the next tick tries again (a recurring row already moved on).
      if (!r.repeat) {
        const { id, created_at, ...back } = r;
        await table().upsert(back, { onConflict: "queue,job_key", ignoreDuplicates: true });
      }
    }
  }
  return { released, skipped, kept };
}

/**
 * Once at boot, per queue: delayed jobs further out than HOLD_MS, and
 * repeatable jobs, move out of Redis into rows. Idempotent: what is left in
 * Redis afterwards is only near-term work. → { moved, repeats }
 */
export async function absorbFarJobs(q, { repeatData = (r, sample) => sample?.data || {} } = {}) {
  const raw = rawOf(q);
  registerDeferredQueue(raw);
  let moved = 0, repeats = 0;
  const delayed = await raw.getJobs(["delayed"], 0, 999);
  for (const r of (await raw.getRepeatableJobs?.()) || []) {
    const sample = delayed.find((j) => j?.repeatJobKey === r.key);
    await addLater(raw, r.name, repeatData(r, sample), { jobId: `repeat-${r.name}`, replace: true, repeat: { pattern: r.pattern, tz: r.tz } });
    await raw.removeRepeatableByKey(r.key);
    repeats++;
  }
  for (const j of delayed) {
    if (!j) continue;
    if (j.repeatJobKey) { await j.remove().catch(() => {}); continue; }   // its repeat now lives in a row
    const remaining = j.timestamp + (j.delay || 0) - Date.now();
    if (remaining <= HOLD_MS) continue;
    const { delay, repeat, jobId, ...opts } = j.opts || {};
    // BullMQ refuses integer custom ids: an auto id is not carried over.
    const keep = /^\d+$/.test(String(j.id)) ? {} : { jobId: j.id };
    await addLater(raw, j.name, j.data, { ...opts, ...keep, delay: remaining });
    await j.remove();
    moved++;
  }
  return { moved, repeats };
}

let timer = null;
/** The release clock: every minute, in-process (it reads Postgres only). */
export function startDeferredRelease({ everyMs = 60_000 } = {}) {
  if (timer) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await releaseDue();
      if (r.released || r.skipped) console.log(`[deferred-jobs] released ${r.released}${r.skipped ? `, ${r.skipped} already queued` : ""}`);
    } catch (e) {
      console.warn("[deferred-jobs] tick failed:", e.message);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, everyMs);
  timer.unref?.();
  setTimeout(tick, 5_000).unref?.();
}
