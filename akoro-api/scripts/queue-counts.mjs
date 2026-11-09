#!/usr/bin/env node
// One-shot BullMQ cost diagnostic. The Upstash chart (EVALSHA/HMGET/HGET/DEL/
// RPOPLPUSH/ZPOPMIN/ZADD/ZRANGE/XADD) is BullMQ, so the question is "which queue
// is churning jobs?". Run where the API deps exist, with the SAME REDIS_URL:
//
//   REDIS_URL=redis://… node scripts/queue-counts.mjs
//
// Prints each queue's job counts and events-stream length, then exits.
// (The same table is available from a browser at GET /api/verify/queues?key=…)
import { queueCounts } from "../lib/queueHealth.js";

const report = await queueCounts();
if (report.error) { console.error(report.error); process.exit(1); }
console.table(report.queues);
console.log("\nbacklog = active+waiting+delayed+prioritized. The queue with the largest,");
console.log("fastest-growing backlog is the one consuming Redis commands.");
console.log("A large eventsStream (XLEN) = many job events appended (XADD).");
