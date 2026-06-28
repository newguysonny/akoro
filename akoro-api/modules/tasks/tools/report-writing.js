// modules/tasks/tools/report-writing.js
// Catalog tool: "Report Writing Template Fill" (key: report-writing)
// Orchestration: performance notes → polished end-of-term report comments.

import { z } from "zod";
import { TaskOutputDB } from "../lib/db.js";
import { llmJson } from "./_llm.js";

export const reportWritingDefinition = {
  name: "report_writing",
  description:
    "Write a polished end-of-term student report comment from performance notes " +
    "and grades. Produces a balanced, professional comment (strengths, targets, " +
    "next steps). Use when the teacher asks to write or draft a student report/comment.",
  input_schema: {
    type: "object",
    properties: {
      studentName: { type: "string", description: "Student's name" },
      subject:     { type: "string", description: "Subject the report covers" },
      grade:       { type: "string", description: "Grade/score achieved, e.g. 'B2' or '72%'" },
      notes:       { type: "string", description: "Teacher's raw observations about the student" },
      tone:        { type: "string", enum: ["formal", "warm", "encouraging"], description: "Comment tone (default formal)" },
    },
    required: ["studentName", "notes"],
  },
};

const schema = z.object({
  studentName: z.string(),
  subject:     z.string().default("General"),
  grade:       z.string().default(""),
  notes:       z.string(),
  tone:        z.enum(["formal", "warm", "encouraging"]).default("formal"),
});

export async function executeReportWriting(rawInput, ctx) {
  const input = schema.parse(rawInput);

  const report = await llmJson(
    `Write an end-of-term report comment for a student.
Name: ${input.studentName}
Subject: ${input.subject}
Grade: ${input.grade || "n/a"}
Tone: ${input.tone}
Teacher's notes: "${input.notes}"

Return JSON:
{
  "studentName": "${input.studentName}",
  "subject": "${input.subject}",
  "grade": "${input.grade}",
  "comment": "<2-4 sentence balanced report comment in ${input.tone} tone>",
  "strengths": ["<strength>", ...],
  "targets": ["<area to improve / next step>", ...]
}`,
    { maxTokens: 1200 }
  );

  await TaskOutputDB.create({
    runId: ctx.runId, taskId: ctx.taskId,
    outputType: "report",
    content: { type: "report", tool: "report_writing", ...report },
    delivered: false,
  });

  return { success: true, studentName: report.studentName };
}
