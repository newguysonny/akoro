/**
 * modules/self-tooling/resumeQueue.js — the durable "resume-tool-request" job
 * (plan §7.11). An admin approval enqueues one job per waiting request; the
 * worker rebuilds the proposed tool as its learner and posts the answer into
 * the original chat. The request row is the authority (an idempotent claim),
 * so a lost or repeated job is harmless; a tick sweeps up waiting requests
 * whose job never ran, and expires requests nobody decided.
 */
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";

import { redisConnectionOptions } from "../../lib/redisOptions.js";
import { traceRedis } from "../../lib/redisTrace.js";
import { workerJob } from "../../lib/workerLog.js";
import { guardWorker } from "../../lib/redisQuotaGuard.js";
import cron from "node-cron";
import { registerTick, cronSource } from "../../lib/cronTicks.js";
import { resumeRequest, waitingResumes, expireRequests } from "./escalation.js";

const QUEUE_NAME = "self-tool-resumes";
let redis, workerRedis, queue, worker;

const conn = (label) => {
  const r = traceRedis(new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", redisConnectionOptions({ label })), label);
  r.on("error", (e) => console.error(`[${label} Redis]`, e.message));
  return r;
};

function resumeQueue() {
  if (queue) return queue;
  redis ||= conn("self-tool-resumes");
  queue = new Queue(QUEUE_NAME, {
    connection: redis,
    defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: { count: 200 }, removeOnFail: { count: 200 } },
  });
  return queue;
}

/**
 * Resume one request: a queue job when this deployment runs the worker, else
 * in this process (AKORO_JOBS_ENABLED may leave the worker off — a resume
 * must still happen). The row's claim makes either path safe to repeat.
 */
export async function enqueueResume(requestId) {
  if (worker) {
    await resumeQueue().add("resume-tool-request", { requestId }, { jobId: `resume-${requestId}-${Date.now()}` });
    return { mode: "queue" };
  }
  setImmediate(() => { runResume(requestId).catch((e) => console.warn("[self-tool-resumes] inline resume failed:", requestId, e.message)); });
  return { mode: "inline" };
}

/** Rebuild with the chat's deps (lazy: chat.js imports self-tooling). */
async function runResume(requestId) {
  const [{ createTool }, { selfToolDeps }] = await Promise.all([import("./pipeline.js"), import("../adaptive-learning/chat.js")]);
  return resumeRequest(requestId, {
    createTool: (args) => createTool({ ...args, ...selfToolDeps(args.learnerId) }),
  });
}

/** Tick: re-queue waiting resumes whose job was lost, and expire old requests. */
export async function sweepResumes() {
  const waiting = await waitingResumes();
  let queued = 0;
  for (const r of waiting) {
    if (r.resume_status === "resuming") {
      // A crashed worker left it claimed; hand it back.
      const { default: db } = await import("../../db.js");
      await db.schema("edu").from("agent_tool_requests").update({ resume_status: "waiting" }).eq("id", r.id).eq("resume_status", "resuming");
    }
    try { await enqueueResume(r.id); queued++; } catch { /* next sweep */ }
  }
  const { expired } = await expireRequests();
  return { queued, expired };
}

let swept = false;
/** Every 15 min: lost resumes re-queued, undecided requests expired. */
export function armSweep() {
  if (swept) return;
  swept = true;
  registerTick("self-tool-resume-sweep", sweepResumes);
  if (cronSource() !== "cloudflare") cron.schedule("*/15 * * * *", () => { sweepResumes().catch((e) => console.warn("[self-tool-resumes] sweep failed:", e.message)); });
}

export function startResumeWorker() {
  armSweep();
  if (worker) return worker;
  workerRedis ||= conn("self-tool-resumes");
  worker = new Worker(QUEUE_NAME, async (job) => runResume(job.data?.requestId), {
    connection: workerRedis, concurrency: 2, drainDelay: 60, stalledInterval: 300_000,
  });
  guardWorker(worker, "self-tool resumes worker");
  worker.on("completed", (job, result) => workerJob("self-tool-resumes", "done", job, { resumed: result?.resumed ?? false, skipped: result?.skipped ?? false }));
  worker.on("failed", (job, error) => {
    console.error(`[self-tool-resumes] failed job ${job?.id}:`, error.message);
    workerJob("self-tool-resumes", "failed", job, { error: error?.message });
  });
  return worker;
}

export { runResume };
