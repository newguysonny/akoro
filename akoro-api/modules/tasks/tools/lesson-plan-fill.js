// modules/tasks/tools/lesson-plan-fill.js
// Catalog tool: "Lesson Plan Template Fill" (key: lesson-plan)
// Orchestration: topic + objectives → structured, classroom-ready lesson plan.

import { z } from "zod";
import { TaskOutputDB } from "../lib/db.js";
import { llmJson } from "./_llm.js";
import { saveToolOutput, resolveTemplate, templatePromptFragment, fillTemplateBody } from "./_store.js";

export const lessonPlanFillDefinition = {
  name: "lesson_plan_fill",
  description:
    "Fill a structured lesson plan from a topic, year group and objectives. " +
    "Produces a full classroom-ready plan: objectives, materials, timed phases " +
    "(starter, main, plenary), differentiation and assessment. Use when the " +
    "teacher asks to draft, write or fill a lesson plan.",
  input_schema: {
    type: "object",
    properties: {
      topic:      { type: "string",  description: "Lesson topic, e.g. 'Photosynthesis'" },
      subject:    { type: "string",  description: "Subject, e.g. 'Biology'" },
      yearGroup:  { type: "string",  description: "Year/grade/class, e.g. 'SS2' or 'Year 9'" },
      durationMins: { type: "number", description: "Lesson length in minutes (default 40)" },
      objectives: { type: "array", items: { type: "string" }, description: "Learning objectives (optional — generated if omitted)" },
      templateId: { type: "string", description: "Optional instructor template id to mirror the teacher's own format" },
    },
    required: ["topic"],
  },
};

const schema = z.object({
  topic:        z.string(),
  subject:      z.string().default("General"),
  yearGroup:    z.string().default("Senior Secondary"),
  durationMins: z.number().min(10).max(180).default(40),
  objectives:   z.array(z.string()).default([]),
  templateId:   z.string().optional(),
});

export async function executeLessonPlanFill(rawInput, ctx) {
  const input = schema.parse(rawInput);
  const tpl = await resolveTemplate({ toolTarget: "lesson_plan", templateId: input.templateId, ctx });

  const plan = await llmJson(
    `Create a detailed lesson plan.
Topic: "${input.topic}"
Subject: ${input.subject}
Class/Year: ${input.yearGroup}
Duration: ${input.durationMins} minutes
${input.objectives.length ? `Objectives to cover:\n- ${input.objectives.join("\n- ")}` : "Generate 3-4 measurable learning objectives."}
${templatePromptFragment(tpl)}

Return JSON:
{
  "title": "<lesson title>",
  "subject": "${input.subject}",
  "yearGroup": "${input.yearGroup}",
  "durationMins": ${input.durationMins},
  "objectives": ["<measurable objective>", ...],
  "materials": ["<material/resource>", ...],
  "keyVocabulary": ["<term>", ...],
  "phases": [
    { "name": "Starter", "minutes": <int>, "activity": "<what teacher & students do>" },
    { "name": "Main", "minutes": <int>, "activity": "..." },
    { "name": "Plenary", "minutes": <int>, "activity": "..." }
  ],
  "differentiation": { "support": "<for strugglers>", "stretch": "<for able>" },
  "assessment": "<how learning is checked>",
  "homework": "<optional follow-up task>"
}`,
    { maxTokens: 2500 }
  );

  // If the chosen template has a markdown body, fill it (AI fills the template).
  const filledBody = await fillTemplateBody(tpl, { ...plan, ...input });
  const content = { type: "lesson_plan", tool: "lesson_plan_fill", ...plan, ...(filledBody ? { body: filledBody, templateId: tpl?.id } : {}) };

  await TaskOutputDB.create({
    runId: ctx.runId, taskId: ctx.taskId,
    outputType: "lesson_plan",
    content,
    delivered: false,
  });

  const savedId = await saveToolOutput({
    ctx, tool: "lesson_plan_fill", kind: "lesson_plan",
    title: plan.title, subject: input.subject, content,
  });

  return { success: true, id: savedId, title: plan.title, phases: plan.phases?.length ?? 0, usedTemplate: !!filledBody };
}
