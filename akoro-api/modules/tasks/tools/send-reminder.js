// modules/tasks/tools/send-reminder.js
// Sends reminder messages to students via the platform notification system.
// Resolves recipients from the DB, personalises the message, then calls
// the notifications lib which handles in-app push and email.

import { z }              from "zod";
import { TaskOutputDB }   from "../lib/db.js";
import db                 from "../../../db.js";
import { sendBulkNotifications } from "../lib/notifications.js";

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

export async function executeSendReminder(rawInput, ctx) {
  const input = paramsSchema.parse(rawInput);

  const recipients = await resolveRecipients(input);

  if (recipients.length === 0) {
    return { success: true, sentCount: 0, recipientIds: [] };
  }

  // Send via the notifications lib (in-app push + optional email)
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
    },
    delivered: false,
  });

  return { success: true, sentCount, recipientIds: recipients.map((r) => r.id) };
}

// ─── Recipient resolver ───────────────────────────────────────────────────────

async function resolveRecipients(input) {
  try {
    if (input.targetType === "specific" && input.studentIds?.length) {
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

async function fetchStudentsByIds(ids) {
  const { data } = await db.from("users")
    .select("id, full_name, email")
    .in("id", ids);
  return (data ?? []).map((u) => ({
    id: u.id, name: u.full_name ?? "Student", email: u.email ?? "",
  }));
}

async function fetchAllStudentsInCourse(courseId) {
  const { data } = await db.from("enrollments")
    .select("progress, users!enrollments_user_id_fkey ( id, full_name, email )")
    .eq("course_id", courseId);
  return (data ?? []).map((e) => ({
    id: e.users?.id, name: e.users?.full_name ?? "Student",
    email: e.users?.email ?? "", progress: e.progress ?? 0,
  })).filter((s) => s.id);
}

async function fetchStudentsByCondition(courseId, condition) {
  // Parse simple conditions the agent might pass, e.g. "progress < 50".
  const progressMatch = condition.match(/progress\s*[<]\s*(\d+)/i);
  if (progressMatch) {
    const threshold = parseInt(progressMatch[1]);
    const all = await fetchAllStudentsInCourse(courseId);
    return all.filter((s) => (s.progress ?? 0) < threshold);
  }

  // Default: return all
  return fetchAllStudentsInCourse(courseId);
}
