// modules/tasks/tools/set-study-reminder.js
// Student-facing study reminder. Creates a notification row for the student.

import { z }                    from "zod";
import { TaskDB, TaskOutputDB } from "../lib/db.js";
import db                       from "../../../db.js";

export const setStudyReminderDefinition = {
  name: "set_study_reminder",
  description:
    "Set a study reminder for the student. " +
    "Use this when the student says 'remind me', 'set a reminder', " +
    "or 'reminder to' study something.",
  input_schema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The reminder message, e.g. 'Revise chapter 5 of Biology'",
      },
      remindAt: {
        type: "string",
        description: "Optional ISO 8601 datetime string for when to remind",
      },
      recurring: {
        type: "boolean",
        description: "Whether the reminder repeats (default: false)",
      },
      cronExpr: {
        type: "string",
        description: "Optional cron expression for recurring reminders",
      },
    },
    required: ["message"],
  },
};

const paramsSchema = z.object({
  message:   z.string().min(1).max(500),
  remindAt:  z.string().optional(),
  recurring: z.boolean().default(false),
  cronExpr:  z.string().optional(),
});

export async function executeSetStudyReminder(rawInput, ctx) {
  const input = paramsSchema.parse(rawInput);

  const task = await TaskDB.findById(ctx.taskId);
  const studentId = task?.creator_id;

  if (studentId) {
    try {
      await db.from("notifications").insert({
        user_id:    studentId,
        type:       "study_reminder",
        title:      "Study Reminder",
        content:    input.message,
        is_read:    false,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn("[set-study-reminder] Could not insert notification:", err?.message ?? err);
    }
  }

  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType: "reminder",
    content: {
      type:     "reminder",
      message:  input.message,
      remindAt: input.remindAt ?? null,
    },
    delivered: false,
  });

  return { success: true };
}
