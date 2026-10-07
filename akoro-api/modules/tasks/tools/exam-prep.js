// modules/tasks/tools/exam-prep.js
// Catalog tool: "Exam Prep Assessment" (key: exam-prep)
// Orchestration: topic/syllabus → exam-style assessment with mark scheme + blueprint.

import { z } from "zod";
import { v4 as uuid } from "uuid";
import { TaskOutputDB } from "../lib/db.js";
import { llmJson } from "./_llm.js";
import { saveToolOutput, resolveTemplate, templatePromptFragment, fillTemplateBody } from "./_store.js";

export const examPrepDefinition = {
  name: "exam_prep",
  description:
    "Build an exam-prep assessment aligned to an exam board (WAEC/JAMB/NECO etc.). " +
    "Produces exam-style questions with a mark scheme and a coverage blueprint. " +
    "Use when the teacher asks for exam prep, a mock exam, or exam-style practice.",
  input_schema: {
    type: "object",
    properties: {
      topic:    { type: "string", description: "Topic or set of topics to assess" },
      subject:  { type: "string", description: "Subject" },
      examBoard:{ type: "string", description: "Exam board, e.g. WAEC, JAMB, NECO, IGCSE" },
      questionCount: { type: "number", description: "Number of questions (default 10)" },
      durationMins:  { type: "number", description: "Suggested exam duration (default 30)" },
      templateId:    { type: "string", description: "Optional instructor template id to mirror the teacher's own format" },
    },
    required: ["topic"],
  },
};

const schema = z.object({
  topic:         z.string(),
  subject:       z.string().default("General"),
  examBoard:     z.string().default("WAEC"),
  questionCount: z.number().min(1).max(50).default(10),
  durationMins:  z.number().min(5).max(240).default(30),
  templateId:    z.string().optional(),
});

export async function executeExamPrep(rawInput, ctx) {
  const input = schema.parse(rawInput);
  const tpl = await resolveTemplate({ toolTarget: "exam_prep", templateId: input.templateId, ctx });

  const assessment = await llmJson(
    `Create an exam-prep assessment in the style of ${input.examBoard}.
Subject: ${input.subject}
Topic(s): "${input.topic}"
Questions: ${input.questionCount}
Duration: ${input.durationMins} minutes
Design multiple-choice distractors around common student misconceptions, and include real-world/applied questions where the topic allows.

Return JSON:
{
  "title": "<assessment title>",
  "examBoard": "${input.examBoard}",
  "durationMins": ${input.durationMins},
  "blueprint": [ { "objective": "<skill/topic>", "questions": <int> } ],
  "questions": [
    { "n": 1, "type": "mcq|theory", "question": "<exam-style question>",
      "options": ["A. ..","B. ..","C. ..","D. .."]?, "answer": "<answer>",
      "markScheme": "<how marks are awarded>", "marks": <int> }
  ]
}` + templatePromptFragment(tpl),
    { maxTokens: 4096 }
  );

  const questions = (assessment.questions || []).map((q) => ({ id: uuid(), ...q }));
  const filledBody = await fillTemplateBody(tpl, { ...assessment, ...input });
  const content = {
    type: "assessment", tool: "exam_prep", subject: input.subject,
    ...assessment, questions,
    totalMarks: questions.reduce((s, q) => s + (q.marks || 0), 0),
    ...(filledBody ? { body: filledBody, templateId: tpl?.id } : {}),
  };

  await TaskOutputDB.create({
    runId: ctx.runId, taskId: ctx.taskId,
    outputType: "assessment",
    content,
    delivered: false,
  });

  const savedId = await saveToolOutput({
    ctx, tool: "exam_prep", kind: "assessment",
    title: assessment.title, subject: input.subject,
    content,
  });

  return { success: true, id: savedId, title: assessment.title, questionCount: questions.length };
}
