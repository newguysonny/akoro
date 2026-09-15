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
