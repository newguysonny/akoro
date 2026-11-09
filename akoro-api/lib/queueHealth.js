/**
 * lib/queueHealth.js — one-shot BullMQ cost diagnostic.
 *
 * The Upstash command mix for BullMQ is EVALSHA/HMGET/HGET/DEL/RPOPLPUSH/
 * ZPOPMIN/ZRANGEBYSCORE/ZADD/ZRANGE/XADD, so the question behind a rising bill
 * is "which queue is churning jobs?". This reads each queue's job counts and the
 * events-stream length (XLEN) once. Used by scripts/queue-counts.mjs and the
 * gate's GET /api/verify/queues (so it can be read from a browser).
 */
import Redis from "ioredis";
import { Queue } from "bullmq";
import { redisConnectionOptions } from "./redisOptions.js";

const PREFIX = process.env.BULLMQ_PREFIX || "bull";
const QUEUES = ["agent-background", "battles", "task-runner", "video-encoding", "session-notifications"];
const TYPES = ["waiting", "active", "delayed", "prioritized", "waiting-children", "completed", "failed", "paused"];

export async function queueCounts({ redisUrl = process.env.REDIS_URL } = {}) {
  if (!redisUrl) return { error: "REDIS_URL is not set on this service", queues: [] };

  const probe = new Redis(redisUrl, redisConnectionOptions({ label: "queue-health-probe" }));
  const rows = [];
  try {
    for (const name of QUEUES) {
      const conn = new Redis(redisUrl, redisConnectionOptions({ label: `queue-health:${name}` }));
      let counts = {};
      try {
        const q = new Queue(name, { connection: conn });
        counts = await q.getJobCounts(...TYPES);
        await q.close();
      } catch (e) {
        counts = { error: String(e?.message || e).slice(0, 80) };
      }
      const eventsStream = await probe.xlen(`${PREFIX}:${name}:events`).catch(() => null);
      const backlog = (counts.active || 0) + (counts.waiting || 0) + (counts.delayed || 0) + (counts.prioritized || 0);
      rows.push({ queue: name, backlog, eventsStream, ...counts });
      await conn.quit().catch(() => {});
    }
  } finally {
    await probe.quit().catch(() => {});
  }
  rows.sort((a, b) => (b.backlog || 0) - (a.backlog || 0));
  return { at: new Date().toISOString(), queues: rows };
}
