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
    "Create a battle for learners. Two kinds, like the Battles form: a CLASS battle " +
    "(name the class and a subject — questions come from the past-questions bank) or a " +
    "COURSE battle (name the course — questions come from that course's bank). Use this when " +
    "the teacher says 'create a battle', 'set a challenge', 'quiz competition', 'speed round' " +
    "or similar. One named learner produces a 1-v-1 challenge they accept or decline; two or " +
    "more produces a group battle everyone is entered into.",
  input_schema: {
    type: "object",
    properties: {
      courseId:  { type: "string", description: "The course the battle belongs to — its question bank supplies the questions. Omit to use the course this task is attached to." },
      title:     { type: "string", description: "Battle title, e.g. 'Photosynthesis Showdown'" },
      topic:     { type: "string", description: "Topic to draw questions on" },
      subject:   { type: "string", description: "Subject, e.g. Mathematics. REQUIRED for a class battle — its questions are drawn from this subject." },
      audience:  {
        type: "string",
        enum: ["course", "class", "learners"],
        description: "Who it is for: everyone on the course, a whole class, or named learners",
      },
      className: { type: "string", description: "Class name when audience is 'class', e.g. 'JSS1'. A class battle needs this and a subject." },
      usernames: { type: "array", items: { type: "string" }, description: "Usernames when audience is 'learners'" },
      difficulty:      { type: "string", enum: ["easy", "intermediate", "hard"] },
      totalQuestions:  { type: "number", description: "Default 15" },
      durationMinutes: { type: "number", description: "Default 15" },
      xpPrize:         { type: "number", description: "Default 200" },
      scheduledFor:    { type: "string", description: "ISO timestamp to start it later. Omit to send it now." },
      questionSource:  { type: "string", enum: ["auto", "bank", "ai"], description: "Where questions come from. 'auto' (default) uses the bank and generates the shortfall." },
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
  questionSource:  z.enum(["auto", "bank", "ai"]).default("auto"),
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

  // Which kind of battle? A named class means a CLASS battle — questions from
  // the past-questions bank for a subject. This tool could only ever make
  // course battles, so "every Monday, set JSS1 a battle" produced nothing at
  // all for a teacher whose learners simply attend a class.
  const target = { whole_class: false, classroom_id: null, usernames: [] };
  let path, room = null;

  if (input.audience === "class") {
    if (!input.className) return { success: false, error: "Which class? Name it in the task, e.g. 'for JSS1'." };
    room = await findClassroom(input.className, ctx.teacherId);
    if (!room) return { success: false, error: `No class called "${input.className}" — check the name under Academics → Classes.` };
    if (!input.subject) return { success: false, error: `Which subject? A class battle draws its questions from one — name it, e.g. "Mathematics".` };
    target.whole_class = true;
    path = `/api/battle/classes/${room.id}/battles/invite`;
  } else {
    // Course battle. Prefer what the model said, fall back to the task's own
    // course, then to the teacher's only course — and if still ambiguous, name
    // the options instead of failing blankly.
    let courseId = input.courseId || ctx.courseId;
    if (!courseId) {
      const { data: mine } = await db.from("courses")
        .select("id, title").eq("instructor_id", ctx.teacherId).limit(5);
      if (mine?.length === 1) courseId = mine[0].id;
      else return {
        success: false,
        error: mine?.length
          ? `Which course is this battle for? Yours are: ${mine.map((c) => c.title).join(", ")}. Or name a class instead, e.g. "for JSS1".`
          : 'You have no courses — name a class instead, e.g. "for JSS1", and a subject for its questions.',
      };
    }
    if (input.audience === "course") target.whole_class = true;
    else {
      if (!input.usernames.length) return { success: false, error: "Which learners? List their usernames in the task." };
      target.usernames = input.usernames;
    }
    path = `/api/battle/courses/${courseId}/battles/invite`;
  }

  let result;
  try {
    result = await callAsUser(path, {
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
        question_source:    input.questionSource,
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
      courseId: input.courseId ?? ctx.courseId ?? null,
      classroomId: room?.id ?? null,
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
