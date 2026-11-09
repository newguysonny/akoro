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
import { assertQueueCapacity } from "../../lib/queueGuard.js";
import { addLater, cancelLater, registerDeferredQueue } from "../../lib/deferredJobs.js";
import { nextCronRun } from "../../lib/deferredJobsCore.js";

const redis = traceRedis(new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", redisConnectionOptions({ label: "tasks-scheduler" })), "tasks-scheduler");
redis.on("error", (err) => console.error("[tasks/scheduler Redis]", err.message));

export const taskQueue = new Queue("task-runner", {
  connection: redis,
  defaultJobOptions: {
    attempts:         3,
    backoff:          { type: "exponential", delay: 5000 },
    // Retention knob: keep almost nothing — every retained job is extra hash reads/cleanup.
    removeOnComplete: true,
    removeOnFail:     { count: 10 },
  },
});
// Far-off and recurring runs wait in Postgres (lib/deferredJobs.js), not as delayed jobs in Redis.
registerDeferredQueue(taskQueue);

const tasksTickEnabled = () => String(process.env.TASKS_TICK ?? "on").trim().toLowerCase() !== "off";
export const TASK_TICK_MARK = "tick";

/** Tick mode: no BullMQ job per task — persist it as due in Postgres; the 1/min tick runs it. */
async function queueTaskInPostgres(task) {
  if (task.is_recurring) {
    const schedule = await TaskScheduleDB.findByTask(task.id);
    if (!schedule) throw new Error(`No schedule found for recurring task ${task.id}`);
    const next = nextCronRun(schedule.cron_expr, schedule.timezone, new Date());
    await TaskDB.update(task.id, { status: "queued", due_at: next.toISOString(), bull_job_id: TASK_TICK_MARK });
    return TASK_TICK_MARK;
  }
  await TaskDB.updateStatus(task.id, "queued", { bullJobId: TASK_TICK_MARK });
  return TASK_TICK_MARK;
}

export async function scheduleTask(task) {
  if (tasksTickEnabled()) return queueTaskInPostgres(task);

  // Legacy: one BullMQ job per task (TASKS_TICK=off rollback path).
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
  // A stable id per due time: re-scheduling the same run (boot recovery) adds nothing.
  const job     = await addLater(taskQueue, `task-${task.id}`, jobData, { delay: Math.max(0, delayMs), jobId: `task-${task.id}-at-${runAt.getTime()}` });
  return job.id;
}

async function scheduleRecurring(task, cronExpr, timezone, jobData) {
  // One row per task (replace: a changed pattern updates it); each run is released with its own id.
  const job = await addLater(taskQueue, `task-${task.id}`, jobData, {
    jobId: `repeat-task-${task.id}`,
    replace: true,
    repeat: { pattern: cronExpr, tz: timezone ?? "Africa/Lagos" },
  });
  return job.id;
}

export async function cancelTask(bullJobId, taskId) {
  try {
    if (bullJobId) {
      await cancelLater(taskQueue, bullJobId);
      const job = await taskQueue.getJob(bullJobId);
      if (job) await job.remove();
    }
    if (taskId) await cancelLater(taskQueue, `repeat-task-${taskId}`);
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
  if (tasksTickEnabled()) {
    await TaskDB.update(task.id, { status: "queued", due_at: new Date().toISOString(), bull_job_id: TASK_TICK_MARK });
    return TASK_TICK_MARK;
  }
  const job = await taskQueue.add(`trigger-${task.id}`, { taskId: task.id }, { priority: 1 });
  return job.id;
}

/**
 * ONE repeatable job (1/min) that drains due tasks — replaces one BullMQ job per
 * task. BullMQ charges per job (add/move/XADD/finish/DEL), so one job per task
 * was the Redis bill; this makes it ~1 job/minute regardless of task count.
 */
export async function startTaskTick() {
  if (!tasksTickEnabled()) return { skipped: "TASKS_TICK=off" };
  await taskQueue.add("task-tick", { _tick: true }, {
    repeat: { pattern: "* * * * *" }, jobId: "task-tick",
    removeOnComplete: true, removeOnFail: { count: 5 }, attempts: 1,
  }).catch((e) => console.warn("[tasks] tick register failed:", e.message));
  return { registered: true };
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
  if (tasksTickEnabled()) return 0;   // the tick drains due tasks from Postgres
  const overdue = await TaskDB.findOverdue();
  for (const task of overdue) {
    await scheduleTask(task).catch((e) => console.warn(`[tasks] Could not recover task ${task.id}:`, e.message));
  }
  return overdue.length;
}
