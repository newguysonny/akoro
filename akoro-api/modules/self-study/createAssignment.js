/**
 * modules/self-study/createAssignment.js — the ONE creation path.
 *
 * Everything that turns an activity brief into assigned, notified work lives
 * here: validation, audience resolution (resolveStudents), the assignment
 * insert, per-learner targets, notifications and the live socket ding.
 *
 * Two callers, one code path:
 *   • POST /api/self-study          (the activities workbench form)
 *   • POST /api/self-study/drafts/:id/assign   (the AI draft approval)
 *
 * An AI agent may PREPARE a draft, but only this module — invoked by a human
 * action on a verified session — ever assigns work to learners.
 */

import db from "../../db.js";
import { agentDeps } from "../../lib/agentDeps.js";
import { cleanPaperDetails } from "./paperLayout.js";

// The persona is installed at boot (lib/agentDeps.js) and built on first use,
// so this module no longer imports adaptive-learning's guide directly.
let nanaInstance = null;
const nanaPersona = () => (nanaInstance ||= new (agentDeps().NaNaEsumai)());
export const nana = new Proxy({}, {
  get(_target, property) {
    const value = nanaPersona()[property];
    return typeof value === "function" ? value.bind(nanaPersona()) : value;
  },
});
export const edu = () => db.schema("edu");

/** The activity kinds the bench (and therefore this service) can assign. */
export const ACTIVITY_TYPES = Object.freeze(["self_study", "assignment", "project", "live_course", "multi_stage"]);

/** How an activity announces itself in a learner's notifications. */
export const ACTIVITY_ANNOUNCE = {
  self_study:  { emoji: "\u{1F4D6}", label: "Self study" },
  assignment:  { emoji: "\u270F\uFE0F",  label: "Assignment" },
  project:     { emoji: "\u{1F4C2}", label: "Project" },
  live_course: { emoji: "\u{1F4FA}", label: "Live course" },
  multi_stage: { emoji: "\u{1F9E9}", label: "Multi-stage activity" },
};
export const announceFor = (type) => ACTIVITY_ANNOUNCE[type] ?? ACTIVITY_ANNOUNCE.self_study;

/** A failed validation inside the service — routes map `.status` onto HTTP. */
export const invalid = (message, status = 400) => Object.assign(new Error(message), { status });

/** The school this user administers, if any. */
export async function mySchool(userId) {
  const { data } = await db.from("school_profiles")
    .select("id, name").eq("admin_user_id", userId).limit(1).maybeSingle();
  return data ?? null;
}

/**
 * resolveStudents — the one targeting rule the whole platform uses.
 *
 * Accepts any mix of usernames (or emails), user ids, or "everyone in the
 * class". Unknown handles are reported rather than silently dropped: a typo
 * that quietly assigns work to nobody is worse than an error.
 *
 * `course_id` and `classroom_id` describe WHERE the assignment lives; they
 * expand into a target list ONLY when whole_class is set. Treating their mere
 * presence as "target everyone" is a live footgun — the create form always
 * sends course_id as scope, so a teacher who picked two learners would have
 * silently assigned the work to the entire course.
 */
export async function resolveStudents({ usernames = [], user_ids = [], classroom_id, course_id, whole_class }) {
  const ids      = new Set((Array.isArray(user_ids) ? user_ids : []).filter(Boolean));
  const notFound = [];

  for (const raw of (Array.isArray(usernames) ? usernames : [])) {
    const handle = String(raw).trim().replace(/^@/, "");
    if (!handle) continue;
    const { data: found } = await db.from("users")
      .select("id").or(`username.ilike.${handle},email.ilike.${handle}`).limit(1);
    if (found?.length) ids.add(found[0].id);
    else notFound.push(handle);
  }

  // Only ever an explicit request, never inferred from scope.
  if (whole_class) {
    if (classroom_id) {
      const { data } = await db.from("classroom_students")
        .select("user_id").eq("classroom_id", classroom_id).eq("status", "active");
      for (const r of (data ?? [])) ids.add(r.user_id);
    } else if (course_id) {
      const { data } = await db.from("enrollments")
        .select("user_id").eq("course_id", course_id).eq("status", "active");
      for (const r of (data ?? [])) ids.add(r.user_id);
    }
  }

  return { ids: [...ids], notFound };
}

/**
 * notifyAll — best-effort notifications, in one insert.
 *
 * Deliberately try/catch rather than a trailing .catch(): the Supabase query
 * builder is a thenable WITHOUT a .catch method, so calling one on it throws
 * TypeError synchronously. A failed notification must never lose the
 * assignment it announces.
 */
export async function notifyAll(userIds, payload) {
  if (!userIds?.length) return;
  try {
    const { error } = await db.from("notifications")
      .insert(userIds.map((user_id) => ({ user_id, ...payload })));
    if (error) console.warn("[self-study] notify failed:", error.message);
  } catch (e) {
    console.warn("[self-study] notify threw:", e.message);
  }
}

/**
 * createAssignment — validate, resolve the audience, insert, target, notify,
 * ding. Throws `invalid()` errors with an HTTP status; returns
 * `{ assignment, assigned }` on success.
 *
 * `body` is the bench-shaped payload (the same shape the workbench form
 * posts): { type, title, subject, topic, subtopics?, objectives?,
 * instructions?, difficulty?, due_at?, course_id?, classroom_id?,
 * usernames?, user_ids?, whole_class?, details? }.
 */
export async function createAssignment(instructor, body) {
  const {
    title, subject, topic, subtopics = [], objectives = {},
    instructions = null, difficulty = "intermediate", due_at = null,
    course_id = null, classroom_id = null,
    usernames = [], user_ids = [], whole_class = false,
    type = "self_study", details = {},
  } = body || {};

  if (!title?.trim())   throw invalid("title is required");
  if (!ACTIVITY_TYPES.includes(type)) throw invalid(`Unknown activity type: ${type}`);
  if (!subject?.trim()) throw invalid("subject is required");
  if (!topic?.trim())   throw invalid("topic is required");

  const { ids, notFound } = await resolveStudents({ usernames, user_ids, classroom_id, course_id, whole_class });
  if (notFound.length) throw invalid(`No account found for: ${notFound.join(", ")}`);
  if (!ids.length)     throw invalid("Pick at least one learner to assign this to");

  const school = await mySchool(instructor.id);

  const { data: assignment, error } = await edu().from("self_study_assignments").insert({
    created_by:   instructor.id,
    school_id:    school?.id ?? null,
    course_id, classroom_id,
    title:        title.trim(),
    subject:      subject.trim(),
    topic:        topic.trim(),
    subtopics, objectives,
    instructions, difficulty,
    due_at, type,
    details: details && typeof details === "object" && !Array.isArray(details) ? cleanPaperDetails(details) : {},
  }).select().single();
  if (error) throw invalid(error.message, 500);

  const { error: tErr } = await edu().from("self_study_targets")
    .upsert(ids.map((student_id) => ({ assignment_id: assignment.id, student_id })),
            { onConflict: "assignment_id,student_id" });
  if (tErr) {
    // No learner list, no assignment: a half-made row would duplicate on retry.
    await edu().from("self_study_assignments").delete().eq("id", assignment.id).then(() => {}, () => {});
    throw invalid(tErr.message, 500);
  }

  const announce = announceFor(type);
  await notifyAll(ids, {
    type: "self_study_assigned",   // kept: learner notification handlers key on this string
    title: `${announce.emoji} ${announce.label}: ${assignment.title}`,
    content: `${assignment.subject} · ${assignment.topic}${due_at ? ` · due ${new Date(due_at).toLocaleDateString("en-GB")}` : ""}`,
    related_id: assignment.id,
    link: "/activities",           // tapping the bell item opens the Activity feed
  });
  for (const sid of ids) global.io?.to(`user:${sid}`).emit("self_study_assigned", { assignment });

  return { assignment, assigned: ids.length };
}
