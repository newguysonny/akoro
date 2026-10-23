/**
 * lib/backgroundQueue.js — ONE BullMQ queue + worker for the quiet background
 * work (chat follow-ups, learner check-ins, quiet learning, self-tool
 * resumes, evals, the autonomy cycle).
 *
 * Each of those used to have its own queue and worker, and an idle BullMQ
 * worker polls Redis on its own (one blocking wait + one check per wake), so
 * six mostly-idle workers cost six times the commands of one. Now each module
 * keeps its code and its job options but talks to the shared queue:
 *
 *   const q = backgroundQueue("chat-follow-ups", { attempts: 3, … })
 *   q.add(name, data, opts)        → the shared queue; data carries the kind
 *   handleBackground("chat-follow-ups", processor, { concurrency, onCompleted, onFailed })
 *
 * The one worker routes each job to its kind's processor. A kind keeps its
 * own concurrency (evals still run one at a time) through an in-process slot
 * count; the worker's own concurrency is the sum of the registered kinds.
 */
import { DelayedError, Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { redisConnectionOptions } from "./redisOptions.js";
import { traceRedis } from "./redisTrace.js";
import { guardWorker } from "./redisQuotaGuard.js";
import { registerDeferredQueue } from "./deferredJobs.js";

export const BACKGROUND_QUEUE = "agent-background";
/** The queues merged into it (lib/backgroundMigrate.js moves their leftover jobs over). */
export const MERGED_QUEUES = {
  "agent-chat-follow-ups": "chat-follow-ups",
  "learner-agent-autonomy": "learner-autonomy",
  "quiet-learning": "quiet-learning",
  "self-tool-resumes": "self-tool-resumes",
  evals: "evals",
  "autonomy-cycle": "autonomy-cycle",
};

let queueRedis, workerRedis, queue, worker;
const handlers = new Map();   // kind → { processor, concurrency, running, waiters, onCompleted, onFailed }

const connection = (label) => {
  const r = traceRedis(new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", redisConnectionOptions({ label })), label);
  r.on("error", (e) => console.error(`[${label} Redis]`, e.message));
  return r;
};

/** The shared BullMQ queue (no defaults of its own: each kind brings its job options). */
export function sharedBackgroundQueue() {
  if (queue) return queue;
  queueRedis ||= connection("agent-background");
  queue = new Queue(BACKGROUND_QUEUE, { connection: queueRedis });
  registerDeferredQueue(queue);
  return queue;
}

/** PURE: the data and options a kind's job is added with. */
export function prepareBackgroundJob(kind, defaults, data = {}, opts = {}) {
  return { data: { ...data, _bg: kind }, opts: { ...defaults, ...opts } };
}

/** A kind's view of the shared queue: same calls the modules made on their own queue. */
export function backgroundQueue(kind, defaults = {}) {
  return {
    name: BACKGROUND_QUEUE,
    kind,
    raw: sharedBackgroundQueue,
    prepare: (name, data, opts) => prepareBackgroundJob(kind, defaults, data, opts),
    add(name, data, opts) {
      const p = prepareBackgroundJob(kind, defaults, data, opts);
      return sharedBackgroundQueue().add(name, p.data, p.opts);
    },
    getJob: (id) => sharedBackgroundQueue().getJob(id),
    remove: (id) => sharedBackgroundQueue().remove(id),
    getJobCounts: (...types) => sharedBackgroundQueue().getJobCounts(...types),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run fn within the kind's own concurrency. */
async function inSlot(h, fn) {
  while (h.running >= h.concurrency) await new Promise((resolve) => h.waiters.push(resolve));
  h.running++;
  try {
    return await fn();
  } finally {
    h.running--;
    h.waiters.shift()?.();
  }
}

async function route(job, token) {
  const kind = job.data?._bg;
  // Kinds register as their modules load at boot; a job picked up a moment before its kind did waits for it.
  let h = handlers.get(kind);
  for (let i = 0; !h && i < 30; i++) { await sleep(1000); h = handlers.get(kind); }
  if (!h) {
    // That kind's worker is switched off here (AKORO_JOBS_*): park the job instead of
    // failing it — the old per-module queue would simply have held it.
    console.warn(`[agent-background] no handler for "${kind}" in this process; job ${job.id} parked for 15 min`);
    await job.moveToDelayed(Date.now() + 15 * 60_000, token);
    throw new DelayedError();
  }
  return inSlot(h, () => h.processor(job));
}

function ensureWorker() {
  if (worker) return worker;
  workerRedis ||= connection("agent-background-worker");
  worker = new Worker(BACKGROUND_QUEUE, route, {
    connection: workerRedis,
    concurrency: 1,
    // Idle: one blocking wait per 5 minutes. A new job wakes it at once (BullMQ's
    // marker), so this costs no latency — only the idle polling.
    drainDelay: 300,
    stalledInterval: 300_000,   // top level — BullMQ ignores it inside `settings`
  });
  guardWorker(worker, "background worker");
  worker.on("completed", (job, result) => handlers.get(job.data?._bg)?.onCompleted?.(job, result));
  worker.on("failed", (job, error) => handlers.get(job?.data?._bg)?.onFailed?.(job, error));
  worker.on("error", (e) => console.error("[agent-background/worker]", e.message));
  return worker;
}

/** Register a kind's processor; starts the shared worker on first use. → the shared worker */
export function handleBackground(kind, processor, { concurrency = 2, onCompleted, onFailed } = {}) {
  handlers.set(kind, { processor, concurrency: Math.max(1, concurrency), running: 0, waiters: [], onCompleted, onFailed });
  const w = ensureWorker();
  w.concurrency = [...handlers.values()].reduce((n, h) => n + h.concurrency, 0);
  return w;
}
