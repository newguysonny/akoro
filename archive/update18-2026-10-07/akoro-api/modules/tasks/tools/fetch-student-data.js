// src/tasks/tools/fetch-student-data.ts
// Fetches student progress, engagement, and performance data.
// Used as a supporting tool by most other tools.
// Replace the mock data section with real DB queries once your
// students / enrollments tables are created.

import { z }            from "zod";



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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StudentData {
  id:           string;
  name:         string;
  email:        string;
  progress:     number;
  lastActiveAt;
  quizAverage:  number | null;
  quizScores?:  QuizScore[];
  submissions?: SubmissionStatus[];
  riskLevel:    "low" | "medium" | "high";
}

interface QuizScore {
  quizTitle;
  score:     number;
  maxScore:  number;
  takenAt:   string;
}

interface SubmissionStatus {
  assignmentTitle;
  submitted:       boolean;
  submittedAt?:    string;
  grade?:          number;
}

export interface CourseSummary {
  totalStudents:    number;
  averageProgress:  number;
  atRiskCount:      number;
  completedCount:   number;
  averageQuizScore | null;
}

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function executeFetchStudentData(
  rawInput,
  _ctx
) {
  const input = paramsSchema.parse(rawInput);

  const students = await queryStudents(input);
  const summary  = buildCourseSummary(students);

  return { students, summary };
}

// ─── DB query (replace mock with real queries) ────────────────────────────────
// Wire these to your enrollments + students tables.
// The shape returned must match StudentData.

async function queryStudents(
  input
) {
  // ── Real implementation (uncomment once your students table exists) ────────
  //
  // import { db } from "../lib/db.js";
  // import { enrollments, students, quizAttempts } ;
  // import { eq, inArray, and } from "drizzle-orm";
  //
  // const baseQuery = db
  //   .select({
  //     id:           students.id,
  //     name:         students.name,
  //     email:        students.email,
  //     progress:     enrollments.progress,
  //     lastActiveAt: enrollments.lastActiveAt,
  //     quizAverage:  enrollments.quizAverage,
  //   })
  //   .from(enrollments)
  //   .innerJoin(students, eq(enrollments.studentId, students.id))
  //   .where(
  //     input.studentIds?.length
  //       ? and(eq(enrollments.courseId, input.courseId), inArray(students.id, input.studentIds))
  //       : eq(enrollments.courseId, input.courseId)
  //   );
  //
  // const rows = await baseQuery;
  // return rows.map(r => ({ ...r, riskLevel: computeRisk(r.progress, r.lastActiveAt) }));

  // ── Mock data (remove when real queries are in place) ─────────────────────
  const ALL_MOCK: StudentData[] = [
    {
      id:           "student-001",
      name:         "Chukwuemeka Obi",
      email:        "chuks@gmail.com",
      progress:     84,
      lastActiveAt: new Date(Date.now() - 1 * 86400000).toISOString(),
      quizAverage:  78,
      riskLevel:    "low",
    },
    {
      id:           "student-002",
      name:         "Aisha Bello",
      email:        "aisha.b@yahoo.com",
      progress:     72,
      lastActiveAt: new Date(Date.now() - 3 * 86400000).toISOString(),
      quizAverage:  65,
      riskLevel:    "medium",
    },
    {
      id:           "student-003",
      name:         "Tunde Adeleke",
      email:        "tunde.a@outlook.com",
      progress:     31,
      lastActiveAt: new Date(Date.now() - 18 * 86400000).toISOString(),
      quizAverage:  42,
      riskLevel:    "high",
    },
    {
      id:           "student-004",
      name:         "Ngozi Eze",
      email:        "ngozi.e@gmail.com",
      progress:     91,
      lastActiveAt: new Date(Date.now() - 0.5 * 86400000).toISOString(),
      quizAverage:  88,
      riskLevel:    "low",
    },
    {
      id:           "student-005",
      name:         "Babatunde Williams",
      email:        "baba.w@gmail.com",
      progress:     58,
      lastActiveAt: new Date(Date.now() - 5 * 86400000).toISOString(),
      quizAverage:  54,
      riskLevel:    "medium",
    },
    {
      id:           "student-006",
      name:         "Fatima Hassan",
      email:        "fatima.h@mail.com",
      progress:     0,
      lastActiveAt: new Date(Date.now() - 25 * 86400000).toISOString(),
      quizAverage:  null,
      riskLevel:    "high",
    },
  ];

  const filtered = input.studentIds?.length
    ? ALL_MOCK.filter((s) => input.studentIds!.includes(s.id))
    : ALL_MOCK;

  // Recompute risk levels fresh on each call
  return filtered.map((s) => ({
    ...s,
    riskLevel: computeRisk(s.progress, s.lastActiveAt),
  }));
}

// ─── Risk computation ─────────────────────────────────────────────────────────

function computeRisk(
  progress:     number,
  lastActiveAt
): "low" | "medium" | "high" {
  const daysSinceActive = Math.floor(
    (Date.now() - new Date(lastActiveAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  if (progress < 25 || daysSinceActive > 21) return "high";
  if (progress < 50 || daysSinceActive > 7)  return "medium";
  return "low";
}

// ─── Course summary builder ───────────────────────────────────────────────────

function buildCourseSummary(students: StudentData[]): CourseSummary {
  const total    = students.length;
  const avgProg  = total > 0
    ? Math.round(students.reduce((s, st) => s + st.progress, 0) / total)
    : 0;
  const atRisk    = students.filter((s) => s.riskLevel === "high").length;
  const completed = students.filter((s) => s.progress >= 100).length;
  const quizAvgs  = students.map((s) => s.quizAverage).filter((v): v is number => v !== null);
  const avgQuiz   = quizAvgs.length > 0
    ? Math.round(quizAvgs.reduce((a, b) => a + b, 0) / quizAvgs.length)
    : null;

  return { totalStudents: total, averageProgress: avgProg, atRiskCount: atRisk, completedCount: completed, averageQuizScore: avgQuiz };
}
