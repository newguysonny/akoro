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

  // The id, not just the title: tools that create work for a course (battles,
  // self study) take a courseId, and without it here the model either invents
  // one or gives up.
  const courseContext = course
    ? `\n\nYou are currently working on: "${course.title}" (${course.subject}). Its courseId is ${course.id} — use that when a tool asks for one.`
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

/**
 * extractIntent — pick the task type, and therefore which tools are in scope.
 *
 * Order matters and used to be wrong. The map is scanned top-down and
 * challenge_peer owned "battle"/"challenge", so it swallowed every teacher
 * phrasing — "create a battle for JSS1" resolved to a student-facing 1v1 duel
 * whose only tool needs an opponentId the teacher never supplies. create_battle
 * sat below it and could never be reached.
 *
 * So: the ROLE decides first. A student challenging a friend and a teacher
 * setting work for a class use the same words and mean different things, and no
 * amount of keyword ordering fixes that. Only once we know who is asking do the
 * keywords disambiguate, most specific phrasing first.
 */
const STUDENT_INTENTS = {
  quiz_me:            ["quiz me", "test me", "practice questions for me", "practise me"],
  set_study_reminder: ["remind me", "set a reminder", "reminder to"],
  create_study_plan:  ["study plan", "revision plan", "schedule my study", "plan my"],
  challenge_peer:     ["challenge", "battle", "duel", "compete with"],
  explain_concept:    ["explain", "what is", "help me understand", "teach me"],
};

const TEACHER_INTENTS = {
  // Multi-word phrases before single words, so "self study" can't be eaten by
  // "study plan" and "assign a battle" can't be eaten by "assess".
  assign_self_study:  ["self study", "self-study", "assign study", "study assignment", "independent study"],
  run_teaching_tool:  ["podcast", "misconception", "real-world", "real world connection", "lesson hook",
                       "vocabulary", "essay grade", "grade this essay", "lesson plan", "assignment creator"],
  create_battle:      ["study review", "check what", "battle", "challenge",
                       "competition", "speed round", "quiz game", "duel"],
  attendance_rollcall:["attendance", "roll call", "rollcall", "register"],
  grade_submissions:  ["grade", "mark", "score", "evaluate", "assess submission"],
  schedule_session:   ["schedule a class", "book a class", "live class", "session", "zoom", "meet"],
  export_report:      ["report", "analytics", "progress", "overview", "export", "csv"],
  send_reminder:      ["remind", "notification", "alert", "message students", "notify"],
  generate_quiz:      ["quiz", "test", "questions", "assessment", "practice"],
};

const STUDENT_ROLES = new Set(["student", "learner"]);

/**
 * "Review <learner>" is a study review; "grade and review their work" is not.
 *
 * The task type decides which TOOLS the model is shown, so routing this wrongly
 * is not cosmetic — a review that lands on generate_quiz can never call
 * assign_battle, and the teacher gets a quiz they did not ask for.
 *
 * This runs only AFTER the keyword maps have had their say, and only rescues
 * what they would otherwise drop on the floor. A bare "review" keyword in the
 * map took marking phrasings with it ("grade and review student work" became a
 * battle); leaving it to the end means an intent that genuinely matched wins.
 */
const REVIEWY   = /\breview(ing)?\b|\bcheck what\b/;
const MARKINGY  = /\b(grade|grading|mark|marking|score|scoring|evaluate)\b|\b(submission|homework|essay|script)s?\b/;

export async function extractIntent(title, description, role) {
  const text = `${title} ${description ?? ""}`.toLowerCase();
  // Unknown role → try teacher phrasings first, then student. A teacher account
  // is the one that can do damage by picking wrong (it assigns work to others),
  // so the ambiguous case should still land on an intent whose tool asks for
  // the targeting it needs rather than one that silently needs an opponentId.
  const maps = STUDENT_ROLES.has(role)
    ? [STUDENT_INTENTS, TEACHER_INTENTS]
    : [TEACHER_INTENTS, STUDENT_INTENTS];

  for (const map of maps) {
    for (const [type, keywords] of Object.entries(map)) {
      if (keywords.some((k) => text.includes(k))) return { taskType: type, payload: {} };
    }
  }
  // Nothing matched. If it reads like "review Priya on fractions", that is a
  // study review — assign_battle creates one — rather than nothing at all.
  if (!STUDENT_ROLES.has(role) && REVIEWY.test(text) && !MARKINGY.test(text)) {
    return { taskType: "create_battle", payload: {} };
  }
  return { taskType: "general", payload: {} };
}
