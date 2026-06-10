/**
 * modules/tasks/worker.js
 * BullMQ worker that runs the Anthropic agent loop for task execution.
 * Converted from TypeScript to JS ESM.
 */

import { Worker }   from "bullmq";
import Redis        from "ioredis";
import Anthropic    from "@anthropic-ai/sdk";
import { TaskDB, TaskRunDB, AgentDB } from "./lib/db.js";
import { buildContext }               from "./lib/context.js";
import { deliver, deliverError, deliverProgress } from "./lib/deliver.js";
import { getToolsForTask }                        from "./tools/index.js";
import { recoverOverdueTasks }                    from "./scheduler.js";

const MAX_TOOL_ITERATIONS = 20;
const MODEL               = "claude-sonnet-4-6";

const redis     = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
    const toolDefs     = tools.map((t) => t.definition);
    const toolMap      = new Map(tools.map((t) => [t.definition.name, t]));
    const toolCtx      = { taskId: task.id, runId: run.id };
    const agentSteps   = [];
    const outputs      = [];
    const messages     = [{ role: "user", content: ctx.prompt }];

    let iterations = 0;
    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;
      const response = await anthropic.messages.create({
        model: MODEL, max_tokens: 4096,
        system:   ctx.systemPrompt,
        tools:    toolDefs,
        messages,
      });

      const step = { role: "assistant", content: response.content, stopReason: response.stop_reason, iteration: iterations };
      agentSteps.push(step);
      await TaskRunDB.update(run.id, { agentSteps });
      messages.push({ role: "assistant", content: response.content });

      // Extract any text output
      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) {
          outputs.push({ type: "message", text: block.text });
        }
      }

      if (response.stop_reason === "end_turn") break;

      if (response.stop_reason === "tool_use") {
        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          const registered = toolMap.get(block.name);
          if (!registered) {
            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: `Tool "${block.name}" not found`, is_error: true });
            continue;
          }
          await deliverProgress(task, `Using tool: ${block.name}...`);
          try {
            const result = await registered.execute(block.input, toolCtx);
            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
          } catch (err) {
            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: `Tool error: ${err.message}`, is_error: true });
          }
        }
        messages.push({ role: "user", content: toolResults });
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
}, { connection: redis, concurrency: 5 });

taskWorker.on("completed", (job) => console.log(`[tasks/worker] ✅ Job ${job.id} done`));
taskWorker.on("failed",    (job, err) => console.error(`[tasks/worker] ❌ Job ${job?.id} failed:`, err.message));

// Recover overdue tasks on startup
recoverOverdueTasks().then((n) => n > 0 && console.log(`[tasks/worker] Recovered ${n} overdue tasks`));

export default taskWorker;
