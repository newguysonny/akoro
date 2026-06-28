// modules/tasks/tools/_store.js
// Persist a tool artifact to the dedicated edu.tool_outputs table so it can be
// browsed/reused later (separate from the ephemeral task_outputs delivery row).

import db from "../../../db.js";
import { TaskDB } from "../lib/db.js";

/**
 * saveToolOutput — best-effort persistence of a generated artifact.
 * @returns the inserted row id, or null on failure (never throws).
 */
export async function saveToolOutput({ ctx, tool, kind, title, subject, content }) {
  try {
    let instructorId = null;
    if (ctx?.taskId) {
      const task = await TaskDB.findById(ctx.taskId);
      instructorId = task?.creator_id ?? null;
    }
    const { data, error } = await db.schema("edu").from("tool_outputs").insert({
      instructor_id: instructorId,
      task_id:       ctx?.taskId ?? null,
      run_id:        ctx?.runId ?? null,
      tool,
      kind,
      title:   title ?? null,
      subject: subject ?? null,
      content: content ?? {},
    }).select("id").single();
    if (error) throw error;
    return data?.id ?? null;
  } catch (e) {
    console.warn("[tool_outputs] save failed:", e.message);
    return null;
  }
}
