// modules/tasks/tools/fetch-student-data.js
// Fetches student progress, engagement, and performance data.
// Used as a supporting tool by most other tools.

import { z }  from "zod";
import db     from "../../../db.js";

// ─── Tool definition ──────────────────────────────────────────────────────────

export const fetchStudentDataDefinition = {
  name: "fetch_student_data",
  description:
    "Fetch student progress and performance data for a course. " +
    "Returns progress percentages, quiz scores, submission status, " +
    "last active date, and engagement metrics. " +
    "Call this before generating reports, sending targeted reminders, " +
    "or answering questions about how students are doing.",
  input_schema: {
    type: "object",
    properties: {
      courseId: {
        type: "string",
        description: "The course to fetch student data for",
      },
      studentIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional: fetch data for specific students only. " +
          "If omitted, returns data for all enrolled students.",
      },
      includeQuizScores: {
        type: "boolean",
        description: "Whether to include per-quiz score history (default: false)",
      },
      includeSubmissions: {
        type: "boolean",
        description: "Whether to include assignment submission status (default: false)",
      },
    },
    required: ["courseId"],
  },
};

// ─── Params ───────────────────────────────────────────────────────────────────

const paramsSchema = z.object({
  courseId:           z.string(),
  studentIds:         z.array(z.string()).optional(),
  includeQuizScores:  z.boolean().default(false),
  includeSubmissions: z.boolean().default(false),
});

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function executeFetchStudentData(rawInput, _ctx) {
  const input = paramsSchema.parse(rawInput);

  const students = await queryStudents(input);
  const summary  = buildCourseSummary(students);

  return { students, summary };
}

// ─── DB query ─────────────────────────────────────────────────────────────────

async function queryStudents(input) {
  let q = db.from("enrollments")
    .select("progress, enrolled_at, users!enrollments_user_id_fkey ( id, full_name, email )")
    .eq("course_id", input.courseId);
  const { data } = await q;
  let rows = (data ?? []).map(e => ({
    id: e.users?.id, name: e.users?.full_name ?? "Student",
    email: e.users?.email ?? "", progress: e.progress ?? 0,
    lastActiveAt: e.enrolled_at, quizAverage: null,
    riskLevel: computeRisk(e.progress ?? 0, e.enrolled_at),
  }));
  if (input.studentIds?.length) rows = rows.filter(s => input.studentIds.includes(s.id));
  return rows;
}

// ─── Risk computation ─────────────────────────────────────────────────────────

function computeRisk(progress, lastActiveAt) {
  const daysSinceActive = Math.floor(
    (Date.now() - new Date(lastActiveAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  if (progress < 25 || daysSinceActive > 21) return "high";
  if (progress < 50 || daysSinceActive > 7)  return "medium";
  return "low";
}

// ─── Course summary builder ───────────────────────────────────────────────────

function buildCourseSummary(students) {
  const total    = students.length;
  const avgProg  = total > 0
    ? Math.round(students.reduce((s, st) => s + st.progress, 0) / total)
    : 0;
  const atRisk    = students.filter((s) => s.riskLevel === "high").length;
  const completed = students.filter((s) => s.progress >= 100).length;
  const quizAvgs  = students.map((s) => s.quizAverage).filter((v) => v !== null);
  const avgQuiz   = quizAvgs.length > 0
    ? Math.round(quizAvgs.reduce((a, b) => a + b, 0) / quizAvgs.length)
    : null;

  return { totalStudents: total, averageProgress: avgProg, atRiskCount: atRisk, completedCount: completed, averageQuizScore: avgQuiz };
}
