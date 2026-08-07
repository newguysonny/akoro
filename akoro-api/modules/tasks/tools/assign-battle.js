// modules/tasks/tools/assign-battle.js
//
// Schedule a battle the same way the Battles form creates one: for a whole
// course, a class (JSS1), or named learners.
//
// This replaces what create_battle could reach. That tool writes straight into
// `battles` as an OPEN lobby — nobody is invited, nobody is notified, and its
// "classroom" branch inserts no participants at all, so a classroom battle from
// a task had zero players and could never start. It also predates the targeting
// work, so it had no way to say who the battle was for.
//
// Rather than duplicate that logic a second time, this calls the same invite
// endpoint the UI calls, over HTTP, with a short-lived token minted for the
// task's owner. One creation path means a battle made by a schedule and a
// battle made by hand are the same object, with the same notifications,
// eligibility rules and skipped-learner reporting.

import { z }            from "zod";
import db               from "../../../db.js";
import { TaskOutputDB } from "../lib/db.js";
import { signInternalAccess } from "../../auth/routes.js";

const API_BASE = process.env.INTERNAL_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

export const assignBattleDefinition = {
  name: "assign_battle",
  description:
    "Create a battle for learners — a whole course, a class (e.g. JSS1), or named learners. " +
    "Use this when the teacher says 'create a battle', 'set a challenge', 'quiz competition', " +
    "'speed round' or similar, for their students. Questions come from the course's question " +
    "bank. One named learner produces a 1-v-1 challenge they accept or decline; two or more " +
    "produces a group battle everyone is entered into.",
  input_schema: {
    type: "object",
    properties: {
      courseId:  { type: "string", description: "The course the battle belongs to — its question bank supplies the questions. Omit to use the course this task is attached to." },
      title:     { type: "string", description: "Battle title, e.g. 'Photosynthesis Showdown'" },
      topic:     { type: "string", description: "Topic to draw questions on" },
      subject:   { type: "string", description: "Subject, e.g. Basic Science" },
      audience:  {
        type: "string",
        enum: ["course", "class", "learners"],
        description: "Who it is for: everyone on the course, a whole class, or named learners",
      },
      className: { type: "string", description: "Class name when audience is 'class', e.g. 'JSS1'" },
      usernames: { type: "array", items: { type: "string" }, description: "Usernames when audience is 'learners'" },
      difficulty:      { type: "string", enum: ["easy", "intermediate", "hard"] },
      totalQuestions:  { type: "number", description: "Default 15" },
      durationMinutes: { type: "number", description: "Default 15" },
      xpPrize:         { type: "number", description: "Default 200" },
      scheduledFor:    { type: "string", description: "ISO timestamp to start it later. Omit to send it now." },
    },
    required: ["title", "audience"],
  },
};

const paramsSchema = z.object({
  courseId:        z.string().optional(),
  title:           z.string(),
  topic:           z.string().optional(),
  subject:         z.string().optional(),
  audience:        z.enum(["course", "class", "learners"]),
  className:       z.string().optional(),
  usernames:       z.array(z.string()).default([]),
  difficulty:      z.enum(["easy", "intermediate", "hard"]).default("intermediate"),
  totalQuestions:  z.number().min(1).max(50).default(15),
  durationMinutes: z.number().min(1).max(180).default(15),
  xpPrize:         z.number().min(0).default(200),
  scheduledFor:    z.string().optional(),
});

/**
 * A task runs with no request and therefore no cookie, but the endpoints it
 * calls are the user's own. signInternalAccess borrows the task owner's
 * identity for two minutes — signed by the same factory as a real login, so it
 * satisfies authenticateToken without a service account that would have wider
 * reach than the teacher who scheduled the work.
 */
export async function callAsUser(path, { method = "POST", body, userId, role, email }) {
  const token = signInternalAccess({ id: userId, role: role || "instructor", email });
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${token}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || json.message || `${method} ${path} failed (${res.status})`);
  return json;
}

/** Resolve a class by name within the teacher's reach, so the model can say "JSS1". */
async function findClassroom(name, teacherId) {
  const { data: school } = await db.from("school_profiles")
    .select("id").eq("admin_user_id", teacherId).limit(1).maybeSingle();

  let q = db.from("classrooms").select("id, name").ilike("name", name);
  q = school ? q.or(`teacher_id.eq.${teacherId},school_id.eq.${school.id}`) : q.eq("teacher_id", teacherId);

  const { data } = await q.limit(1);
  return data?.[0] ?? null;
}

export async function executeAssignBattle(rawInput, ctx) {
  const input = paramsSchema.parse(rawInput);

  const { data: creator } = await db.from("users").select("role, email").eq("id", ctx.teacherId).maybeSingle();

  // A battle needs a course for its question bank. Prefer what the model said,
  // fall back to the task's own course, then to the teacher's only course —
  // and if it is still ambiguous, name the options instead of failing blankly.
  let courseId = input.courseId || ctx.courseId;
  if (!courseId) {
    const { data: mine } = await db.from("courses")
      .select("id, title").eq("instructor_id", ctx.teacherId).limit(5);
    if (mine?.length === 1) courseId = mine[0].id;
    else return {
      success: false,
      error: mine?.length
        ? `Which course is this battle for? Yours are: ${mine.map((c) => c.title).join(", ")}. Name one in the task.`
        : "You have no courses yet — a battle takes its questions from a course's question bank.",
    };
  }

  const target = { whole_class: false, classroom_id: null, usernames: [] };
  if (input.audience === "course") {
    target.whole_class = true;
  } else if (input.audience === "class") {
    if (!input.className) return { success: false, error: "Which class? Name it in the task, e.g. 'for JSS1'." };
    const room = await findClassroom(input.className, ctx.teacherId);
    if (!room) return { success: false, error: `No class called "${input.className}" — check the name under Academics → Classes.` };
    target.whole_class = true;
    target.classroom_id = room.id;
  } else {
    if (!input.usernames.length) return { success: false, error: "Which learners? List their usernames in the task." };
    target.usernames = input.usernames;
  }

  let result;
  try {
    result = await callAsUser(`/api/battle/courses/${courseId}/battles/invite`, {
      userId: ctx.teacherId,
      role:   creator?.role,
      email:  creator?.email,
      body: {
        title:              input.title,
        topic:              input.topic ?? null,
        subject:            input.subject ?? null,
        difficulty:         input.difficulty,
        total_questions:    input.totalQuestions,
        time_limit_seconds: input.durationMinutes * 60,
        xp_prize:           input.xpPrize,
        scheduled_for:      input.scheduledFor ?? null,
        ...target,
      },
    });
  } catch (e) {
    // A battle nobody can play is the teacher's to fix, not a crash.
    return { success: false, error: e.message };
  }

  const d = result?.data ?? {};

  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType: "battle",
    content: {
      type:       "battle",
      battleId:   d.battle_id,
      title:      input.title,
      battleType: d.battle_type,
      status:     d.status,
      invited:    d.invited,
      skipped:    d.skipped ?? {},
      courseId,
      scheduledFor: input.scheduledFor ?? null,
    },
    delivered: false,
  });

  return {
    success:  true,
    battleId: d.battle_id,
    title:    input.title,
    invited:  d.invited,
    status:   d.status,
    // Name who missed out so the run summary can pass it on.
    skipped:  d.skipped ?? {},
  };
}
