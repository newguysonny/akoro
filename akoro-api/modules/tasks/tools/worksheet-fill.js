// modules/tasks/tools/worksheet-fill.js
// Catalog tool: "Worksheets Template Fill" (key: worksheets)
// Orchestration: topic + level → printable worksheet with questions + answer key.

import { z } from "zod";
import { TaskOutputDB } from "../lib/db.js";
import { llmJson } from "./_llm.js";

export const worksheetFillDefinition = {
  name: "worksheet_fill",
  description:
    "Generate a printable worksheet for a topic — a mix of question types with " +
    "an answer key. Use when the teacher asks for a worksheet, handout or practice sheet.",
  input_schema: {
    type: "object",
    properties: {
      topic:      { type: "string", description: "Worksheet topic" },
      subject:    { type: "string", description: "Subject" },
      yearGroup:  { type: "string", description: "Year/grade/class level" },
      questionCount: { type: "number", description: "Number of questions (default 10)" },
      includeAnswerKey: { type: "boolean", description: "Include an answer key (default true)" },
    },
    required: ["topic"],
  },
};

const schema = z.object({
  topic:            z.string(),
  subject:          z.string().default("General"),
  yearGroup:        z.string().default("Senior Secondary"),
  questionCount:    z.number().min(1).max(40).default(10),
  includeAnswerKey: z.boolean().default(true),
});

export async function executeWorksheetFill(rawInput, ctx) {
  const input = schema.parse(rawInput);

  const ws = await llmJson(
    `Create a worksheet on "${input.topic}" (${input.subject}, ${input.yearGroup}).
Generate ${input.questionCount} questions of mixed type (fill-in-the-blank, short answer, multiple choice, one problem-solving).
${input.includeAnswerKey ? "Include the correct answer for every question." : "Do not include answers."}

Return JSON:
{
  "title": "<worksheet title>",
  "instructions": "<instructions for students>",
  "questions": [
    { "n": 1, "type": "mcq|fill_blank|short|problem", "question": "<text>", "options": ["..."]?, "answer": "<answer>"? }
  ]
}`,
    { maxTokens: 3000 }
  );

  await TaskOutputDB.create({
    runId: ctx.runId, taskId: ctx.taskId,
    outputType: "worksheet",
    content: { type: "worksheet", tool: "worksheet_fill", subject: input.subject, ...ws },
    delivered: false,
  });

  return { success: true, title: ws.title, questionCount: ws.questions?.length ?? 0 };
}
