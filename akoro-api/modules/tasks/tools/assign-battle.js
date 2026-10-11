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
    "Create a battle or a study review, like the Battles form.\n" +
    "\n" +
    "KINDS\n" +
    "  class    — everyone in a class (name the class AND a subject). Questions come " +
    "from the past-questions bank for that subject.\n" +
    "  learners — two or more named learners. Name the class they are in, or the course.\n" +
    "  course   — everyone enrolled on a course. Questions come from that course's bank.\n" +
    "  review   — ONE named learner, checked with a mark sheet instead of a winner.\n" +
    "\n" +
    "A battle is agent against agent, so it needs at least TWO learners. If the teacher " +
    "names only one, that is a study review — say so rather than creating a battle.\n" +
    "\n" +
    "REQUIRED: title, audience. Plus className AND subject for class/learners-in-a-class " +
    "and review; plus courseId (or the task's own course) for course battles.\n" +
    "Everything else has a sensible default — do not invent values the teacher did not give.\n" +
    "\n" +
    "Use it for 'create a battle', 'set a challenge', 'quiz competition', 'speed round', " +
    "'review <learner> on <topic>', 'check what <learner> knows'.\n" +
    "\n" +
    "Good: {audience:'class', className:'JSS1', subject:'Basic Science', topic:'Photosynthesis', " +
    "title:'Photosynthesis Showdown', totalQuestions:10}\n" +
    "Good: {audience:'learners', className:'JSS1', subject:'Mathematics', " +
    "usernames:['priya','amaka'], title:'Fractions face-off'}\n" +
    "Good: {audience:'review', className:'JSS1', subject:'Mathematics', topic:'Fractions', " +
    "usernames:['priya'], title:'Fractions review'}",
  input_schema: {
    type: "object",
    properties: {
      title:     { type: "string", description: "REQUIRED. What learners see, e.g. 'Photosynthesis Showdown'." },
      audience:  {
        type: "string",
        enum: ["class", "learners", "course", "review"],
        description:
          "REQUIRED. 'class' = everyone in the class; 'learners' = two or more named " +
          "learners; 'course' = everyone enrolled; 'review' = exactly one learner, marked.",
      },
      className: { type: "string", description: "The class, e.g. 'JSS1'. REQUIRED for 'class' and 'review', and for naming learners within a class rather than a course." },
      subject:   { type: "string", description: "REQUIRED for anything class-based — the past-questions bank is searched by subject, so this is what decides which questions exist. e.g. 'Mathematics', 'Basic Science'." },
      usernames: { type: "array", items: { type: "string" }, description: "REQUIRED for 'learners' (two or more) and 'review' (exactly one)." },
      courseId:  { type: "string", description: "For 'course' battles. Omit to use the course this task is attached to." },
      topic:     {
        type: "string",
        description:
          "Optional, and it does different things: for a CLASS battle from the bank it is " +
          "recorded but does not narrow the questions (the bank is searched by subject); for " +
          "a COURSE battle it FILTERS that course's bank, so a topic the course has no " +
          "questions for will come back empty; and it always steers AI-generated questions. " +
          "Give it when the teacher names one, e.g. 'on photosynthesis'.",
      },
      difficulty:      { type: "string", enum: ["easy", "intermediate", "hard"], description: "Optional. Default intermediate." },
      totalQuestions:  { type: "number", description: "Optional. Default 15. At least 5 must be findable or the battle is refused." },
      durationMinutes: { type: "number", description: "Optional. Default 15. Shared across the questions — 15 minutes over 15 questions gives each one a minute." },
      xpPrize:         { type: "number", description: "Optional. Default 200." },
      hpPerMiss:       { type: "number", description: "Optional. HP each agent loses per missed question, 0–50 (default 10; 100 HP to start, 0 HP = out and unranked). Learners see it before accepting." },
      minXp:           { type: "number", description: "Optional. Minimum XP a learner needs to accept (default 0). Ignored for a review." },
      scheduledFor:    { type: "string", description: "Optional ISO timestamp to start it later. Omit to send it now; learners accept and it starts once they have all answered." },
      questionSource:  { type: "string", enum: ["auto", "bank", "ai"], description: "Optional. Default 'auto' — the bank first, AI for the shortfall. 'bank' refuses rather than generating; 'ai' generates the lot and costs coins." },
    },
    required: ["title", "audience"],
  },
};

const paramsSchema = z.object({
  courseId:        z.string().optional(),
  title:           z.string(),
  topic:           z.string().optional(),
  subject:         z.string().optional(),
  audience:        z.enum(["course", "class", "learners", "review"]),
  className:       z.string().optional(),
  usernames:       z.array(z.string()).default([]),
  difficulty:      z.enum(["easy", "intermediate", "hard"]).default("intermediate"),
  totalQuestions:  z.number().min(1).max(50).default(15),
  durationMinutes: z.number().min(1).max(180).default(15),
  xpPrize:         z.number().min(0).default(200),
  hpPerMiss:       z.number().int().min(0).max(50).optional(),
  minXp:           z.number().int().min(0).optional(),
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

  // A CLASS is named, so this is a class battle — whether it is for everyone in
  // it or for named learners within it. Only 'learners' used to reach here at
  // all through the course branch, so "set a battle for Priya and Ada in JSS1"
  // demanded a course and listed the teacher's twelve courses back at them,
  // even though the class and the subject were right there in the request.
  if (input.audience === "class" || input.audience === "review" ||
      (input.audience === "learners" && input.className)) {
    if (!input.className) return { success: false, error: "Which class? Name it in the task, e.g. 'for JSS1'." };
    room = await findClassroom(input.className, ctx.teacherId);
    if (!room) return { success: false, error: `No class called "${input.className}" — check the name under Academics → Classes.` };
    // Subject is the one field with no sensible default: the past-questions
    // bank is searched BY subject, so without it there is nothing to draw from.
    // The endpoint refuses it too, but answering here names what is missing
    // instead of returning the endpoint's message through a failed run.
    if (!input.subject) {
      return { success: false, error:
        `Which subject? ${input.audience === "review" ? "A review" : "A class battle"} draws its questions from one — name it, e.g. "Mathematics" or "Basic Science".` };
    }

    if (input.audience === "class") {
      target.whole_class = true;
    } else {
      if (!input.usernames.length) {
        return { success: false, error: "Which learners? List their usernames in the task." };
      }
      target.usernames = input.usernames;
      // A battle is agent vs agent, so it needs two. A REVIEW is the one shape
      // that takes exactly one — say which they meant rather than letting the
      // endpoint refuse it with a message about picking more people.
      if (input.audience === "learners" && input.usernames.length < 2) {
        return { success: false, error:
          `A battle needs two learners to compete. Name another, or ask for a study review of ${input.usernames[0]} instead.` };
      }
      if (input.audience === "review" && input.usernames.length !== 1) {
        return { success: false, error: "A study review is for one learner. Name exactly one." };
      }
      if (input.audience === "review") target.mode = "review";
    }
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
    else if (input.audience === "review") {
      return { success: false, error:
        "A study review is set on a class, not a course. Name the class, e.g. 'review Priya in JSS1 on fractions'." };
    } else {
      if (!input.usernames.length) return { success: false, error: "Which learners? List their usernames in the task." };
      if (input.usernames.length < 2) {
        return { success: false, error:
          `A battle needs two learners to compete. Name another, or ask for a study review of ${input.usernames[0]} instead.` };
      }
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
        hp_per_miss:        input.hpPerMiss,
        min_xp:             input.audience === "review" ? 0 : input.minXp,
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
