// src/tasks/tools/send-reminder.ts
// Sends reminder messages to students via the platform notification system.
// Resolves recipients from the DB, personalises the message, then calls
// the notifications lib which handles in-app push and email.

import { z }              from "zod";
import { TaskOutputDB, db } from "../lib/db.js";
import { sendBulkNotifications } from "../lib/notifications.js";


import * as schema           ;
import { eq, and, lt }       from "drizzle-orm";

// ─── Tool definition ──────────────────────────────────────────────────────────

export const sendReminderDefinition = {
  name: "send_reminder",
  description:
    "Send a reminder message to students. " +
    "Can target all students in a course, specific student IDs, " +
    "or students who match a condition like 'haven't submitted' or 'below 60% progress'. " +
    "Always draft the message first and confirm the recipient count before sending.",
  input_schema: {
    type: "object",
    properties: {
      courseId: {
        type: "string",
        description: "The course to send the reminder for",
      },
      targetType: {
        type: "string",
        enum: ["all", "specific", "condition"],
        description:
          "'all' = all enrolled students, " +
          "'specific' = list of studentIds, " +
          "'condition' = filter by a condition string",
      },
      studentIds: {
        type: "array",
        items: { type: "string" },
        description: "Required when targetType is 'specific'",
      },
      condition: {
        type: "string",
        description:
          "Required when targetType is 'condition'. " +
          "E.g. 'progress < 50%', 'quiz not submitted', 'inactive for 7 days'",
      },
      message: {
        type: "string",
        description:
          "The reminder message text. Use {name} as a placeholder for the student's first name.",
      },
      channel: {
        type: "string",
        enum: ["in_app", "email", "both"],
        description: "Delivery channel (default: in_app)",
      },
    },
    required: ["courseId", "targetType", "message"],
  },
};

// ─── Params ───────────────────────────────────────────────────────────────────

const paramsSchema = z.object({
  courseId:   z.string(),
  targetType: z.enum(["all", "specific", "condition"]),
  studentIds: z.array(z.string()).optional(),
  condition:  z.string().optional(),
  message:    z.string().min(10).max(500),
  channel:    z.enum(["in_app", "email", "both"]).default("in_app"),
});

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function executeSendReminder(
  rawInput,
  ctx
) {
  const input = paramsSchema.parse(rawInput);

  const recipients = await resolveRecipients(input);

  if (recipients.length === 0) {
    return { success: true, sentCount: 0, recipientIds: [] };
  }

  // Send via the notifications lib (in-app Pusher push + optional email)
  const results = await sendBulkNotifications(
    recipients.map((r) => ({
      studentId:   r.id,
      studentName: r.name,
      email:       r.email,
      message:     input.message,
    })),
    input.channel,
    { courseId: input.courseId }
  );

  const sentCount = results.filter((r) => r.inApp || r.email).length;

  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType: "reminder",
    content: {
      type:       "reminder",
      studentIds: recipients.map((r) => r.id),
      message:    input.message,
      channel:    input.channel,
      courseId:   input.courseId,
      sentCount,
      condition:  input.condition,
    } as unknown as Record<string, unknown>,
    delivered: false,
  });

  return { success: true, sentCount, recipientIds: recipients.map((r) => r.id) };
}

// ─── Recipient resolver ───────────────────────────────────────────────────────

interface Recipient { id; name; email; progress? }

async function resolveRecipients(
  input
) {
  // We join enrollments → students to get name + email.
  // Your schema may look different — adjust the table/column names accordingly.
  // Here we query the `students` table from the akoro main schema.
  // For now we query the teachers table as a stand-in for the student table
  // until the full students table is wired in.

  try {
    if (input.targetType === "specific" && input.studentIds?.length) {
      // Return only the requested students
      return await fetchStudentsByIds(input.studentIds);
    }

    if (input.targetType === "all") {
      return await fetchAllStudentsInCourse(input.courseId);
    }

    if (input.targetType === "condition" && input.condition) {
      return await fetchStudentsByCondition(input.courseId, input.condition);
    }
  } catch (err) {
    console.error("[send-reminder] Failed to resolve recipients:", err);
  }

  return [];
}

// These hit the students/enrollments tables in your main schema.
// Replace these with your actual ORM queries once the students table is created.

async function fetchStudentsByIds(ids[]) {
  // TODO: replace with real query
  // e.g. return db.select().from(students).where(inArray(students.id, ids))
  return ids.map((id) => ({ id, name: "Student", email: "student@example.com" }));
}

async function fetchAllStudentsInCourse(courseId) {
  // TODO: replace with real query
  // e.g. return db.select({ id, name, email }).from(enrollments)
  //              .innerJoin(students, eq(enrollments.studentId, students.id))
  //              .where(eq(enrollments.courseId, courseId))
  console.log(`[send-reminder] Fetching all students for course ${courseId}`);
  return [];
}

async function fetchStudentsByCondition(
  courseId:  string,
  condition
) {
  // Parse simple conditions the agent might pass
  // "progress < 50" or "inactive for 7 days" etc.
  const progressMatch = condition.match(/progress\s*[<]\s*(\d+)/i);
  if (progressMatch) {
    const threshold = parseInt(progressMatch[1]);
    console.log(`[send-reminder] Fetching students with progress < ${threshold}% in ${courseId}`);
    // TODO: db.select().from(enrollments).where(and(eq(courseId), lt(progress, threshold)))
    return [];
  }

  // Default: return all
  return fetchAllStudentsInCourse(courseId);
}
