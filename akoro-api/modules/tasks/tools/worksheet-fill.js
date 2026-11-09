// modules/tasks/tools/worksheet-fill.js
// Catalog tool: "Worksheets Template Fill" (key: worksheets)
// Orchestration: topic + level → printable worksheet with questions + answer key.

import { z } from "zod";
import { TaskOutputDB } from "../lib/db.js";
import { llmJson, ENRICHMENT } from "./_llm.js";
import { saveToolOutput, resolveTemplate, templatePromptFragment, fillTemplateBody } from "./_store.js";
import { assembleWorksheetQuestions } from "./generator-scaffold.js";

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
      templateId: { type: "string", description: "Optional instructor template id to mirror the teacher's own format" },
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
  templateId:       z.string().optional(),
});

export async function executeWorksheetFill(rawInput, ctx) {
  const input = schema.parse(rawInput);
  const tpl = await resolveTemplate({ toolTarget: "worksheet", templateId: input.templateId, ctx });

  const ws = await llmJson(
    `Create a worksheet on "${input.topic}" (${input.subject}, ${input.yearGroup}).
Generate ${input.questionCount} questions of mixed type (fill-in-the-blank, short answer, multiple choice, one problem-solving).
${input.includeAnswerKey ? "Include the correct answer for every question." : "Do not include answers."}

${ENRICHMENT}
Frame several questions with real-world contexts, and include at least one question that targets a common misconception.
${templatePromptFragment(tpl)}

Do not number the questions or prefix option letters — the app does that.
Return JSON:
{
  "title": "<worksheet title>",
  "instructions": "<instructions for students>",
  "realWorldConnections": ["<real-world application of this topic>", ...],
  "commonMisconceptions": ["<a common misconception and the correction>", ...],
  "questions": [
    { "type": "mcq|fill_blank|short|problem", "question": "<text>", "options": ["..."]?, "answer": "<answer>"? }
  ]
}`,
    { maxTokens: 3000 }
  );

  // Lever 4: script the fixed shape (numbers, type, lettered options); the model wrote only content.
  if (Array.isArray(ws.questions)) ws.questions = assembleWorksheetQuestions(ws.questions);

  const filledBody = await fillTemplateBody(tpl, { ...ws, ...input });
  const content = { type: "worksheet", tool: "worksheet_fill", subject: input.subject, ...ws, ...(filledBody ? { body: filledBody, templateId: tpl?.id } : {}) };

  await TaskOutputDB.create({
    runId: ctx.runId, taskId: ctx.taskId,
    outputType: "worksheet",
    content,
    delivered: false,
  });

  const savedId = await saveToolOutput({
    ctx, tool: "worksheet_fill", kind: "worksheet",
    title: ws.title, subject: input.subject, content,
  });

  return { success: true, id: savedId, title: ws.title, questionCount: ws.questions?.length ?? 0, usedTemplate: !!filledBody };
}
