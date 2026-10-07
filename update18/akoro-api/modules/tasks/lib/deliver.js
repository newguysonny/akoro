/**
 * modules/tasks/lib/deliver.js
 * Handles delivery of task outputs to teacher's UI via Socket.io.
 */

import { TaskDB, TaskOutputDB } from "./db.js";
import { pushToTeacher }        from "./realtime.js";

export async function deliver(task, run, outputs) {
  await Promise.all(outputs.map((output) => TaskOutputDB.create({
    runId: run.id, taskId: task.id, outputType: output.type, content: output, delivered: false,
  })));

  const updated = await TaskDB.updateStatus(task.id, "done", { completedAt: new Date() });

  await pushToTeacher(task.creator_id, "task.completed", {
    taskId:      task.id,
    taskTitle:   task.title,
    runId:       run.id,
    outputs:     outputs.map((o) => ({ type: o.type })),
    summary:     outputs.find((o) => o.type === "message")?.text ?? null,
    completedAt: new Date().toISOString(),
  });

  return updated;
}

export async function deliverError(task, run, errorMsg) {
  await TaskDB.updateStatus(task.id, "failed");
  await pushToTeacher(task.creator_id, "task.failed", {
    taskId: task.id, taskTitle: task.title, runId: run.id,
    errorMsg, failedAt: new Date().toISOString(),
  });
}

export async function deliverProgress(task, message) {
  await pushToTeacher(task.creator_id, "task.progress", {
    taskId: task.id, message, at: new Date().toISOString(),
  });
}
