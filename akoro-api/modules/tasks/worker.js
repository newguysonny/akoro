/**
 * modules/tasks/worker.js
 * BullMQ worker that runs the OpenAI agent loop (function calling) for task
 * execution. Converted from TypeScript to JS ESM.
 */

import { Worker }   from "bullmq";
import Redis        from "ioredis";
import { TaskDB, TaskRunDB, AgentDB } from "./lib/db.js";
import { buildContext }               from "./lib/context.js";
import { deliver, deliverError, deliverProgress } from "./lib/deliver.js";
import { getToolsForTask }                        from "./tools/index.js";
import { recoverOverdueTasks }                    from "./scheduler.js";
import { bullRedisOptions }                        from "../../lib/redisOptions.js";
import { openai, OPENAI_MODEL } from "../../lib/aiModel.js";

const MAX_TOOL_ITERATIONS = 20;
const MODEL               = OPENAI_MODEL;

const redis     = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", bullRedisOptions);
redis.on("error", (err) => console.error("[tasks/worker Redis]", err.message));

export const taskWorker = new Worker("task-runner", async (job) => {
  const { taskId } = job.data;
  console.log(`[tasks/worker] Starting job ${job.id} for task ${taskId}`);

  const task = await TaskDB.findById(taskId);
  if (!task || task.status === "cancelled") return;

  const runNumber = await TaskRunDB.nextRunNumber(taskId);
  const run       = await TaskRunDB.create({ taskId, runNumber, status: "running", agentSteps: [] });

  await TaskDB.updateStatus(taskId, "running", { startedAt: new Date() });
  await deliverProgress(task, `Starting run #${runNumber}...`);

  try {
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
    const agentSteps   = [];
    const outputs      = [];
    const messages     = [
      { role: "system", content: ctx.systemPrompt },
      { role: "user",   content: ctx.prompt },
    ];

    let iterations = 0;
    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;
      const response = await openai.chat.completions.create({
        model: MODEL, max_tokens: 4096,
        ...(toolDefs.length ? { tools: toolDefs } : {}),
        messages,
      });

      const msg    = response.choices?.[0]?.message ?? { role: "assistant", content: "" };
      const finish = response.choices?.[0]?.finish_reason;
      agentSteps.push({ role: "assistant", content: msg.content ?? null, toolCalls: msg.tool_calls ?? null, finishReason: finish, iteration: iterations });
      await TaskRunDB.update(run.id, { agentSteps });

      // Echo the assistant turn back (may carry tool_calls) — required before
      // the matching tool results.
      messages.push(msg);

      if (msg.content && msg.content.trim()) outputs.push({ type: "message", text: msg.content });

      const toolCalls = msg.tool_calls ?? [];
      if (!toolCalls.length) break;   // finish_reason "stop" — no tools requested

      for (const call of toolCalls) {
        const name       = call.function?.name;
        const registered = toolMap.get(name);
        let content;
        if (!registered) {
          content = `Tool "${name}" not found`;
        } else {
          await deliverProgress(task, `Using tool: ${name}...`);
          let args = {};
          try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }
          try { content = JSON.stringify(await registered.execute(args, toolCtx)); }
          catch (err) { content = `Tool error: ${err.message}`; }
        }
        // One tool message per tool_call_id, or OpenAI rejects the next call.
        messages.push({ role: "tool", tool_call_id: call.id, content });
      }
    }

    await TaskRunDB.update(run.id, { status: "done", agentSteps, completed_at: new Date() });
    await deliver(task, run, outputs);
    console.log(`[tasks/worker] ✅ Task ${taskId} completed — ${outputs.length} outputs`);
  } catch (err) {
    console.error(`[tasks/worker] ❌ Task ${taskId} failed:`, err.message);
    await TaskRunDB.update(run.id, { status: "failed" });
    await deliverError(task, run, err.message);
    throw err;
  }
}, {
  connection:  redis,
  concurrency: 5,
  // Reduce idle Redis traffic on per-request-billed providers (Upstash):
  // block the poll longer and check for stalled jobs far less often.
  drainDelay:  60,                          // seconds the blocking poll waits when idle
  settings:    { stalledInterval: 300_000 }, // 5 min between stalled-job scans
});

taskWorker.on("completed", (job) => console.log(`[tasks/worker] ✅ Job ${job.id} done`));
taskWorker.on("failed",    (job, err) => console.error(`[tasks/worker] ❌ Job ${job?.id} failed:`, err.message));

// Recover overdue tasks on startup
recoverOverdueTasks().then((n) => n > 0 && console.log(`[tasks/worker] Recovered ${n} overdue tasks`));

export default taskWorker;
