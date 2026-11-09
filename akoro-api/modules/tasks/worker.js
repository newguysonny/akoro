/**
 * modules/tasks/worker.js
 * BullMQ worker that runs the OpenAI agent loop (function calling) for task
 * execution. Converted from TypeScript to JS ESM.
 */

import { Worker }   from "bullmq";
import Redis        from "ioredis";
import { TaskDB, TaskRunDB, AgentDB, TaskScheduleDB } from "./lib/db.js";
import db from "../../db.js";
import { scheduleAutonomyReviewForTask } from "../adaptive-learning/learner-autonomy.js";
import { buildContext }               from "./lib/context.js";
import { deliver, deliverError, deliverProgress } from "./lib/deliver.js";
import { getToolsForTask }                        from "./tools/index.js";
import { recoverOverdueTasks, startTaskTick }       from "./scheduler.js";
import { nextCronRun } from "../../lib/deferredJobsCore.js";
import { redisConnectionOptions }                        from "../../lib/redisOptions.js";
import { traceRedis } from "../../lib/redisTrace.js";
import { OPENAI_MODEL } from "../../lib/aiModel.js";
import { hasCoins } from "../../lib/coins.js";
// The loop lives in lib/agentLoop.js so the eval suite can run THIS loop
// against stub tools rather than a copy of it. What stays here is everything
// an eval must not do: billing, DB writes, delivery.
import { runAgentLoop } from "./lib/agentLoop.js";
import { reportAgentActivity, agentToolActivity, clearAgentActivity } from "../../lib/agentActivity.js";
import { workerJob }                        from "../../lib/workerLog.js";
import { guardWorker } from "../../lib/redisQuotaGuard.js";

const MODEL = OPENAI_MODEL;

const redis     = traceRedis(new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", redisConnectionOptions({ label: "tasks-worker" })), "tasks-worker");
redis.on("error", (err) => console.error("[tasks/worker Redis]", err.message));

async function runOneTask(job) {
  const { taskId } = job.data;
  console.log(`[tasks/worker] Starting job ${job.id} for task ${taskId}`);

  const task = await TaskDB.findById(taskId);
  if (!task || task.status === "cancelled") return;

  // A learner task is a personal study plan. Even if an old queued job exists
  // from before learner autonomy was introduced, it must not fall through to
  // this arbitrary-execution worker. Its only automatic path is the separate
  // due-time Agent Chat worker, which never changes task state.
  const { data: owner, error: ownerError } = await db.from("users")
    .select("role")
    .eq("id", task.creator_id)
    .maybeSingle();
  if (ownerError) throw new Error("Could not verify task owner before execution");
  if (["student", "learner"].includes(String(owner?.role || "").toLowerCase())) {
    const pendingTask = task.status === "queued"
      ? await TaskDB.updateStatus(taskId, "pending", { bullJobId: null })
      : task;
    // A legacy generic task job can reach this worker after the new policy is
    // deployed. Hand it to the narrow chat-only scheduler instead of dropping
    // the learner's due-task nudge along with the unsafe execution.
    try { await scheduleAutonomyReviewForTask(pendingTask); }
    catch (autonomyError) { console.warn("[tasks/worker] learner autonomy schedule skipped:", autonomyError.message); }
    console.log(`[tasks/worker] skipped learner task ${taskId}; autonomous execution is disabled`);
    return;
  }

  const runNumber = await TaskRunDB.nextRunNumber(taskId);
  const run       = await TaskRunDB.create({ taskId, runNumber, status: "running", agentSteps: [] });

  await TaskDB.updateStatus(taskId, "running", { startedAt: new Date() });
  await deliverProgress(task, `Starting run #${runNumber}...`);

  try {
    // Hard-block before spending: the task's creator (teacher/school/user) must
    // have coins in their own or their school's wallet.
    const payer = task.creator_id;
    if (payer) {
      const { ok, total } = await hasCoins(payer, 1);
      if (!ok) {
        await TaskRunDB.update(run.id, { status: "failed" });
        await deliverError(task, run, "Insufficient coin balance — top up to run AI tasks.");
        await TaskDB.updateStatus(taskId, "failed");
        return;
      }
    }

    const ctx          = await buildContext(task);
    const tools        = await getToolsForTask(task);
    // OpenAI function-calling tool schema.
    const toolDefs     = tools.map((t) => ({
      type: "function",
      function: {
        name:        t.definition.name,
        description: t.definition.description,
        parameters:  t.definition.input_schema,
      },
    }));
    const toolMap      = new Map(tools.map((t) => [t.definition.name, t]));
    const toolCtx      = { taskId: task.id, runId: run.id, teacherId: task.creator_id, courseId: task.course_id ?? null };

    // The header stream: the owner sees the agent start, switch tools, finish.
  reportAgentActivity(task.creator_id, `Working on "${String(task.title || "your task").slice(0, 48)}"\u2026`);
  const { steps: agentSteps, outputs } = await runAgentLoop({
      model: MODEL,
      messages: [
        { role: "system", content: ctx.systemPrompt },
        { role: "user",   content: ctx.prompt },
      ],
      toolDefs,
      async callTool(name, args) {
        const registered = toolMap.get(name);
        if (!registered) return `Tool "${name}" not found`;
        return registered.execute(args, toolCtx);
      },
      // Persist after every model turn, so a run that dies mid-way still shows
      // how far it got.
      onStep: (_step, all) => TaskRunDB.update(run.id, { agentSteps: all }),
      onToolStart: (name) => { deliverProgress(task, `Using tool: ${name}...`); agentToolActivity(task.creator_id, name); },
      // Background job (no request context) — name the payer explicitly so the
      // metered client bills each iteration to the task owner's wallet.
      meta: { __userId: payer, __feature: "agent_task", __ref: task.id },
    });

    await TaskRunDB.update(run.id, { status: "done", agentSteps, completed_at: new Date() });
    await deliver(task, run, outputs);
    console.log(`[tasks/worker] ✅ Task ${taskId} completed — ${outputs.length} outputs`);
  } catch (err) {
    console.error(`[tasks/worker] ❌ Task ${taskId} failed:`, err.message);
    await TaskRunDB.update(run.id, { status: "failed" });
    await deliverError(task, run, err.message);
    throw err;
  }
}

/**
 * The 1/min tick: drain due TEACHER tasks from Postgres (learner tasks are
 * skipped — running them would be a no-op that re-fired every tick). This is
 * what replaces one BullMQ job per task.
 */
export async function runDueTasks({ limit = 25, ids = null } = {}) {
  let due;
  if (Array.isArray(ids) && ids.length) {
    due = (await Promise.all(ids.slice(0, limit).map((id) => TaskDB.findById(id)))).filter(Boolean);
  } else {
    due = (await TaskDB.findOverdue()).slice(0, limit);
  }
  const creators = [...new Set(due.map((t) => t.creator_id).filter(Boolean))];
  let learnerIds = new Set();
  if (creators.length) {
    const { data: users } = await db.from("users").select("id, role").in("id", creators);
    learnerIds = new Set((users || [])
      .filter((u) => ["student", "learner"].includes(String(u.role || "").toLowerCase()))
      .map((u) => u.id));
  }
  let ran = 0;
  for (const t of due) {
    if (learnerIds.has(t.creator_id) || t.status === "cancelled") continue;
    // Atomic claim: only the tick that flips pending/queued → running executes it
    // (protects against two ticks overlapping, and a second replica later).
    const { data: claimed } = await db.from("tasks")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", t.id).in("status", ["pending", "queued"]).select("id").maybeSingle();
    if (!claimed) continue;
    try {
      await runOneTask({ id: `tick-${t.id}`, data: { taskId: t.id } });
      ran++;
    } catch (e) { console.warn(`[tasks/worker] tick task ${t.id} failed:`, e?.message); }
    if (t.is_recurring) {
      try {
        const schedule = await TaskScheduleDB.findByTask(t.id);
        if (schedule) await TaskDB.update(t.id, {
          status: "queued",
          due_at: nextCronRun(schedule.cron_expr, schedule.timezone, new Date()).toISOString(),
          started_at: null, completed_at: null, bull_job_id: "tick",
        });
      } catch (e) { console.warn("[tasks/worker] reschedule failed:", e?.message); }
    }
  }
  return { ran };
}

export const taskWorker = new Worker("task-runner", async (job) => (job.data?._tick ? runDueTasks() : runOneTask(job)), {
  connection:  redis,
  concurrency: 5,
  // Reduce idle Redis traffic on per-request-billed providers (Upstash):
  // block the poll longer and check for stalled jobs far less often.
  drainDelay:  300,                         // seconds the idle poll blocks (a new job still wakes it at once)
  stalledInterval: 300_000,   // 5 min between stalled-job scans. Top level: BullMQ ignores it inside `settings`, which left every worker scanning every 30 s.
});
// Quota errors pause every worker instead of a 100 ms retry storm (lib/redisQuotaGuard.js).
guardWorker(taskWorker, "tasks worker");

taskWorker.on("completed", (job) => {
  console.log(`[tasks/worker] ✅ Job ${job.id} done`);
  workerJob("tasks-runner", "done", job);
});
taskWorker.on("failed",    (job, err) => {
  console.error(`[tasks/worker] ❌ Job ${job?.id} failed:`, err.message);
  workerJob("tasks-runner", "failed", job, { error: err?.message });
});

// Recover overdue tasks on startup
startTaskTick().then((r) => r?.registered && console.log("[tasks/worker] task tick registered (1 job/min)")).catch((e) => console.warn("[tasks/worker] tick register failed:", e?.message));
recoverOverdueTasks().then((n) => n > 0 && console.log(`[tasks/worker] Recovered ${n} overdue tasks`));

export default taskWorker;
