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
    // Allow the instructor's own template OR a platform sample template.
    let q = db.schema("edu").from("instructor_templates")
      .select("id, title, tool_target, structure, body_markdown, instructor_id, is_sample")
      .eq("id", templateId);
    const { data } = await q.single();
    if (!data) return null;
    if (data.instructor_id && instructorId && data.instructor_id !== instructorId && !data.is_sample) return null;
    return data;
  } catch (e) {
    console.warn("[tool_outputs] template load failed:", e.message);
    return null;
  }
}

/**
 * resolveTemplate — pick the template a tool should use:
 *   1. an explicit templateId (passed by the agent), else
 *   2. the instructor's default template for this tool target, else
 *   3. null (the tool generates directly from the LLM).
 */
export async function resolveTemplate({ toolTarget, templateId, ctx }) {
  if (templateId) return loadTemplate(templateId, ctx);
  try {
    let instructorId = null;
    if (ctx?.taskId) {
      const task = await TaskDB.findById(ctx.taskId);
      instructorId = task?.creator_id ?? null;
    }
    if (!instructorId) return null;
    const { data } = await db.schema("edu").from("instructor_template_defaults")
      .select("template_id")
      .eq("instructor_id", instructorId)
      .eq("tool_target", toolTarget)
      .maybeSingle();
    if (data?.template_id) return loadTemplate(data.template_id, ctx);
  } catch (e) {
    console.warn("[resolveTemplate] failed:", e.message);
  }
  return null;
}

/**
 * fillTemplateBody — when a template has a markdown body, have the LLM FILL it
 * (preserving headings/layout, replacing {{placeholders}}) using the context.
 * Returns the filled markdown string, or null.
 */
export async function fillTemplateBody(tpl, context) {
  if (!tpl?.body_markdown) return null;
  try {
    const { llmText } = await import("./_llm.js");
    const filled = await llmText(
      `Fill in this markdown template. Preserve ALL headings, sections, order and ` +
      `layout EXACTLY. Replace every {{placeholder}} and complete each section using ` +
      `this context:\n${JSON.stringify(context).slice(0, 4000)}\n\n` +
      `TEMPLATE:\n${tpl.body_markdown}\n\nReturn ONLY the filled markdown — no commentary.`,
      { maxTokens: 2500 }
    );
    return filled.trim();
  } catch (e) {
    console.warn("[template fill] failed:", e.message);
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
