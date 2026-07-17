// modules/tasks/tools/grade-submissions.js
// Grades student submissions using the attached files and a rubric.
// The agent calls this tool when the teacher uploads answer scripts
// and asks for grading.

import Anthropic        from "@anthropic-ai/sdk";
import { z }            from "zod";
import { TaskOutputDB, TaskFileDB } from "../lib/db.js";
import { ANTHROPIC_MODEL } from "../../../lib/aiModel.js";



// ─── Tool definition ──────────────────────────────────────────────────────────

export const gradeSubmissionsDefinition = {
  name: "grade_submissions",
  description:
    "Grade student assignment or quiz submissions. " +
    "Accepts the submission text or file OCR text and grades against a rubric or model answer. " +
    "Produces a score, detailed feedback, and a per-criterion breakdown. " +
    "Use this when the teacher uploads student work and asks for marking.",
  input_schema: {
    type: "object",
    properties: {
      studentId: {
        type: "string",
        description: "The student's ID",
      },
      studentName: {
        type: "string",
        description: "The student's name (for the feedback report)",
      },
      submissionText: {
        type: "string",
        description:
          "The student's answer text. If the submission was a file, " +
          "pass the OCR-extracted text here.",
      },
      rubric: {
        type: "string",
        description:
          "The marking rubric or model answer to grade against. " +
          "Can be a string description of what a full-marks answer looks like.",
      },
      totalMarks: {
        type: "number",
        description: "The maximum marks available",
      },
      subject: {
        type: "string",
        description: "The subject (e.g. 'Mathematics', 'Chemistry') for domain-appropriate feedback",
      },
    },
    required: ["studentId", "studentName", "submissionText", "totalMarks"],
  },
};

// ─── Params ───────────────────────────────────────────────────────────────────

const paramsSchema = z.object({
  studentId:      z.string(),
  studentName:    z.string(),
  submissionText: z.string(),
  rubric:         z.string().optional(),
  totalMarks:     z.number().min(1),
  subject:        z.string().default("General"),
});

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function executeGradeSubmissions(rawInput, ctx) {
  const input = paramsSchema.parse(rawInput);

  const result = await callLlmForGrading(input);

  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType: "grade",
    content: {
      type:        "grade",
      studentId:   input.studentId,
      studentName: input.studentName,
      score:       result.score,
      totalMarks:  input.totalMarks,
      percentage:  result.percentage,
      grade:       result.grade,
      feedback:    result.feedback,
      breakdown:   result.breakdown,
    },
    delivered: false,
  });

  return {
    success:    true,
    studentId:  input.studentId,
    score:      result.score,
    percentage: result.percentage,
    grade:      result.grade,
  };
}

// ─── LLM grading call ─────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function callLlmForGrading(input) {
  const rubricSection = input.rubric
    ? `\nRubric / model answer:\n${input.rubric}`
    : "\nNo rubric provided — grade on general correctness and quality.";

  const prompt = `You are an expert ${input.subject} examiner. Grade the following student submission.

Student: ${input.studentName}
Total marks available: ${input.totalMarks}
${rubricSection}

Student's answer:
"""
${input.submissionText}
"""

Grade this submission fairly and provide:
1. A total score out of ${input.totalMarks}
2. A detailed feedback paragraph (2–4 sentences)
3. A breakdown of marks per criterion

Respond with JSON only — no markdown, no preamble:
{
  "score": <number>,
  "percentage": <number 0-100>,
  "grade": "A" | "B" | "C" | "D" | "F",
  "feedback": "<detailed feedback for the student>",
  "breakdown": [
    {
      "criterion": "<what was being assessed>",
      "marks": <marks awarded>,
      "maxMarks": <max marks for this criterion>,
      "comment": "<specific comment>"
    }
  ]
}`;

  const response = await anthropic.messages.create({
    model:      ANTHROPIC_MODEL,
    max_tokens: 2048,
    messages:   [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  return JSON.parse(text);
}

// ─── Grade letter helper (also used by export-report) ─────────────────────────

export function scoreToGrade(percentage) {
  if (percentage >= 70) return "A";
  if (percentage >= 60) return "B";
  if (percentage >= 50) return "C";
  if (percentage >= 45) return "D";
  return "F";
}
