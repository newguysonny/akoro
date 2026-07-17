// modules/tasks/tools/export-report.js
// Generates a progress/performance report for a course or student.
// Produces an HTML report and a summary string. Optionally generates a CSV.
// This is a good example of a tool that chains fetch-student-data internally.

import Anthropic        from "@anthropic-ai/sdk";
import { z }            from "zod";
import { TaskOutputDB } from "../lib/db.js";
import { executeFetchStudentData } from "./fetch-student-data.js";
import { ANTHROPIC_MODEL } from "../../../lib/aiModel.js";


// ─── Tool definition ──────────────────────────────────────────────────────────

export const exportReportDefinition = {
  name: "export_report",
  description:
    "Generate a progress or performance report for a course or individual student. " +
    "Produces a formatted HTML report with charts-ready data and a plain-text summary. " +
    "Use this when the teacher asks for a report, analytics summary, or class overview.",
  input_schema: {
    type: "object",
    properties: {
      courseId: {
        type: "string",
        description: "The course to report on",
      },
      reportType: {
        type: "string",
        enum: ["class_overview", "at_risk_students", "top_performers", "quiz_performance", "individual"],
        description: "The type of report to generate",
      },
      studentId: {
        type: "string",
        description: "Required when reportType is 'individual'",
      },
      periodDays: {
        type: "number",
        description: "How many days back to include in the report (default: 30)",
      },
    },
    required: ["courseId", "reportType"],
  },
};

// ─── Params ───────────────────────────────────────────────────────────────────

const paramsSchema = z.object({
  courseId:   z.string(),
  reportType: z.enum(["class_overview", "at_risk_students", "top_performers", "quiz_performance", "individual"]),
  studentId:  z.string().optional(),
  periodDays: z.number().default(30),
});

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function executeExportReport(rawInput, ctx) {
  const input = paramsSchema.parse(rawInput);

  // Fetch student data — this tool chains the data tool internally
  const { students, summary: courseSummary } = await executeFetchStudentData(
    {
      courseId:           input.courseId,
      includeQuizScores:  true,
      includeSubmissions: true,
    },
    ctx
  );

  // Filter students based on report type
  const reportStudents = filterStudents(students, input.reportType, input.studentId);

  // Generate the report with an LLM
  const { html, summary } = await generateReportContent(
    input.reportType,
    reportStudents,
    courseSummary,
    input.periodDays
  );

  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType: "report",
    content: {
      type:       "report",
      reportType: input.reportType,
      courseId:   input.courseId,
      html,
      summary,
      studentCount: reportStudents.length,
      generatedAt:  new Date().toISOString(),
    },
    delivered: false,
  });

  return { success: true, reportType: input.reportType, summary };
}

// ─── Filter students by report type ──────────────────────────────────────────

function filterStudents(students, reportType, studentId) {
  switch (reportType) {
    case "at_risk_students":
      return students.filter((s) => s.riskLevel === "high" || s.riskLevel === "medium");
    case "top_performers":
      return students
        .filter((s) => s.progress >= 70)
        .sort((a, b) => b.progress - a.progress)
        .slice(0, 10);
    case "individual":
      return students.filter((s) => s.id === studentId);
    default:
      return students;
  }
}

// ─── LLM report generation ────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateReportContent(reportType, students, summary, periodDays) {
  const studentTable = students
    .map(
      (s) =>
        `- ${s.name}: ${s.progress}% progress, ${s.quizAverage ?? "N/A"}% quiz avg, ` +
        `last active ${daysSince(s.lastActiveAt)} days ago, risk: ${s.riskLevel}`
    )
    .join("\n");

  const prompt = `You are a data analyst for an education platform. Generate a ${reportType.replace(/_/g, " ")} report.

Period: last ${periodDays} days
Course summary:
- Total students: ${summary.totalStudents}
- Average progress: ${summary.averageProgress}%
- At-risk count: ${summary.atRiskCount}
- Average quiz score: ${summary.averageQuizScore ?? "N/A"}%

Students in this report:
${studentTable}

Respond with JSON only — no markdown, no preamble:
{
  "summary": "<2-3 sentence plain text summary of key findings>",
  "html": "<a complete, self-contained HTML snippet (no <html>/<body> tags) with a styled report table and key metrics. Use inline styles only. Keep it clean and professional.>"
}`;

  const response = await anthropic.messages.create({
    model:      ANTHROPIC_MODEL,
    max_tokens: 4096,
    messages:   [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  return JSON.parse(text);
}

function daysSince(isoDate) {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24));
}
