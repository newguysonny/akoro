// modules/tasks/tools/attendance-rollcall.js
// Catalog tool: "Attendance / Roll Call" (key: attendance) — voice agent.
// Orchestration: load the class roster, reconcile against the names heard
// during a voice roll-call (transcript) or an explicit present list, and
// produce a marked register.

import { z } from "zod";
import db from "../../../db.js";
import { TaskOutputDB } from "../lib/db.js";
import { llmJson } from "./_llm.js";

export const attendanceRollcallDefinition = {
  name: "attendance_rollcall",
  description:
    "Take a class register. Loads the course roster and marks each student " +
    "present/absent from either a spoken roll-call transcript or an explicit " +
    "list of present names. Use when the teacher asks to take attendance / roll call.",
  input_schema: {
    type: "object",
    properties: {
      courseId:     { type: "string", description: "Course whose roster to register" },
      roster:       { type: "array", items: { type: "string" }, description: "Explicit roster names (used if courseId omitted/empty)" },
      presentNames: { type: "array", items: { type: "string" }, description: "Names confirmed present" },
      transcript:   { type: "string", description: "Raw voice roll-call transcript to extract present names from" },
    },
    required: [],
  },
};

const schema = z.object({
  courseId:     z.string().optional(),
  roster:       z.array(z.string()).default([]),
  presentNames: z.array(z.string()).default([]),
  transcript:   z.string().default(""),
});

async function loadRoster(courseId) {
  try {
    const { data } = await db.from("enrollments")
      .select("users!enrollments_user_id_fkey ( id, full_name )")
      .eq("course_id", courseId);
    return (data ?? []).map((e) => ({ id: e.users?.id, name: e.users?.full_name }))
      .filter((s) => s.name);
  } catch {
    return [];
  }
}

const norm = (s) => String(s || "").trim().toLowerCase();

export async function executeAttendanceRollcall(rawInput, ctx) {
  const input = schema.parse(rawInput);

  let roster = input.courseId ? await loadRoster(input.courseId) : [];
  if (!roster.length) roster = input.roster.map((name) => ({ id: null, name }));
  if (!roster.length) throw new Error("No roster available — provide courseId or roster[]");

  // Resolve who's present. Prefer explicit list; otherwise extract from the
  // transcript by matching spoken names against the roster (fuzzy via LLM).
  let present = new Set(input.presentNames.map(norm));
  if (!present.size && input.transcript.trim()) {
    try {
      const matched = await llmJson(
        `Roster: ${JSON.stringify(roster.map((s) => s.name))}
Roll-call transcript: """${input.transcript}"""
Return JSON { "present": ["<exact roster name>", ...] } listing roster names that responded present.`,
        { maxTokens: 800 }
      );
      present = new Set((matched.present || []).map(norm));
    } catch { /* fall through — all absent */ }
  }

  const marked = roster.map((s) => ({ id: s.id, name: s.name, present: present.has(norm(s.name)) }));
  const presentCount = marked.filter((m) => m.present).length;

  await TaskOutputDB.create({
    runId: ctx.runId, taskId: ctx.taskId,
    outputType: "attendance",
    content: {
      type: "attendance", tool: "attendance_rollcall",
      courseId: input.courseId ?? null,
      takenAt: new Date().toISOString(),
      total: marked.length, present: presentCount, absent: marked.length - presentCount,
      register: marked,
    },
    delivered: false,
  });

  return { success: true, total: marked.length, present: presentCount, absent: marked.length - presentCount };
}
