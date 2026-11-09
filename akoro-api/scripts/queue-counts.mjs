#!/usr/bin/env node
// One-shot BullMQ cost diagnostic. The Upstash chart (EVALSHA/HMGET/HGET/DEL/
// RPOPLPUSH/ZPOPMIN/XADD/ZADD/ZRANGE) is BullMQ, so the question is "which queue
// is churning jobs?" — not "what is our app reading?". Run where the API deps
// exist, with the SAME REDIS_URL:
//
//   REDIS_URL=redis://… node scripts/queue-counts.mjs
//
// Prints each queue's job counts and the events-stream length (XLEN), then exits.
// Safe to run: a handful of read commands, one time.

import Redis from "ioredis";
import { Queue } from "bullmq";
import { redisConnectionOptions } from "../lib/redisOptions.js";

const url = process.env.REDIS_URL;
if (!url) { console.error("REDIS_URL is not set"); process.exit(1); }

const PREFIX = process.env.BULLMQ_PREFIX || "bull";
const QUEUES = ["agent-background", "battles", "task-runner", "video-encoding", "session-notifications"];
const TYPES = ["waiting", "active", "delayed", "prioritized", "waiting-children", "completed", "failed", "paused"];

const probe = new Redis(url, redisConnectionOptions({ label: "queue-counts" }));
const rows = [];

for (const name of QUEUES) {
  // Dedicated connection per queue: BullMQ owns/uses it; we never share one across Queues.
  const conn = new Redis(url, redisConnectionOptions({ label: `queue-counts:${name}` }));
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

rows.sort((a, b) => (b.backlog || 0) - (a.backlog || 0));
console.table(rows);
console.log("\nbacklog = active+waiting+delayed+prioritized (+waiting-children omitted).");
console.log("The queue with the largest/rapidly-growing backlog is the one consuming Redis commands.");
console.log("A large eventsStream (XLEN) means lots of job events are being appended (XADD).");
await probe.quit().catch(() => {});
process.exit(0);
