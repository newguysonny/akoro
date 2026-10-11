/**
 * lib/redisQuotaGuard.js — stop hammering Redis once its quota is gone.
 *
 * Upstash's free tier allows 500k commands a month. When it runs out, every
 * command comes back with an error, and a BullMQ worker answers an error by
 * waiting 100 ms and trying again — for ever. Six idle workers doing that
 * all day sent ~700 MB/hour of failed commands to Upstash and burned the
 * Render bandwidth cap (Oct 2026) with no users at all.
 *
 * So: every worker is registered here. The first quota error trips the
 * guard, which PAUSES every worker (no fetching, no polling) for a cool-down,
 * then resumes them. If the quota is still gone the next error trips it
 * again, with a longer wait each time (30 min → 1 h → … → 6 h). Any other
 * error is left alone — a transient blip must not stop the queue.
 */
const COOLDOWN_MS = Math.max(60_000, Number(process.env.REDIS_QUOTA_COOLDOWN_MS) || 30 * 60_000);
const MAX_COOLDOWN_MS = 6 * 3_600_000;

const workers = new Map();   // label → worker
let trippedUntil = 0;
let strikes = 0;
let resumeTimer = null;

/** Upstash / Redis "you are over your limit" replies. */
export const isQuotaError = (err) =>
  /max (daily )?requests? limit|max requests limit exceeded|command quota|exceeded.*(limit|quota)|ERR max/i.test(String(err?.message || err || ""));

export const redisQuotaTripped = () => Date.now() < trippedUntil;

export function redisQuotaStatus() {
  return { tripped: redisQuotaTripped(), until: trippedUntil ? new Date(trippedUntil).toISOString() : null, strikes, workers: [...workers.keys()] };
}

async function pauseAll() {
  for (const [label, w] of workers) {
    try { await w.pause(true); } catch (e) { console.warn(`[redis-quota] could not pause ${label}:`, e?.message); }
  }
}

function resumeAll() {
  for (const [label, w] of workers) {
    try { w.resume(); } catch (e) { console.warn(`[redis-quota] could not resume ${label}:`, e?.message); }
  }
}

/** Trip the guard (idempotent while tripped). */
export function tripRedisQuota(source = "redis") {
  if (redisQuotaTripped()) return;
  strikes++;
  const wait = Math.min(MAX_COOLDOWN_MS, COOLDOWN_MS * 2 ** (strikes - 1));
  trippedUntil = Date.now() + wait;
  console.error(`[redis-quota] ${source}: Redis command quota exhausted — pausing ${workers.size} background worker(s) for ${Math.round(wait / 60_000)} min instead of retrying every 100 ms. Upgrade the Redis plan or wait for the monthly reset.`);
  pauseAll();
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => {
    console.log("[redis-quota] cool-down over — resuming background workers");
    resumeAll();
  }, wait);
  resumeTimer.unref?.();
}

/** A command went through: the quota is back, so the next trip starts short again. */
export function redisQuotaOk() { if (!redisQuotaTripped()) strikes = 0; }

/** Register a BullMQ worker: quota errors trip the guard, and it is paused with the rest. */
export function guardWorker(worker, label) {
  workers.set(label, worker);
  worker.on("error", (err) => { if (isQuotaError(err)) tripRedisQuota(label); });
  worker.on("completed", redisQuotaOk);
  return worker;
}
