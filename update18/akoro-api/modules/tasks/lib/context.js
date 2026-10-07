/**
 * modules/tasks/lib/context.js
 * Builds the context the Anthropic agent receives before executing a task.
 * Converted from TypeScript — types removed, imports adapted.
 */

import { TaskFileDB, AgentDB } from "./db.js";
import db from "../../../db.js";

export async function buildContext(task) {
  const [agent, files] = await Promise.all([
    AgentDB.findById(task.agent_id),
    TaskFileDB.listByTask(task.id),
  ]);

  if (!agent) throw new Error(`Agent ${task.agent_id} not found`);

  let course = null;
  if (task.course_id) {
    const { data } = await db.from("courses").select("id, title, subject").eq("id", task.course_id).single();
    course = data;
  }

  const fileTexts = files.map((f) => ({
    fileName: f.file_name ?? f.id,
    fileType: f.file_type ?? "unknown",
    text:     f.ocr_text ?? "",
  })).filter((f) => f.text);

  const systemPrompt = buildSystemPrompt(agent, course);
  const prompt       = buildTaskPrompt(task, files, fileTexts, course);

  return {
    systemPrompt,
    prompt,
    meta: {
      taskId:    task.id,
      taskType:  task.task_type ?? "general",
      payload:   task.payload ?? {},
      teacherId: task.creator_id,
      courseId:  task.course_id ?? null,
      agentName: agent.name ?? agent.agent_name,
      files,
      fileTexts,
    },
  };
}

function buildSystemPrompt(agent, course) {
  const base = agent.systemPrompt ?? agent.system_prompt ??
    `You are ${agent.name ?? agent.agent_name}, a helpful AI teaching assistant on Akoro Learning Platform.`;

  const courseContext = course
    ? `\n\nYou are currently working on: "${course.title}" (${course.subject}).`
    : "";

  return base + courseContext + `\n\nAlways be helpful, accurate, and professional. When you need more information, ask. When you have everything, act.`;
}

function buildTaskPrompt(task, files, fileTexts, course) {
  let prompt = `Task: ${task.title}`;
  if (task.description) prompt += `\n\nDetails: ${task.description}`;
  if (course)           prompt += `\n\nCourse: ${course.title} (${course.subject})`;
  if (fileTexts.length) {
    prompt += "\n\nAttached files:\n";
    for (const f of fileTexts) {
      prompt += `\n--- ${f.fileName} ---\n${f.text.slice(0, 3000)}\n`;
    }
  }
  if (task.payload && Object.keys(task.payload).length) {
    prompt += `\n\nAdditional context: ${JSON.stringify(task.payload, null, 2)}`;
  }
  return prompt;
}

export async function extractIntent(title, description) {
  const text  = `${title} ${description ?? ""}`.toLowerCase();
  const types = {
    generate_quiz:      ["quiz", "test", "questions", "assessment", "practice"],
    send_reminder:      ["remind", "notification", "alert", "message students", "notify"],
    grade_submissions:  ["grade", "mark", "score", "evaluate", "assess submission"],
    schedule_session:   ["schedule", "book", "live class", "session", "zoom", "meet"],
    export_report:      ["report", "analytics", "progress", "overview", "export", "csv"],
    create_battle:      ["battle", "challenge", "competition", "speed round", "quiz game"],
  };

  for (const [type, keywords] of Object.entries(types)) {
    if (keywords.some((k) => text.includes(k))) {
      return { taskType: type, payload: {} };
    }
  }
  return { taskType: "general", payload: {} };
}
