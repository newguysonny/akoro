// modules/tasks/tools/assign-self-study.js
//
// Assign an AI self-study topic on a schedule — "every Sunday evening, set JSS1
// next week's Basic Science topic". This is the workflow tasks exist for:
// recurring assignment that a teacher would otherwise do by hand every week.
//
// Two steps, both through the same endpoints the Self Study page uses:
//   1. /plan  — the AI drafts subtopics and objectives for the topic
//   2. POST / — creates the assignment and sends it to the chosen learners
//
// Going through HTTP rather than the DB is deliberate. The assignment carries
// notifications, targeting rules and a school scope; duplicating them here
// would mean a scheduled assignment and a hand-made one quietly differ.
//
// Note what the teacher gives up: on the Self Study page they review and edit
// the AI's plan before anything is assigned. A scheduled run has nobody to ask,
// so the draft goes out as written. That is the trade for it being automatic,
// and the tool says so in the result rather than hiding it.

import { z }            from "zod";
import db               from "../../../db.js";
import { TaskOutputDB } from "../lib/db.js";
import { callAsUser }   from "./assign-battle.js";

export const assignSelfStudyDefinition = {
  name: "assign_self_study",
  description:
    "Assign an AI self-study topic to learners — a whole course, a class (e.g. JSS1), or " +
    "named learners. Each learner works through it with their own AI agent. Use this when " +
    "the teacher says 'assign self study', 'set them a topic to study', 'independent study', " +
    "or asks for study work to be given out. The AI drafts the subtopics and objectives.",
  input_schema: {
    type: "object",
    properties: {
      topic:     { type: "string", description: "What they will study, e.g. 'Photosynthesis'" },
      subject:   { type: "string", description: "Subject, e.g. 'Basic Science'" },
      title:     { type: "string", description: "What learners see. Defaults to the topic." },
      audience:  {
        type: "string",
        enum: ["course", "class", "learners"],
        description: "Who it is for: everyone on the course, a whole class, or named learners",
      },
      courseId:  { type: "string", description: "Course this belongs to. Required for audience 'course'." },
      className: { type: "string", description: "Class name when audience is 'class', e.g. 'JSS1'" },
      usernames: { type: "array", items: { type: "string" }, description: "Usernames when audience is 'learners'" },
      instructions: { type: "string", description: "A note to the learners, e.g. 'Finish before Friday's lesson.'" },
      difficulty:   { type: "string", enum: ["easy", "intermediate", "hard"] },
      dueAt:        { type: "string", description: "ISO timestamp for the due date" },
    },
    required: ["topic", "subject", "audience"],
  },
};

const paramsSchema = z.object({
  topic:        z.string(),
  subject:      z.string(),
  title:        z.string().optional(),
  audience:     z.enum(["course", "class", "learners"]),
  courseId:     z.string().optional(),
  className:    z.string().optional(),
  usernames:    z.array(z.string()).default([]),
  instructions: z.string().optional(),
  difficulty:   z.enum(["easy", "intermediate", "hard"]).default("intermediate"),
  dueAt:        z.string().optional(),
});

async function findClassroom(name, teacherId) {
  const { data: school } = await db.from("school_profiles")
    .select("id").eq("admin_user_id", teacherId).limit(1).maybeSingle();
  let q = db.from("classrooms").select("id, name").ilike("name", name);
  q = school ? q.or(`teacher_id.eq.${teacherId},school_id.eq.${school.id}`) : q.eq("teacher_id", teacherId);
  const { data } = await q.limit(1);
  return data?.[0] ?? null;
}

export async function executeAssignSelfStudy(rawInput, ctx) {
  const input = paramsSchema.parse(rawInput);
  const { data: creator } = await db.from("users").select("role, email").eq("id", ctx.teacherId).maybeSingle();
  const as = { userId: ctx.teacherId, role: creator?.role, email: creator?.email };

  // Self study only needs a course when the audience IS the course; otherwise
  // the id is just scope. Fall back to the task's own course either way.
  const courseId = input.courseId || ctx.courseId || null;

  // ── Who ────────────────────────────────────────────────────────────────
  const target = { whole_class: false, classroom_id: null, usernames: [], course_id: courseId };
  if (input.audience === "course") {
    if (!courseId) return { success: false, error: "Which course? Attach this task to a course, or name one." };
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

  // ── Plan ───────────────────────────────────────────────────────────────
  let plan = { subtopics: [], objectives: {} };
  try {
    const r = await callAsUser('/api/self-study/plan', { ...as, body: { topic: input.topic, subject: input.subject } });
    plan = r?.data ?? plan;
  } catch (e) {
    // Without subtopics there is nothing for the learner's agent to work
    // through, so this is a real failure rather than something to paper over.
    return { success: false, error: `Could not draft a study plan for "${input.topic}": ${e.message}` };
  }
  if (!plan.subtopics?.length) {
    return { success: false, error: `The plan for "${input.topic}" came back empty — try a more specific topic.` };
  }

  // ── Assign ─────────────────────────────────────────────────────────────
  let created;
  try {
    created = await callAsUser('/api/self-study', {
      ...as,
      body: {
        title:        input.title || `${input.topic} — self study`,
        subject:      input.subject,
        topic:        input.topic,
        subtopics:    plan.subtopics,
        objectives:   plan.objectives ?? {},
        instructions: input.instructions ?? null,
        difficulty:   input.difficulty,
        due_at:       input.dueAt ?? null,
        ...target,
      },
    });
  } catch (e) {
    return { success: false, error: e.message };
  }

  const d = created?.data ?? {};

  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType: "self_study",
    content: {
      type:         "self_study",
      assignmentId: d.id,
      title:        d.title,
      subject:      d.subject,
      topic:        d.topic,
      subtopics:    plan.subtopics,
      objectives:   plan.objectives ?? {},
      assigned:     d.assigned ?? 0,
      dueAt:        input.dueAt ?? null,
      // Say it plainly: nobody reviewed this plan before it went out.
      note: "Drafted and assigned automatically — review it on the Self Study page and edit if needed.",
    },
    delivered: false,
  });

  return {
    success:      true,
    assignmentId: d.id,
    title:        d.title,
    assigned:     d.assigned ?? 0,
    subtopics:    plan.subtopics.length,
    note:         "The AI's plan was assigned without review — it can be edited on the Self Study page.",
  };
}
