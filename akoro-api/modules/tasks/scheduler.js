/**
 * modules/tasks/scheduler.js
 * Translates task records into BullMQ jobs.
 * Converted from TypeScript to JS ESM.
 */

import { Queue }    from "bullmq";
import Redis        from "ioredis";
import { TaskDB, TaskScheduleDB } from "./lib/db.js";
import { redisConnectionOptions }       from "../../lib/redisOptions.js";
import { traceRedis } from "../../lib/redisTrace.js";

const redis = traceRedis(new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", redisConnectionOptions({ label: "tasks-scheduler" })), "tasks-scheduler");
redis.on("error", (err) => console.error("[tasks/scheduler Redis]", err.message));

export const taskQueue = new Queue("task-runner", {
  connection: redis,
  defaultJobOptions: {
    attempts:         3,
    backoff:          { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 200 },
    removeOnFail:     { count: 500 },
  },
});

export async function scheduleTask(task) {
  let bullJobId;
  const jobData = { taskId: task.id };

  if (task.is_recurring) {
    const schedule = await TaskScheduleDB.findByTask(task.id);
    if (!schedule) throw new Error(`No schedule found for recurring task ${task.id}`);
    bullJobId = await scheduleRecurring(task, schedule.cron_expr, schedule.timezone, jobData);
  } else if (task.due_at && new Date(task.due_at) > new Date()) {
    bullJobId = await scheduleDelayed(task, new Date(task.due_at), jobData);
  } else {
    bullJobId = await scheduleImmediate(task, jobData);
  }

  await TaskDB.updateStatus(task.id, "queued", { bullJobId });
  return bullJobId;
}

async function scheduleImmediate(task, jobData) {
  const job = await taskQueue.add(`task-${task.id}`, jobData);
  return job.id;
}

async function scheduleDelayed(task, runAt, jobData) {
  const delayMs = runAt.getTime() - Date.now();
  const job     = await taskQueue.add(`task-${task.id}`, jobData, { delay: Math.max(0, delayMs) });
  return job.id;
}

async function scheduleRecurring(task, cronExpr, timezone, jobData) {
  const job = await taskQueue.add(`task-${task.id}`, jobData, {
    repeat: { pattern: cronExpr, tz: timezone ?? "Africa/Lagos" },
  });
  return job.id ?? `cron-${task.id}`;
}

export async function cancelTask(bullJobId, taskId) {
  try {
    if (bullJobId) {
      const job = await taskQueue.getJob(bullJobId);
      if (job) await job.remove();
    }
    // A recurring task's delayed jobs are spawned by a repeatable entry, which
    // survives removing any single job — so drop the repeat itself too, or the
    // "deleted" task keeps firing on its cron.
    if (taskId) {
      const repeats = await taskQueue.getRepeatableJobs();
      for (const r of repeats) {
        if (r.name === `task-${taskId}`) await taskQueue.removeRepeatableByKey(r.key);
      }
    }
  } catch (e) {
    console.warn("[tasks/scheduler] Cancel failed:", e.message);
  }
}

export async function triggerNow(task) {
  const job = await taskQueue.add(`trigger-${task.id}`, { taskId: task.id }, { priority: 1 });
  return job.id;
}

export async function getQueueHealth() {
  const [waiting, active, failed] = await Promise.all([
    taskQueue.getWaitingCount(),
    taskQueue.getActiveCount(),
    taskQueue.getFailedCount(),
  ]);
  return { waiting, active, failed };
}

export async function recoverOverdueTasks() {
  const overdue = await TaskDB.findOverdue();
  for (const task of overdue) {
    await scheduleTask(task).catch((e) => console.warn(`[tasks] Could not recover task ${task.id}:`, e.message));
  }
  return overdue.length;
}
