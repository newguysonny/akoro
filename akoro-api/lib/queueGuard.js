/**
 * lib/queueGuard.js — bounded queues, a.k.a. backpressure (hardening plan §3.3).
 *
 * BullMQ workers already cap CONCURRENCY, but nothing capped DEPTH: if work
 * arrives faster than it drains (a viral lesson, a provider outage backed by
 * retries), the queue grows without bound — jobs sit in it past any client's
 * patience, memory creeps, and when the backlog finally drains it does so as
 * a thundering herd. The guard rejects the enqueue itself once a queue is at
 * capacity: an honest 503 + Retry-After (code queue_full) instead of a job
 * that would run an hour late and bill for the privilege.
 *
 * Env, per queue, all optional (default 500):
 *   QUEUE_MAX_TASKS / QUEUE_MAX_EVALS / QUEUE_MAX_FOLLOWUPS / QUEUE_MAX_AUTONOMY
 */
export class QueueFullError extends Error {
  constructor(queueName, retryAfterSec = 30) {
    super(`Service is at capacity — please retry in a moment. (queue: ${queueName})`);
    this.name = "QueueFullError";
    this.statusCode = 503;
    this.code = "queue_full";
    this.expose = true;
    this.retryAfterSec = retryAfterSec;
  }
}

const num = (key, fallback) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/**
 * Throw QueueFullError when the queue's waiting+delayed depth is at/over its
 * cap. Called BEFORE .add(). If the depth read itself fails (Redis hiccup),
 * the enqueue proceeds — a guard that blocks all work because it cannot look
 * is worse than no guard.
 */
export async function assertQueueCapacity(queue, { name, max, retryAfterSec = 30 } = {}) {
  if (!queue?.getJobCounts) return;
  const cap = max ?? num(`QUEUE_MAX_${String(name ?? "queue").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`, 500);
  const counts = await queue.getJobCounts("waiting", "delayed").catch(() => null);
  if (!counts) return;
  const depth = (counts.waiting || 0) + (counts.delayed || 0);
  if (depth >= cap) {
    console.warn(`[queue:${name}] at capacity — depth ${depth} ≥ ${cap}, rejecting enqueue`);
    throw new QueueFullError(name, retryAfterSec);
  }
}
