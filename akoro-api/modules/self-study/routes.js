/**
 * modules/self-study/routes.js — AI Self Study
 *
 * A teacher or school assigns a topic; each learner works through it with their
 * own AI agent. The assignment is only the brief (subject, topic, subtopics,
 * objectives). The learning itself is an ordinary edu.adaptive_sessions row,
 * created per learner the first time they start — which is deliberate: the
 * Sessions list, knowledge confidence, decay and revision all already read
 * that table, so assigned work behaves like every other agent session instead
 * of being a parallel world.
 *
 * Mounted at /api/self-study.
 *
 * Teacher / school:
 *   POST   /plan               → AI drafts subtopics + objectives to review
 *   POST   /                   → create + assign (usernames | ids | whole class)
 *   GET    /                   → my assignments, with progress
 *   GET    /:id                → one assignment + per-learner status
 *   PATCH  /:id                → edit the brief
 *   POST   /:id/assign         → add more learners later
 *   DELETE /:id/targets/:sid   → unassign one learner
 *   DELETE /:id                → delete the assignment
 *
 * Learner:
 *   GET    /mine               → what I've been assigned
 *   POST   /:id/start          → mark started + get the brief (session is made by the WS)\n *   POST   /:id/link           → record which adaptive session it became
 */

import { Router }                         from "express";
import db                                 from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { NaNaEsumai }                     from "../adaptive-learning/agents/nana-esumai/guide.js";

const router = Router();
const nana   = new NaNaEsumai();
const edu    = () => db.schema("edu");
const now    = () => new Date().toISOString();

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok    = (res, data) => res.json({ success: true, data });
const bad   = (res, m) => res.status(400).json({ success: false, error: m });
const denied = (res, m) => res.status(403).json({ success: false, error: m });
const missing = (res, m) => res.status(404).json({ success: false, error: m });

// Matches modules/school/routes.js SCHOOL_ROLES plus instructors: the platform
// has used both "school" and "school_admin" over time, so accept both.
const TEACHER_ROLES = ["instructor", "teacher", "school", "school_admin", "admin"];

/** The school this user administers, if any. */
async function mySchool(userId) {
  const { data } = await db.from("school_profiles")
    .select("id, name").eq("admin_user_id", userId).limit(1).maybeSingle();
  return data ?? null;
}

/** Load an assignment the caller is allowed to manage. */
async function ownedAssignment(req, id) {
  const { data } = await edu().from("self_study_assignments").select("*").eq("id", id).maybeSingle();
  if (!data) return { error: "not_found" };
  if (data.created_by === req.user.id || req.user.role === "admin") return { assignment: data };
  const school = await mySchool(req.user.id);
  if (school && data.school_id === school.id) return { assignment: data };
  return { error: "forbidden" };
}

/**
 * resolveStudents — the one targeting rule the whole platform uses.
 *
 * Accepts any mix of usernames (or emails), user ids, a whole classroom, or a
 * whole course. Unknown handles are reported rather than silently dropped: a
 * typo that quietly assigns work to nobody is worse than an error.
 */
async function resolveStudents({ usernames = [], user_ids = [], classroom_id, course_id, whole_class }) {
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

  if (whole_class || classroom_id || course_id) {
    if (classroom_id) {
      const { data } = await db.from("classroom_students")
        .select("user_id").eq("classroom_id", classroom_id).eq("status", "active");
      for (const r of (data ?? [])) ids.add(r.user_id);
    }
    if (course_id) {
      const { data } = await db.from("enrollments")
        .select("user_id").eq("course_id", course_id).eq("status", "active");
      for (const r of (data ?? [])) ids.add(r.user_id);
    }
  }

  return { ids: [...ids], notFound };
}

router.use(authenticateToken);

/* ═══════════════════════════ TEACHER / SCHOOL ═══════════════════════════ */

/**
 * POST /api/self-study/plan
 * Draft the subtopics and objectives for a topic so the teacher can review and
 * edit them before assigning. Same generator the learner-led flow uses, so an
 * assigned session is configured exactly like a self-started one.
 */
router.post("/plan", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const { topic, subject } = req.body;
  if (!topic?.trim() || !subject?.trim()) return bad(res, "topic and subject are required");

  const subtopics = await nana.generateSubtopics(topic, subject);
  const lists = await Promise.all(subtopics.map((st) => nana.generateObjectives(st, topic, subject)));
  const objectives = {};
  subtopics.forEach((st, i) => { objectives[st] = lists[i]; });

  ok(res, { topic, subject, subtopics, objectives });
}));

/** POST /api/self-study — create the brief and assign it. */
router.post("/", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const {
    title, subject, topic, subtopics = [], objectives = {},
    instructions = null, difficulty = "intermediate", due_at = null,
    course_id = null, classroom_id = null,
    usernames = [], user_ids = [], whole_class = false,
  } = req.body;

  if (!title?.trim())   return bad(res, "title is required");
  if (!subject?.trim()) return bad(res, "subject is required");
  if (!topic?.trim())   return bad(res, "topic is required");

  const { ids, notFound } = await resolveStudents({ usernames, user_ids, classroom_id, course_id, whole_class });
  if (notFound.length) return bad(res, `No account found for: ${notFound.join(", ")}`);
  if (!ids.length)     return bad(res, "Pick at least one learner to assign this to");

  const school = await mySchool(req.user.id);

  const { data: assignment, error } = await edu().from("self_study_assignments").insert({
    created_by:   req.user.id,
    school_id:    school?.id ?? null,
    course_id, classroom_id,
    title:        title.trim(),
    subject:      subject.trim(),
    topic:        topic.trim(),
    subtopics, objectives,
    instructions, difficulty,
    due_at,
  }).select().single();
  if (error) throw new Error(error.message);

  const { error: tErr } = await edu().from("self_study_targets")
    .upsert(ids.map((student_id) => ({ assignment_id: assignment.id, student_id })),
            { onConflict: "assignment_id,student_id" });
  if (tErr) throw new Error(tErr.message);

  for (const sid of ids) {
    await db.from("notifications").insert({
      user_id: sid, type: "self_study_assigned",
      title:   `📖 Self study: ${assignment.title}`,
      content: `${assignment.subject} · ${assignment.topic}${due_at ? ` · due ${new Date(due_at).toLocaleDateString("en-GB")}` : ""}`,
      related_id: assignment.id,
    }).catch(() => {});
    global.io?.to(`user:${sid}`).emit("self_study_assigned", { assignment });
  }

  res.status(201).json({ success: true, data: { ...assignment, assigned: ids.length } });
}));

/** GET /api/self-study — assignments I created (or my school's), with progress. */
router.get("/", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const school = await mySchool(req.user.id);

  let q = edu().from("self_study_assignments").select("*").order("created_at", { ascending: false }).limit(100);
  q = school ? q.or(`created_by.eq.${req.user.id},school_id.eq.${school.id}`) : q.eq("created_by", req.user.id);

  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);

  const ids = (rows ?? []).map((r) => r.id);
  const { data: targets } = ids.length
    ? await edu().from("self_study_targets").select("assignment_id, status").in("assignment_id", ids)
    : { data: [] };

  const progress = {};
  for (const t of (targets ?? [])) {
    const p = progress[t.assignment_id] ??= { assigned: 0, started: 0, complete: 0 };
    p.assigned += 1;
    if (t.status === "started")  p.started  += 1;
    if (t.status === "complete") p.complete += 1;
  }

  ok(res, (rows ?? []).map((r) => ({ ...r, progress: progress[r.id] ?? { assigned: 0, started: 0, complete: 0 } })));
}));

/** GET /api/self-study/mine — what I, a learner, have been assigned. */
router.get("/mine", asyncHandler(async (req, res) => {
  const { data: targets } = await edu().from("self_study_targets")
    .select("*").eq("student_id", req.user.id).order("created_at", { ascending: false }).limit(60);

  const ids = [...new Set((targets ?? []).map((t) => t.assignment_id))];
  const { data: assignments } = ids.length
    ? await edu().from("self_study_assignments").select("*").in("id", ids)
    : { data: [] };
  const byId = new Map((assignments ?? []).map((a) => [a.id, a]));

  // Who set it — learners want to know it came from their teacher.
  const teacherIds = [...new Set((assignments ?? []).map((a) => a.created_by))];
  const { data: teachers } = teacherIds.length
    ? await db.from("users").select("id, full_name").in("id", teacherIds)
    : { data: [] };
  const teacherById = new Map((teachers ?? []).map((u) => [u.id, u.full_name]));

  ok(res, (targets ?? [])
    .filter((t) => byId.has(t.assignment_id) && byId.get(t.assignment_id).status !== "archived")
    .map((t) => {
      const a = byId.get(t.assignment_id);
      return {
        id:           a.id,
        targetId:     t.id,
        title:        a.title,
        subject:      a.subject,
        topic:        a.topic,
        subtopics:    a.subtopics ?? [],
        objectives:   a.objectives ?? {},
        instructions: a.instructions,
        difficulty:   a.difficulty,
        dueAt:        a.due_at,
        assignedBy:   teacherById.get(a.created_by) ?? null,
        status:       t.status,
        sessionId:    t.session_id,
        startedAt:    t.started_at,
        completedAt:  t.completed_at,
      };
    }));
}));

/** GET /api/self-study/:id — the brief plus every learner's state. */
router.get("/:id", asyncHandler(async (req, res) => {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");

  const { data: targets } = await edu().from("self_study_targets")
    .select("*").eq("assignment_id", assignment.id);

  const ids = (targets ?? []).map((t) => t.student_id);
  const { data: users } = ids.length
    ? await db.from("users").select("id, full_name, username, avatar_emoji").in("id", ids)
    : { data: [] };
  const byId = new Map((users ?? []).map((u) => [u.id, u]));

  ok(res, {
    ...assignment,
    targets: (targets ?? []).map((t) => ({
      ...t,
      full_name: byId.get(t.student_id)?.full_name ?? "Unknown",
      username:  byId.get(t.student_id)?.username ?? null,
      emoji:     byId.get(t.student_id)?.avatar_emoji ?? null,
    })),
  });
}));

/** PATCH /api/self-study/:id — edit the brief. */
router.patch("/:id", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");

  const allowed = ["title", "subject", "topic", "subtopics", "objectives", "instructions", "difficulty", "due_at", "status"];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(updates).length) return bad(res, "No editable fields provided");
  updates.updated_at = now();

  const { data, error: uErr } = await edu().from("self_study_assignments")
    .update(updates).eq("id", assignment.id).select().single();
  if (uErr) throw new Error(uErr.message);
  ok(res, data);
}));

/** POST /api/self-study/:id/assign — add more learners later. */
router.post("/:id/assign", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");

  const { ids, notFound } = await resolveStudents({ ...req.body, course_id: req.body.course_id ?? assignment.course_id });
  if (notFound.length) return bad(res, `No account found for: ${notFound.join(", ")}`);
  if (!ids.length)     return bad(res, "Pick at least one learner");

  const { error: tErr } = await edu().from("self_study_targets")
    .upsert(ids.map((student_id) => ({ assignment_id: assignment.id, student_id })),
            { onConflict: "assignment_id,student_id" });
  if (tErr) throw new Error(tErr.message);

  for (const sid of ids) {
    await db.from("notifications").insert({
      user_id: sid, type: "self_study_assigned",
      title: `📖 Self study: ${assignment.title}`,
      content: `${assignment.subject} · ${assignment.topic}`,
      related_id: assignment.id,
    }).catch(() => {});
  }
  ok(res, { assigned: ids.length });
}));

/** DELETE /api/self-study/:id/targets/:studentId — unassign one learner. */
router.delete("/:id/targets/:studentId", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");

  await edu().from("self_study_targets").delete()
    .eq("assignment_id", assignment.id).eq("student_id", req.params.studentId);
  ok(res, { unassigned: req.params.studentId });
}));

/**
 * DELETE /api/self-study/:id
 * Removes the assignment and its targets. Any adaptive sessions learners
 * already started are left alone — that work is theirs, and the FK is
 * ON DELETE SET NULL precisely so deleting the brief cannot destroy it.
 */
router.delete("/:id", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");

  const { error: dErr } = await edu().from("self_study_assignments").delete().eq("id", assignment.id);
  if (dErr) throw new Error(dErr.message);
  ok(res, { id: assignment.id, deleted: true });
}));

/* ═══════════════════════════════ LEARNER ═══════════════════════════════ */

/**
 * POST /api/self-study/:id/start
 *
 * Marks the learner's copy as started and hands back the brief. It deliberately
 * does NOT create the adaptive session: the teaching WebSocket
 * (start_adaptive_session) already creates one when the modal opens, and
 * creating a second here would leave an orphan row and a session id that points
 * at nothing. The client calls /link once the socket tells it the real id.
 */
router.post("/:id/start", asyncHandler(async (req, res) => {
  const { data: target } = await edu().from("self_study_targets")
    .select("*").eq("assignment_id", req.params.id).eq("student_id", req.user.id).maybeSingle();
  if (!target) return missing(res, "This assignment was not given to you");

  const { data: assignment } = await edu().from("self_study_assignments")
    .select("*").eq("id", req.params.id).maybeSingle();
  if (!assignment) return missing(res, "Assignment not found");

  if (target.status === "assigned") {
    await edu().from("self_study_targets")
      .update({ status: "started", started_at: now() }).eq("id", target.id);
  }

  ok(res, {
    assignment,
    target: { ...target, status: target.status === "assigned" ? "started" : target.status },
    // Present so the client can resume rather than start fresh.
    sessionId: target.session_id ?? null,
  });
}));

/**
 * POST /api/self-study/:id/link  { sessionId }
 * Records which adaptive session this learner's attempt actually became, so the
 * teacher's progress view can point at real work.
 */
router.post("/:id/link", asyncHandler(async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return bad(res, "sessionId is required");

  const { data: target } = await edu().from("self_study_targets")
    .select("id").eq("assignment_id", req.params.id).eq("student_id", req.user.id).maybeSingle();
  if (!target) return missing(res, "This assignment was not given to you");

  // Only link a session the learner owns — otherwise anyone could point their
  // assignment at somebody else's work.
  const { data: session } = await edu().from("adaptive_sessions")
    .select("id, student_id").eq("id", sessionId).maybeSingle();
  if (!session || session.student_id !== req.user.id) return denied(res, "Not your session");

  const { data, error } = await edu().from("self_study_targets")
    .update({ session_id: sessionId }).eq("id", target.id).select().single();
  if (error) throw new Error(error.message);
  ok(res, data);
}));

/**
 * POST /api/self-study/:id/complete
 * Marks the learner's copy done. The session itself is completed by the
 * teaching engine; this just closes the assignment side so the teacher's
 * progress column moves.
 */
router.post("/:id/complete", asyncHandler(async (req, res) => {
  const { data: target } = await edu().from("self_study_targets")
    .select("id").eq("assignment_id", req.params.id).eq("student_id", req.user.id).maybeSingle();
  if (!target) return missing(res, "This assignment was not given to you");

  const { data, error } = await edu().from("self_study_targets")
    .update({ status: "complete", completed_at: now() }).eq("id", target.id).select().single();
  if (error) throw new Error(error.message);
  ok(res, data);
}));

export default router;
