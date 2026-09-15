/**
 * lib/redisOptions.js
 * Shared ioredis connection options for all BullMQ queues/workers.
 *
 * Why this exists:
 *   On per-request-billed Redis (Upstash), a reconnect storm or tight error
 *   loop can burn thousands of requests per second. These options space out
 *   reconnection attempts so a transient failure (or an over-quota error)
 *   can't snowball into a runaway loop that re-drains the quota in minutes.
 *
 * BullMQ requirements (do not change):
 *   - maxRetriesPerRequest: null   — BullMQ manages its own retries
 *   - enableReadyCheck:     false  — avoids extra INFO calls per connect
 */

export const bullRedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck:     false,

  // Exponential-ish backoff between reconnection attempts, capped at 10s.
  // Without this, ioredis reconnects almost instantly in a tight loop,
  // hammering Redis (and the request meter) when it's unhealthy.
  retryStrategy: (times) => Math.min(1000 * 2 ** Math.min(times, 4), 10_000),

  // Only force a reconnect on real, recoverable connection errors — never
  // on ordinary error replies like "max requests limit exceeded", which
  // would otherwise trigger a reconnect-per-command storm.
  reconnectOnError: (err) => {
    const target = "READONLY";
    return err.message.includes(target);
  },
};

export default bullRedisOptions;

/**
 * redisConnectionOptions({ label }) — per-client options with a boot guard.
 *
 * When REDIS_URL is genuinely unset, every BullMQ client previously fell
 * back to redis://localhost:6379 and retried FOREVER, printing an unhandled
 * ECONNREFUSED storm (~1/s at boot, ~20s apart after) with no hint which
 * knob was missing. With the guard: five quick attempts, ONE clear warning
 * per client, then the client goes quiet-and-idle — the deploy is only
 * fixed by setting REDIS_URL, and the banner already shows it as null.
 * A REAL REDIS_URL keeps the existing reconnect-forever behaviour — a
 * transient Upstash outage must never permanently stop a worker.
 */
const warned = new Set();

export function redisConnectionOptions({ label = "redis-client" } = {}) {
  const url = String(process.env.REDIS_URL ?? "").trim();
  if (!url) {
    if (!warned.has(label)) {
      warned.add(label);
      console.warn(`[redis] ${label}: REDIS_URL is not set — background jobs for this client stay idle until the env var is added (Render → Environment).`);
    }
    return {
      ...bullRedisOptions,
      retryStrategy: (times) => (times > 5 ? null : Math.min(1000 * 2 ** Math.min(times, 4), 10_000)),
    };
  }
  return { ...bullRedisOptions };
}

