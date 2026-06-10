// modules/tasks/tools/schedule-session.js
// Schedules a live class session — creates the session record, generates
// a meeting link (Zoom / Google Meet), and notifies enrolled students.

import { z }            from "zod";
import Anthropic        from "@anthropic-ai/sdk";
import { TaskOutputDB } from "../lib/db.js";

import { v4 as uuid }   from "uuid";

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

  const sessionId = uuid();
  const joinUrl   = generateMeetingLink(input.platform, sessionId);

  // TODO: in production, create session in your sessions table
  // await db.sessions.create({ id: sessionId, courseId: input.courseId, ... });

  // TODO: if notifyStudents, trigger a reminder task or notification
  // await notificationService.sessionScheduled(input.courseId, { title, joinUrl, scheduledAt });

  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType: "session",
    content: {
      type:            "session",
      sessionId,
      title:           input.title,
      description:     input.description,
      scheduledAt:     input.scheduledAt,
      durationMinutes: input.durationMinutes,
      platform:        input.platform,
      joinUrl,
      courseId:        input.courseId,
      notifyStudents:  input.notifyStudents,
    },
    delivered: false,
  });

  return { success: true, sessionId, joinUrl, scheduledAt: input.scheduledAt };
}

// ─── Meeting link generator ────────────────────────────────────────────────────
// In production: call the Zoom / Meet API to create a real meeting.

function generateMeetingLink(platform, sessionId) {
  const shortId = sessionId.split("-")[0];
  switch (platform) {
    case "zoom":  return `https://zoom.us/j/${shortId.replace(/\D/g, "").slice(0, 9)}`;
    case "meet":  return `https://meet.google.com/${shortId.slice(0, 3)}-${shortId.slice(3, 7)}-${shortId.slice(7, 11)}`;
    case "teams": return `https://teams.microsoft.com/l/meetup-join/${shortId}`;
    default:      return `https://akoro.app/session/${sessionId}`;
  }
}
