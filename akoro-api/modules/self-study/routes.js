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
 *   POST   /assignment-draft/questions → AI drafts the assignment's questions
 *                                       (points allocated, per-question level)
 *   POST   /assignment-draft/rubric    → AI drafts the marking rubric
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
 *   POST   /:id/files          → upload one submission attachment (base64, ≤5MB)
 *   POST   /:id/complete       → submit: status complete + the work itself
 *                                ({ text, answers, fileIds } — stored on the target)
 *   DELETE /files/:fileId      → remove one of my files (owner only)
 *   GET    /files/:fileId      → download a file (owning learner, or the
 *                                teacher/school that owns the activity)
 */

import { Router }                         from "express";
import db                                 from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { getStudentState }               from "../adaptive-learning/student-state.js";
import {
  nana, edu, ACTIVITY_TYPES, announceFor, mySchool,
  resolveStudents, notifyAll, createAssignment, invalid,
} from "./createAssignment.js";
import {
  createActivityDraft, assignActivityDraft, DRAFT_TYPES,
  listActivityDrafts, getActivityDraft, updateActivityDraft, discardActivityDraft,
} from "./drafts.js";
import {
  listRoutines, createRoutine, updateRoutine, deleteRoutine,
} from "./routines.js";
import { emitAutonomyEvent } from "../autonomy/triggers.js";

const router = Router();
const now    = () => new Date().toISOString();

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok    = (res, data) => res.json({ success: true, data });
const bad   = (res, m) => res.status(400).json({ success: false, error: m });
const denied = (res, m) => res.status(403).json({ success: false, error: m });
const missing = (res, m) => res.status(404).json({ success: false, error: m });

// Matches modules/school/routes.js SCHOOL_ROLES plus instructors: the platform
// has used both "school" and "school_admin" over time, so accept both.
const TEACHER_ROLES = ["instructor", "teacher", "school", "school_admin", "admin"];

/** Load an assignment the caller is allowed to manage. */
async function ownedAssignment(req, id) {
  const { data } = await edu().from("self_study_assignments").select("*").eq("id", id).maybeSingle();
  if (!data) return { error: "not_found" };
  if (data.created_by === req.user.id || req.user.role === "admin") return { assignment: data };
  const school = await mySchool(req.user.id);
  if (school && data.school_id === school.id) return { assignment: data };
  return { error: "forbidden" };
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

  const { subtopics } = await nana.generateSubtopics(topic, subject);
  const lists = await Promise.all(subtopics.map((st) => nana.generateObjectives(st, topic, subject)));
  const objectives = {};
  subtopics.forEach((st, i) => { objectives[st] = lists[i]; });

  ok(res, { topic, subject, subtopics, objectives });
}));

/* ═══ Assignment drafting — points, rubric and questions ═════════════════════
   The workbench's Assignment form exposes only the necessary fields
   (reference: assignment generation and creator.md): total points, the AI
   switches, the question types to use, and the rubric. Everything
   question-level — text, type, max_points, difficulty, cognitive level —
   is drafted HERE and handed back for review. Nothing is assigned by
   these routes; the instructor edits before anything is sent. */

router.post("/assignment-draft/questions", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const { topic, subject, total_points, question_types, difficulty, subtopics } = req.body;
  if (!topic?.trim() || !subject?.trim()) return bad(res, "topic and subject are required");
  const questions = await nana.generateAssignmentQuestions({
    topic:        topic.trim(),
    subject,
    totalPoints:  Number(total_points) || null,
    questionTypes: Array.isArray(question_types) ? question_types : null,
    difficulty:   typeof difficulty === "string" ? difficulty : null,
    subtopics:    Array.isArray(subtopics) ? subtopics : null,
  });
  ok(res, { questions });
}));

router.post("/assignment-draft/rubric", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const { topic, subject, total_points, question_types } = req.body;
  if (!topic?.trim() || !subject?.trim()) return bad(res, "topic and subject are required");
  const rubric = await nana.generateAssignmentRubric({
    topic:        topic.trim(),
    subject,
    totalPoints:  Number(total_points) || null,
    questionTypes: Array.isArray(question_types) ? question_types : null,
  });
  ok(res, { rubric });
}));

/* ═══ Draft routines — recurring, human-approved preparation ══════════════════
   The scheduler only PREPARES drafts at the slot; the instructor assigns each
   occurrence. Declared before /:id so "routines" is never an assignment id. */

/** GET /api/self-study/routines — my weekly routines. */
router.get("/routines", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  ok(res, { routines: await listRoutines(req.user) });
}));

/** POST /api/self-study/routines — schedule a recurring prepare. */
router.post("/routines", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  try { ok(res, { routine: await createRoutine(req.user, req.body) }); }
  catch (e) {
    if (e.status === 400 || e.message === "audience_required") return bad(res, e.message === "audience_required" ? "Say who each occurrence is for" : e.message);
    throw e;
  }
}));

/** PATCH /api/self-study/routines/:id — pause or resume. */
router.patch("/routines/:id", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  try { ok(res, { routine: await updateRoutine(req.user, req.params.id, req.body) }); }
  catch (e) {
    if (e.status === 404) return missing(res, e.message);
    if (e.status === 403) return denied(res, e.message);
    if (e.status === 400) return bad(res, e.message);
    throw e;
  }
}));

/** DELETE /api/self-study/routines/:id — cancel the routine. */
router.delete("/routines/:id", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  try { ok(res, await deleteRoutine(req.user, req.params.id)); }
  catch (e) {
    if (e.status === 404) return missing(res, e.message);
    if (e.status === 403) return denied(res, e.message);
    throw e;
  }
}));

/* ═══ AI activity drafts — human-in-the-loop ══════════════════════════════════
   The agent PREPARES (via the prepare_activity chat tool); only these
   endpoints — hit by the human's preview UI — can assign. Declared before
   the /:id routes so "drafts" is never read as an assignment id. */

/** GET /api/self-study/drafts — my pending drafts (chat reload + badges). */
router.get("/drafts", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  ok(res, { drafts: await listActivityDrafts(req.user) });
}));

/** GET /api/self-study/drafts/:id — one draft for the preview panel. */
router.get("/drafts/:id", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  try { ok(res, { draft: await getActivityDraft(req.user, req.params.id) }); }
  catch (e) { if (e.status === 404) return missing(res, e.message); if (e.status === 403) return denied(res, e.message); throw e; }
}));

/**
 * PATCH /api/self-study/drafts/:id — human edits before assign (the preview's
 * Edit flow), or the battle completion bookkeeping when the shared battle
 * form created the battle from this draft.
 */
router.patch("/drafts/:id", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  try { ok(res, { draft: await updateActivityDraft(req.user, req.params.id, req.body) }); }
  catch (e) {
    if (e.status === 404) return missing(res, e.message);
    if (e.status === 403) return denied(res, e.message);
    if (e.status === 409 || e.status === 400) return bad(res, e.message);
    throw e;
  }
}));

/**
 * POST /api/self-study/drafts/:id/assign — the approval. The only way an
 * AI-prepared activity reaches learners: replays the payload through the
 * same create path as the workbench (targets, notifications, live ding).
 * Body: optional human-edited overrides merged over the stored payload.
 */
router.post("/drafts/:id/assign", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  try {
    const { assignment, assigned } = await assignActivityDraft({ instructor: req.user, id: req.params.id, overrides: req.body });
    res.status(201).json({ success: true, data: { ...assignment, assigned } });
  } catch (e) {
    if (e.status === 404) return missing(res, e.message);
    if (e.status === 403) return denied(res, e.message);
    if (e.status === 409 || e.status === 400) return bad(res, e.message);
    throw e;
  }
}));

/** DELETE /api/self-study/drafts/:id — discard a pending draft. */
router.delete("/drafts/:id", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  try { ok(res, { draft: await discardActivityDraft(req.user, req.params.id) }); }
  catch (e) {
    if (e.status === 404) return missing(res, e.message);
    if (e.status === 403) return denied(res, e.message);
    if (e.status === 409) return bad(res, e.message);
    throw e;
  }
}));

/** POST /api/self-study — create the brief and assign it (the shared path). */
router.post("/", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const { assignment, assigned } = await createAssignment(req.user, req.body);
  res.status(201).json({ success: true, data: { ...assignment, assigned } });
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

  // ── Multi-stage journeys: sequential unlocking ──────────────────────────
  // A journey's stages complete IN ORDER. Stage state is derived, never
  // trusted from the client: a study stage is this learner's target status
  // on the child assignment; a battle stage is their participant row in a
  // finished battle. Stages with no resolvable ref are "open" — displayed
  // but never gating, so a legacy journey cannot dead-end its learners.
  const journeys = (assignments ?? []).filter((a) => (a.type ?? "self_study") === "multi_stage" && a.status !== "archived");
  const myTargetByAssignment = new Map((targets ?? []).map((t) => [t.assignment_id, t]));

  const journeyInfoById = new Map();   // child assignment id → { journey, position, total, locked }
  const journeyStateById = new Map();  // journey id → computed stage list

  for (const journey of journeys) {
    const refs = Array.isArray(journey.details?.stages) ? journey.details.stages : [];

    const battleIds = refs.map((r) => r.battleId).filter(Boolean);
    const { data: myBattleRows } = battleIds.length
      ? await db.from("battle_participants")
          .select("battle_id, joined_at").eq("user_id", req.user.id).in("battle_id", battleIds)
      : { data: [] };
    const { data: battleRows } = battleIds.length
      ? await db.from("battles").select("id, status").in("id", battleIds)
      : { data: [] };
    const myBattleBy = new Map((myBattleRows ?? []).map((r) => [r.battle_id, r]));
    const battleBy = new Map((battleRows ?? []).map((r) => [r.id, r]));

    const resolve = (ref) => {
      if (ref.kind === "battle") {
        if (!ref.battleId) return null;                     // legacy: battle id was not captured
        const me = myBattleBy.get(ref.battleId);
        if (!me) return "assigned";                         // invited, never joined
        return battleBy.get(ref.battleId)?.status === "completed" ? "complete" : "started";
      }
      if (!ref.refId) return null;                          // not tracked
      return myTargetByAssignment.get(ref.refId)?.status ?? null;
    };

    const resolved = refs.map(resolve);
    // The active stage is the FIRST resolvable, unfinished one — "open"
    // stages are skipped by the gate so they can never dead-end a journey.
    let activeIndex = resolved.findIndex((st) => st === "assigned" || st === "started");
    if (activeIndex === -1) activeIndex = refs.length;

    const stages = refs.map((ref, i) => ({
      title: ref.title ?? null,
      kind: ref.kind ?? null,
      emoji: ref.emoji ?? null,
      status: resolved[i] === null
        ? (i < activeIndex ? "passed" : i > activeIndex ? "locked" : "open")
        : i < activeIndex ? "complete" : i === activeIndex ? "active" : "locked",
    }));

    const doneCount = stages.filter((st) => st.status === "complete").length;
    const allDone = resolved.every((st, i) => st === "complete" || st === null);
    journeyStateById.set(journey.id, {
      stages,
      progress: { done: doneCount, total: refs.length },
      status: allDone && refs.length ? "complete" : (myTargetByAssignment.get(journey.id)?.status ?? "assigned"),
    });

    refs.forEach((ref, i) => {
      if (ref.refId) journeyInfoById.set(ref.refId, {
        journeyId: journey.id, journeyTitle: journey.title,
        position: i + 1, total: refs.length, locked: i > activeIndex,
      });
    });
  }

  ok(res, (targets ?? [])
    .filter((t) => byId.has(t.assignment_id) && byId.get(t.assignment_id).status !== "archived")
    .map((t) => {
      const a = byId.get(t.assignment_id);
      const isJourney = (a.type ?? "self_study") === "multi_stage";
      const jState = isJourney ? journeyStateById.get(a.id) : null;
      return {
        id:           a.id,
        targetId:     t.id,
        type:         a.type ?? "self_study",
        details:      a.details ?? {},
        title:        a.title,
        subject:      a.subject,
        topic:        a.topic,
        subtopics:    a.subtopics ?? [],
        objectives:   a.objectives ?? {},
        instructions: a.instructions,
        difficulty:   a.difficulty,
        dueAt:        a.due_at,
        assignedBy:   teacherById.get(a.created_by) ?? null,
        status:       jState?.status ?? t.status,
        grade:        t.grade ?? null,                       // published 0–100, null until graded
        graded:       t.grade != null,
        feedbackText: t.feedback?.text || null,
        // The work the learner turned in — text, per-question answers and
        // file metadata. Server copy wins once submitted.
        submission:   t.submission ?? null,
        sessionId:    t.session_id,
        startedAt:    t.started_at,
        completedAt:  t.completed_at,
        // The journey's roadmap with per-stage state — the learner surface
        // for sequential unlocking.
        ...(jState ? { stages: jState.stages, journeyProgress: jState.progress } : {}),
        // A child stage knows which journey it belongs to and whether its
        // turn has come. Locked stages are hidden by learner surfaces.
        ...(journeyInfoById.has(a.id) ? { journey: journeyInfoById.get(a.id) } : {}),
      };
    }));
}));

/**
 * classRows — per-learner analytics rows for one assignment.
 *
 * Joins each learner's progress (self_study_targets) with their agent's
 * live cognitive state (edu.student_states via getStudentState). Reads only;
 * never creates agents or states.
 */
async function classRows(assignment) {
  const { data: targets } = await edu().from("self_study_targets")
    .select("*").eq("assignment_id", assignment.id);
  const rows = targets ?? [];
  const ids = rows.map((t) => t.student_id);

  const { data: users } = ids.length
    ? await db.from("users").select("id, full_name, username, avatar_emoji").in("id", ids)
    : { data: [] };
  const { data: agents } = ids.length
    ? await edu().from("student_agents").select("id, student_id, knowledge_score, level").in("student_id", ids)
    : { data: [] };
  const userBy   = new Map((users ?? []).map((u) => [u.id, u]));
  const agentBy  = new Map((agents ?? []).map((a) => [a.student_id, a]));

  return Promise.all(rows.map(async (t) => {
    const u = userBy.get(t.student_id);
    const agent = agentBy.get(t.student_id);
    let cognitive = null;
    if (agent?.id) {
      const st = await getStudentState(agent.id);
      const c = st?.cognitive ?? {};
      cognitive = {
        understanding: Math.round((c.understanding ?? 0) * 100),
        confusion:     Math.round((c.confusion ?? 0) * 100),
        engagement:    Math.round((c.engagement ?? 0.5) * 100),
      };
    }
    return {
      student:     { id: t.student_id, name: u?.full_name ?? "Unknown", username: u?.username ?? null, emoji: u?.avatar_emoji || "🧑‍🎓" },
      status:      t.status,
      startedAt:   t.started_at,
      completedAt: t.completed_at,
      knowledgeScore: agent ? Math.round(Number(agent.knowledge_score ?? 0)) : null,
      agentLevel:     agent?.level ?? null,
      cognitive,
    };
  }));
}

/** GET /api/self-study/:id/analytics — class results for one activity, plus any saved AI report. */
router.get("/:id/analytics", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");

  const rows = await classRows(assignment);
  const avg  = (key) => {
    const vals = rows.map((r) => r.cognitive?.[key]).filter((v) => typeof v === "number");
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };

  ok(res, {
    assignment: {
      id: assignment.id, title: assignment.title, subject: assignment.subject,
      topic: assignment.topic, subtopics: assignment.subtopics ?? [],
      difficulty: assignment.difficulty, type: assignment.type ?? "self_study",
    },
    summary: {
      assigned: rows.length,
      started:  rows.filter((r) => r.status === "started").length,
      complete: rows.filter((r) => r.status === "complete").length,
      avgUnderstanding: avg("understanding"),
      avgConfusion:     avg("confusion"),
      avgEngagement:    avg("engagement"),
    },
    learners: rows,
    report: assignment.details?.ai_report ?? null,   // { report, generatedAt } when one was generated
  });
}));

/** POST /api/self-study/:id/report — generate (and save) the AI report for this activity. */
router.post("/:id/report", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");

  const rows = await classRows(assignment);
  if (!rows.length) return bad(res, "Assign it to at least one learner before asking for a report.");

  const report = await nana.classAnalytics({
    topic: assignment.topic, subject: assignment.subject,
    subtopics: assignment.subtopics ?? [], difficulty: assignment.difficulty,
    type: assignment.type ?? "self_study",
  }, rows.map((r) => ({
    name: (r.student.name || "Learner").split(" ")[0],   // first names only in the prompt
    status: r.status,
    understanding: r.cognitive?.understanding ?? null,
    confusion: r.cognitive?.confusion ?? null,
    engagement: r.cognitive?.engagement ?? null,
    knowledgeScore: r.knowledgeScore,
  })));

  const generatedAt = now();
  const details = { ...(assignment.details ?? {}), ai_report: { report, generatedAt } };
  const { error: uErr } = await edu().from("self_study_assignments")
    .update({ details, updated_at: generatedAt }).eq("id", assignment.id);
  if (uErr) throw new Error(uErr.message);

  ok(res, { report, generatedAt });
}));

/**
 * GET /api/self-study/streak — the learner's activity streak.
 *
 * Consecutive days ending today (or yesterday, so an early visit keeps a
 * streak alive) with at least one completed activity, derived from the
 * learner's own completion timestamps. No new state: it is computed from
 * what really happened, so it can never show a number the learner did not
 * earn. Registered before /:id so "streak" is never read as an id.
 */
router.get("/streak", asyncHandler(async (req, res) => {
  const { data: targets } = await edu().from("self_study_targets")
    .select("completed_at").eq("student_id", req.user.id);
  const days = new Set((targets ?? [])
    .filter((t) => t.completed_at)
    .map((t) => String(t.completed_at).slice(0, 10)));   // YYYY-MM-DD (UTC)

  const key = (d) => d.toISOString().slice(0, 10);
  const cursor = new Date();
  if (!days.has(key(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);   // grace: yesterday counts

  let streak = 0;
  while (days.has(key(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  ok(res, { streak });
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

  // Submission attachments (metadata only — never the base64 payload).
  const targetIds = (targets ?? []).map((t) => t.id);
  const { data: fileRows } = targetIds.length
    ? await edu().from("self_study_files")
        .select("id, target_id, name, size, mime, created_at").in("target_id", targetIds)
    : { data: [] };
  const filesByTarget = new Map();
  for (const f of (fileRows ?? [])) {
    (filesByTarget.get(f.target_id) ?? filesByTarget.set(f.target_id, []).get(f.target_id)).push(f);
  }

  ok(res, {
    ...assignment,
    targets: (targets ?? []).map((t) => ({
      ...t,
      full_name: byId.get(t.student_id)?.full_name ?? "Unknown",
      username:  byId.get(t.student_id)?.username ?? null,
      emoji:     byId.get(t.student_id)?.avatar_emoji ?? null,
      files:     filesByTarget.get(t.id) ?? [],
    })),
  });
}));

/** PATCH /api/self-study/:id — edit the brief. */
router.patch("/:id", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");

  const allowed = ["title", "subject", "topic", "subtopics", "objectives", "instructions", "difficulty", "due_at", "status", "type", "details"];
  if (req.body.type && !ACTIVITY_TYPES.includes(req.body.type)) return bad(res, `Unknown activity type: ${req.body.type}`);
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

  const { ids, notFound } = await resolveStudents({
    usernames:    req.body.usernames,
    user_ids:     req.body.user_ids,
    whole_class:  req.body.whole_class,
    classroom_id: req.body.classroom_id ?? assignment.classroom_id,
    course_id:    req.body.course_id    ?? assignment.course_id,
  });
  if (notFound.length) return bad(res, `No account found for: ${notFound.join(", ")}`);
  if (!ids.length)     return bad(res, "Pick at least one learner");

  const { error: tErr } = await edu().from("self_study_targets")
    .upsert(ids.map((student_id) => ({ assignment_id: assignment.id, student_id })),
            { onConflict: "assignment_id,student_id" });
  if (tErr) throw new Error(tErr.message);

  const announce = announceFor(assignment.type);
  await notifyAll(ids, {
    type: "self_study_assigned",   // kept: learner notification handlers key on this string
    title: `${announce.emoji} ${announce.label}: ${assignment.title}`,
    content: `${assignment.subject} · ${assignment.topic}`,
    related_id: assignment.id,
    link: "/activities",           // tapping the bell item opens the Activity feed
  });
  // The real-time "ding": same event the create path emits, so work added to
  // an assignment later is announced exactly like new work.
  for (const sid of ids) global.io?.to(`user:${sid}`).emit("self_study_assigned", { assignment });
  ok(res, { assigned: ids.length });
}));

/** DELETE /api/self-study/:id/targets/:studentId — unassign one learner. */
/**
 * PATCH /api/self-study/:id/targets/:studentId/grade — publish a grade.
 *
 * The workbench autosaves drafts locally (they never touch the server);
 * this is the deliberate PUBLISH: the number becomes the learner's grade,
 * the feedback (text + rubric levels) travels with it, the learner is
 * notified, and their gradebook files the work under "Graded activity".
 * Republishing overwrites — the latest deliberate grade wins.
 */
router.patch("/:id/targets/:studentId/grade", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");

  const studentId = req.params.studentId;
  const { grade, feedback = {} } = req.body;
  const n = Number(grade);
  if (!Number.isFinite(n) || n < 0 || n > 100) return bad(res, "grade must be a number from 0 to 100");
  if (feedback && typeof feedback !== "object") return bad(res, "feedback must be an object");

  const { data: target, error: tErr } = await edu().from("self_study_targets")
    .update({
      grade: Math.round(n),
      feedback: {
        text: typeof feedback.text === "string" ? feedback.text.slice(0, 4000) : "",
        rubric: Array.isArray(feedback.rubric) ? feedback.rubric.slice(0, 12) : [],
        mode: feedback.mode === "manual" ? "manual" : "rubric",
      },
      graded_at: now(),
      graded_by: req.user.id,
    })
    .eq("assignment_id", assignment.id).eq("student_id", studentId)
    .select().single();
  if (tErr || !target) return missing(res, "That learner is not assigned this activity");

  await notifyAll([studentId], {
    type: "activity_graded",
    title: `📋 Graded: ${assignment.title}`,
    content: `Your score: ${Math.round(n)}%${feedback.text ? " · feedback waiting" : ""}`,
    related_id: assignment.id,
    link: "/activities",
  });
  global.io?.to(`user:${studentId}`).emit("activity_graded", { assignmentId: assignment.id, grade: Math.round(n) });

  ok(res, { grade: target.grade, graded_at: target.graded_at });
}));

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

/* ═════════════════════════ SUBMISSION FILES ═════════════════════════
   Attachments a learner uploads BEFORE completing — the work behind the
   submission. Stored as base64 beside their target row; capped at 5MB and
   5 files per target so rows stay small. Teachers reach them through the
   activity they own; the learner through their own target. */

/** The caller's target row for one assignment (learners). */
async function myTargetOf(assignmentId, userId) {
  const { data } = await edu().from("self_study_targets")
    .select("id, status").eq("assignment_id", assignmentId).eq("student_id", userId).maybeSingle();
  return data ?? null;
}

/** POST /api/self-study/:id/files — learner uploads one attachment. */
router.post("/:id/files", asyncHandler(async (req, res) => {
  const target = await myTargetOf(req.params.id, req.user.id);
  if (!target) return missing(res, "This assignment was not given to you");

  const { name, mime, size, data } = req.body ?? {};
  const clean = typeof name === "string" ? name.trim().slice(0, 200) : "";
  if (!clean) return bad(res, "A file needs a name");
  const n = Number(size);
  if (!Number.isFinite(n) || n < 0) return bad(res, "File size is required");
  if (n > 5 * 1024 * 1024) return bad(res, "Files can be at most 5MB");
  if (typeof data !== "string" || !data) return bad(res, "File data is required (base64)");
  // base64 inflates by ~4/3 — reject early so an oversized row never lands
  if (data.length > Math.ceil(5 * 1024 * 1024 * 1.4)) return bad(res, "Files can be at most 5MB");
  const cleanMime = typeof mime === "string" ? mime.slice(0, 120) : null;

  const { count } = await edu().from("self_study_files")
    .select("id", { count: "exact", head: true }).eq("target_id", target.id);
  if ((count ?? 0) >= 5) return bad(res, "At most 5 files per submission");

  const { data: file, error } = await edu().from("self_study_files")
    .insert({ target_id: target.id, name: clean, mime: cleanMime, size: Math.round(n), data })
    .select("id, name, size, mime").single();
  if (error) throw new Error(error.message);
  ok(res, file);
}));

/** DELETE /api/self-study/files/:fileId — the owning learner removes a file.
 *  Only before submitting: once the target is complete the submission is the
 *  record the teacher grades, so it stays exactly as handed in. */
router.delete("/files/:fileId", asyncHandler(async (req, res) => {
  const { data: file } = await edu().from("self_study_files")
    .select("id, target_id").eq("id", req.params.fileId).maybeSingle();
  if (!file) return missing(res, "File not found");
  const { data: t } = await edu().from("self_study_targets")
    .select("student_id, status").eq("id", file.target_id).maybeSingle();
  if (!t || t.student_id !== req.user.id) return denied(res, "Not your file");
  if (t.status === "complete") return bad(res, "Already submitted — the teacher needs to see this file");
  await edu().from("self_study_files").delete().eq("id", file.id);
  ok(res, { removed: true });
}));

/** GET /api/self-study/files/:fileId — download: owning learner, or the
 *  teacher/school that owns the activity (the grading workspace). */
router.get("/files/:fileId", asyncHandler(async (req, res) => {
  const { data: file } = await edu().from("self_study_files")
    .select("*").eq("id", req.params.fileId).maybeSingle();
  if (!file) return missing(res, "File not found");
  const { data: t } = await edu().from("self_study_targets")
    .select("assignment_id, student_id").eq("id", file.target_id).maybeSingle();
  if (!t) return missing(res, "File not found");

  let allowed = t.student_id === req.user.id;
  if (!allowed && TEACHER_ROLES.includes(req.user.role)) {
    const { error } = await ownedAssignment(req, t.assignment_id);
    allowed = !error;
  }
  if (!allowed) return denied(res, "Not your file");

  res.setHeader("Content-Type", file.mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.name)}"`);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(Buffer.from(file.data, "base64"));
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

  // ── The work itself: optional free text, per-question answers (keyed by
  //    question index), and the files uploaded for this target. Everything
  //    is capped so the row stays small. Backward compatible — completing
  //    with no body still works and stores an empty submission.
  const body = req.body ?? {};
  const text = typeof body.text === "string" ? body.text.slice(0, 8000) : "";
  const answers = {};
  if (body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)) {
    for (const [k, v] of Object.entries(body.answers).slice(0, 60)) {
      answers[String(k).slice(0, 8)] = typeof v === "number" ? v : String(v ?? "").slice(0, 4000);
    }
  }
  let files = [];
  if (Array.isArray(body.fileIds) && body.fileIds.length) {
    const ids = [...new Set(body.fileIds.map(String))].slice(0, 5);
    const { data: rows } = await edu().from("self_study_files")
      .select("id, name, size, mime").eq("target_id", target.id).in("id", ids);
    files = rows ?? [];
  }
  const submission = { text, answers, files, submittedAt: now() };

  const { data, error } = await edu().from("self_study_targets")
    .update({ status: "complete", completed_at: now(), submission })
    .eq("id", target.id).select().single();
  if (error) throw new Error(error.message);
  // Event trigger: study work completed — fresh signal for the planner.
  emitAutonomyEvent(req.user.id, "self_study").catch(() => {});
  ok(res, data);
}));

export default router;
