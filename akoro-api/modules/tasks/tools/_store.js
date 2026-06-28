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

/**
 * loadTemplate — fetch an instructor template's structure spec, scoped to the
 * task's creator. Returns the template row or null. Used by tools to mirror a
 * teacher's own format when a templateId is supplied.
 */
export async function loadTemplate(templateId, ctx) {
  if (!templateId) return null;
  try {
    let instructorId = null;
    if (ctx?.taskId) {
      const task = await TaskDB.findById(ctx.taskId);
      instructorId = task?.creator_id ?? null;
    }
    let q = db.schema("edu").from("instructor_templates")
      .select("id, title, tool_target, structure")
      .eq("id", templateId);
    if (instructorId) q = q.eq("instructor_id", instructorId);
    const { data } = await q.single();
    return data ?? null;
  } catch (e) {
    console.warn("[tool_outputs] template load failed:", e.message);
    return null;
  }
}

/** Render a template's structure spec as a prompt fragment. */
export function templatePromptFragment(tpl) {
  if (!tpl?.structure) return "";
  const s = tpl.structure;
  const lines = [];
  if (s.sections?.length)    lines.push(`Sections (in order): ${s.sections.join(" → ")}`);
  if (s.style)               lines.push(`Style/tone: ${s.style}`);
  if (s.conventions?.length) lines.push(`Conventions: ${s.conventions.join("; ")}`);
  if (!lines.length) return "";
  return `\n\nMirror the teacher's own template "${tpl.title}":\n- ${lines.join("\n- ")}`;
}
