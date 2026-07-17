// modules/tasks/tools/schedule-session.js
// Schedules a live class session — creates the session record, generates
// a meeting link (Zoom / Google Meet), and notifies enrolled students.

import { z }            from "zod";
import { TaskOutputDB } from "../lib/db.js";
import db               from "../../../db.js";

// ─── Tool definition ──────────────────────────────────────────────────────────

export const scheduleSessionDefinition = {
  name: "schedule_session",
  description:
    "Schedule a live class session for a course. " +
    "Creates the session in the database, generates a meeting link, " +
    "and queues student notifications. " +
    "Use this when the teacher asks to book, schedule, or set up a live class.",
  input_schema: {
    type: "object",
    properties: {
      courseId: {
        type: "string",
        description: "The course this session belongs to",
      },
      title: {
        type: "string",
        description: "Session title, e.g. 'Chain Rule & Product Rule'",
      },
      description: {
        type: "string",
        description: "Brief description of what will be covered",
      },
      scheduledAt: {
        type: "string",
        description: "ISO 8601 datetime string for when the session starts, e.g. 2025-07-14T14:00:00+01:00",
      },
      durationMinutes: {
        type: "number",
        description: "Session duration in minutes (default: 90)",
      },
      platform: {
        type: "string",
        enum: ["zoom", "meet", "teams"],
        description: "Video platform to use (default: zoom)",
      },
      notifyStudents: {
        type: "boolean",
        description: "Whether to send notifications to enrolled students (default: true)",
      },
    },
    required: ["courseId", "title", "scheduledAt"],
  },
};

// ─── Params ───────────────────────────────────────────────────────────────────

const paramsSchema = z.object({
  courseId:        z.string(),
  title:           z.string(),
  description:     z.string().optional(),
  scheduledAt:     z.string().datetime({ offset: true }),
  durationMinutes: z.number().min(15).max(360).default(90),
  platform:        z.enum(["zoom", "meet", "teams"]).default("zoom"),
  notifyStudents:  z.boolean().default(true),
});

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function executeScheduleSession(rawInput, ctx) {
  const input = paramsSchema.parse(rawInput);

  // The task creator is the instructor scheduling the class.
  const instructorId = ctx.teacherId ?? ctx.creatorId ?? null;
  if (!instructorId) throw new Error("schedule_session: could not resolve the scheduling instructor");

  // Verify the course exists and belongs to this instructor — never let a task
  // schedule a class on someone else's course.
  const { data: course } = await db
    .from("courses").select("id, title, subject, instructor_id")
    .eq("id", input.courseId).maybeSingle();
  if (!course) throw new Error("schedule_session: course not found");
  if (course.instructor_id !== instructorId) throw new Error("schedule_session: you can only schedule sessions on your own course");

  const start = new Date(input.scheduledAt);
  const end   = new Date(start.getTime() + input.durationMinutes * 60000);

  // Create a real scheduled session. The live-session scheduler (courses/
  // scheduler.js) then attaches the meeting link ≤15 min before start and
  // drives scheduled → live → ended automatically — so we intentionally do NOT
  // fabricate a join URL here.
  const { data: session, error } = await db.from("live_sessions").insert({
    course_id:       course.id,
    instructor_id:   instructorId,
    title:           input.title,
    description:     input.description ?? null,
    topic:           input.title,
    subject:         course.subject ?? null,
    session_type:    "class",
    scheduled_start: start.toISOString(),
    scheduled_end:   end.toISOString(),
    platform:        input.platform,
    status:          "scheduled",
  }).select("id").single();
  if (error) throw new Error(error.message);

  // Best-effort: notify enrolled students that a class was scheduled.
  let notified = 0;
  if (input.notifyStudents) {
    try {
      const { data: enrolled } = await db
        .from("enrollments").select("user_id")
        .eq("course_id", course.id).eq("status", "active").limit(1000);
      const rows = (enrolled ?? []).map((e) => ({
        user_id: e.user_id, type: "session_scheduled",
        title:   "New live class scheduled",
        content: `${input.title} — ${start.toLocaleString()}`,
        is_read: false, created_at: new Date().toISOString(),
      }));
      if (rows.length) { await db.from("notifications").insert(rows); notified = rows.length; }
    } catch (err) {
      console.warn("[schedule-session] notify failed:", err?.message ?? err);
    }
  }

  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType: "session",
    content: {
      type:            "session",
      sessionId:       session.id,
      title:           input.title,
      description:     input.description,
      scheduledAt:     input.scheduledAt,
      durationMinutes: input.durationMinutes,
      platform:        input.platform,
      courseId:        course.id,
      notifyStudents:  input.notifyStudents,
      studentsNotified: notified,
      note:            "Meeting link is created automatically ~15 minutes before the session starts.",
    },
    delivered: false,
  });

  return { success: true, sessionId: session.id, scheduledAt: input.scheduledAt, studentsNotified: notified };
}
