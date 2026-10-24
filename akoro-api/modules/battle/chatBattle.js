/**
 * battle/chatBattle.js — a learner's class or course battle, from chat.
 *
 * The Battles form lets a learner battle classmates in one of their classes
 * or courses; the agent network tools (challenge_agent, post_challenge_request)
 * cover everyone else. This is the form's path for chat: the same invite
 * route, run in-process as the learner (battle/series.js callRoute), so the
 * class checks, questions, notifications, scheduling and `repeat` (a
 * recurring series) are the ones the form gets.
 */
import db from "../../db.js";
import { callRoute } from "./series.js";

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** PURE: the one place among `options` the learner named (by id, or a name that matches). → option | null | "ambiguous" */
export function pickPlace(options, { id = null, name = null } = {}) {
  if (id) return options.find((o) => o.id === id) || null;
  if (!name) return options.length === 1 ? options[0] : null;
  const n = norm(name);
  const exact = options.filter((o) => norm(o.name) === n);
  if (exact.length === 1) return exact[0];
  const near = options.filter((o) => norm(o.name).includes(n) || n.includes(norm(o.name)));
  return near.length === 1 ? near[0] : near.length > 1 ? "ambiguous" : null;
}

/** The learner's classes and courses. → { classes: [{id,name}], courses: [{id,name}] } */
export async function placesOf(userId) {
  const [{ data: rooms }, { data: enr }] = await Promise.all([
    db.from("classroom_students").select("classroom_id, classrooms(id, name)").eq("user_id", userId).eq("status", "active").limit(30),
    db.from("enrollments").select("course_id, courses(id, title)").eq("user_id", userId).eq("status", "active").limit(50),
  ]);
  return {
    classes: (rooms || []).map((r) => r.classrooms).filter(Boolean).map((c) => ({ id: c.id, name: c.name })),
    courses: (enr || []).map((r) => r.courses).filter(Boolean).map((c) => ({ id: c.id, name: c.title })),
  };
}

/**
 * Create it. input: { class_name | classroom_id | course_name | course_id, opponents[], whole_class,
 * subject, topic, difficulty, total_questions, hp_per_miss, min_xp, scheduled_for, repeat, title }
 * → the invite route's data ({ battle_id … } or, recurring, { series_id, next_at … })
 */
export async function classBattleFromChat(userId, input = {}) {
  const { classes, courses } = await placesOf(userId);
  const wantsCourse = !!(input.course_id || input.course_name);
  const list = wantsCourse ? courses : classes;
  const place = pickPlace(list, wantsCourse ? { id: input.course_id, name: input.course_name } : { id: input.classroom_id, name: input.class_name });
  if (!place || place === "ambiguous") {
    const names = list.map((o) => o.name).slice(0, 8).join(", ");
    if (!list.length) throw fail(wantsCourse ? "You aren't enrolled in any course yet." : "You aren't in a class yet. To battle agents across Akoro, use a network challenge instead.");
    throw fail(`Which ${wantsCourse ? "course" : "class"}? Yours: ${names}.`);
  }
  if (!input.subject && !wantsCourse) throw fail("Which subject? A class battle draws its questions from one.");
  const opponents = (Array.isArray(input.opponents) ? input.opponents : []).map((u) => String(u).trim().replace(/^@/, "")).filter(Boolean);
  if (!opponents.length && !input.whole_class) throw fail("Who should it be against? Name classmates, or say the whole class.");

  const { occurrenceHandlers } = await import("./routes.js");
  const subject = input.subject || null;
  const body = {
    title: String(input.title || `${subject || place.name}${input.topic ? ` — ${input.topic}` : ""} battle`).slice(0, 120),
    subject, topic: input.topic || null,
    difficulty: ["easy", "intermediate", "hard"].includes(input.difficulty) ? input.difficulty : "intermediate",
    total_questions: Math.min(30, Math.max(5, Math.round(Number(input.total_questions) || 10))),
    hp_per_miss: input.hp_per_miss, min_xp: input.min_xp,
    usernames: opponents, whole_class: !!input.whole_class && !wantsCourse,
    ...(wantsCourse && input.whole_class ? { whole_class: true } : {}),
    scheduled_for: input.repeat ? null : input.scheduled_for || null,
    ...(input.repeat ? { repeat: input.repeat } : {}),
    question_source: "auto",
  };
  const out = await callRoute(wantsCourse ? occurrenceHandlers.courseInvite : occurrenceHandlers.classInvite, {
    user: { id: userId, role: "student" },
    params: wantsCourse ? { courseId: place.id } : { classroomId: place.id },
    body, app: { get: () => global.io },
  });
  if (out.status >= 400) throw fail(out.body?.error || `could not create it (${out.status})`, out.status);
  return { ...(out.body?.data || {}), place: { kind: wantsCourse ? "course" : "class", name: place.name } };
}
