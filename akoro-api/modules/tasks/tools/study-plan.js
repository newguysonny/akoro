// modules/tasks/tools/study-plan.js
// Student-facing day-by-day study plan generator.

import { z }                    from "zod";
import { TaskDB, TaskOutputDB } from "../lib/db.js";
import db                       from "../../../db.js";
import Anthropic                from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const studyPlanDefinition = {
  name: "create_study_plan",
  description:
    "Create a day-by-day study plan for the student. " +
    "Use this when the student asks for a study plan, revision plan, " +
    "or to schedule/plan their study.",
  input_schema: {
    type: "object",
    properties: {
      subject: {
        type: "string",
        description: "The subject to study, e.g. 'Biology', 'Mathematics'",
      },
      goal: {
        type: "string",
        description: "The study goal (default: 'exam prep')",
      },
      daysUntilTarget: {
        type: "number",
        description: "Number of days until the target date (default: 14)",
      },
      hoursPerDay: {
        type: "number",
        description: "How many hours the student can study per day (default: 1)",
      },
    },
    required: ["subject"],
  },
};

const paramsSchema = z.object({
  subject:         z.string(),
  goal:            z.string().default("exam prep"),
  daysUntilTarget: z.number().min(1).max(365).default(14),
  hoursPerDay:     z.number().min(0.5).max(16).default(1),
});

export async function executeStudyPlan(rawInput, ctx) {
  const input = paramsSchema.parse(rawInput);

  const task = await TaskDB.findById(ctx.taskId);
  const studentId = task?.creator_id;

  const plan = await callLlmForPlan(input);

  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType: "study_plan",
    content: {
      type:    "study_plan",
      subject: input.subject,
      goal:    input.goal,
      plan,
      studentId,
    },
    delivered: false,
  });

  return { success: true, plan };
}

async function callLlmForPlan(input) {
  const prompt = `Create a day-by-day study plan for a student.

Subject: ${input.subject}
Goal: ${input.goal}
Days available: ${input.daysUntilTarget}
Hours per day: ${input.hoursPerDay}

Respond with a JSON array only — no markdown, no preamble:
[
  {
    "day": <day number, starting at 1>,
    "focus": "<the topic or theme for this day>",
    "activities": ["<activity 1>", "<activity 2>"],
    "durationMins": <total minutes for the day>
  }
]`;

  const response = await anthropic.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 4096,
    messages:   [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  return JSON.parse(text);
}
