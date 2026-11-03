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
 *   PUT    /:id/draft/:index   → submit ONE question's answer (saved on the server;
 *                                the assignment is handed in from the review step)
 *   POST   /:id/files          → upload one submission attachment (base64, ≤5MB;
 *                                PDF / JPEG / PNG / .docx / text, sniffed) — kept
 *                                in object storage under the learner's prefix
 *   POST   /:id/complete       → submit: status complete + the work itself
 *                                ({ text, answers, fileIds } — stored on the target);
 *                                the submission PDF + markdown are built after it.
 *                                Refused once graded.
 *   DELETE /files/:fileId      → remove one of my files (owner only)
 *   GET    /files/:fileId      → open a file (owning learner, or the
 *                                teacher/school that owns the activity)
 *
 * Teacher / school, grading:
 *   PUT    /:id/targets/:sid/markup   → save the marks on the submission PDF
 *   POST   /:id/targets/:sid/ai-grade → draft marks with AI (for approval)
 *
 * Both:
 *   GET    /targets/:targetId/submission.pdf → the whole submission as one PDF
 *   GET    /targets/:targetId/submission.md  → the same as markdown (AI grading)
 *   GET    /targets/:targetId/submission.json → the same as the paper template's data
 *   GET    /targets/:targetId/marked.pdf     → the marked copy (learner: once
 *                                              graded; teacher: any time, as a preview)
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
  saveDraftVersion, retryDraftVersion, restoreDraftHistory, classroomName, prepareReviewQuestions,
  setAssignmentSettings, generateVersionRubric, saveVersionRubric,
} from "./drafts.js";
import { rubricView } from "./markScheme.js";
import {
  listRoutines, createRoutine, updateRoutine, deleteRoutine,
} from "./routines.js";
import { emitAutonomyEvent } from "../autonomy/triggers.js";
import {
  SUBMISSION_FILE_LIMITS, sniffSubmissionFile, storeSubmissionFile, readSubmissionFile, isDrawingName, cropDrawing,
  removeSubmissionObject, contentDisposition,
} from "./submissionFiles.js";
import { answerFormatOf, fileRefusal, typedRefusal } from "./answerFormat.js";
import {
  buildSubmissionArtifacts, readSubmissionArtifact, loadSubmissionDocument, buildMarkedCopyLater, readMarkedCopy, aiGradeTarget,
} from "./submissionArtifacts.js";
import { validateMarks } from "./submissionMarkup.js";
import { briefForLearner, pdfMeta, cleanAnswer, cleanQuestionMarks } from "./submissionView.js";
import { cleanPaperDetails } from "./paperLayout.js";
import { draftPaper, parseQuestionRequest, summarizePaper } from "./questionPaper.js";
import { assignmentPaperHtml, submissionPaperHtml } from "./paperRender.js";
import { versionAt, latestReady } from "./draftVersions.js";



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
  const { topic, subject, total_points, question_types, difficulty, subtopics, request, class_level } = req.body;
  if (!topic?.trim() || !subject?.trim()) return bad(res, "topic and subject are required");
  // The teacher's own words drive the paper ("5 questions, 3 MCQ, 2 theory,
  // one with a diagram"); the workbench's ticked types and total fill in
  // what the words leave open.
  const types = Array.isArray(question_types) ? question_types.filter((t) => typeof t === "string").slice(0, 8) : [];
  const words = typeof request === "string" ? request.slice(0, 1500) : "";
  const fallback = parseQuestionRequest(words).mix.length || !types.length ? "" : ` Use only these question types: ${types.join(", ")}.`;
  try {
    const { paper, warning } = await draftPaper({
      chat: (messages, opts = {}) => nana.generateAssignmentQuestions({ messages, ...opts, billing: { __userId: req.user.id, __feature: "assignment_questions" } }),
      topic: topic.trim(), subject: String(subject).trim(),
      classLevel: typeof class_level === "string" ? class_level.slice(0, 60) : null,
      request: (words + fallback).trim(),
      plan: Number(total_points) > 0 && !parseQuestionRequest(words).totalPoints ? { total_points: Number(total_points) } : null,
      difficulty: typeof difficulty === "string" ? difficulty : null,
      subtopics: Array.isArray(subtopics) ? subtopics.filter((x) => typeof x === "string") : null,
    });
    ok(res, { ...paper, warning, summary: summarizePaper(paper) });
  } catch (e) {
    return bad(res, e.message || "Could not draft the questions.");
  }
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
  try {
    const draft = await getActivityDraft(req.user, req.params.id);
    // Drafts made before the class name was recorded: look it up for the preview.
    if (draft.audience?.classroom_id && !draft.audience.class_name) {
      draft.audience = { ...draft.audience, class_name: await classroomName(draft.audience.classroom_id) };
    }
    // Each version's rubric as the preview reads it: status, the scheme, and whether the questions moved on since.
    const versions = Array.isArray(draft.payload?.versions) ? draft.payload.versions.map((v) => (v.rubric ? { ...v, rubric: rubricView(v) } : v)) : null;
    ok(res, { draft: versions ? { ...draft, payload: { ...draft.payload, versions } } : draft });
  }
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
    const out = await assignActivityDraft({ instructor: req.user, id: req.params.id, overrides: req.body });
    // A teaching resource is saved, not assigned: the Library row's id lets chat link to it.
    if (out.saved) return res.status(201).json({ success: true, data: { saved: true, ...out.saved } });
    const { assignment, assigned } = out;
    res.status(201).json({ success: true, data: { ...assignment, assigned } });
  } catch (e) {
    if (e.status === 404) return missing(res, e.message);
    if (e.status === 403) return denied(res, e.message);
    if (e.status === 409 || e.status === 400) return bad(res, e.message);
    throw e;
  }
}));

/* An assignment draft's question versions (V1, V2… — draftVersions.js). */
const draftError = (res, e) => {
  if (e.status === 404) return missing(res, e.message);
  if (e.status === 403) return denied(res, e.message);
  if ([400, 409].includes(e.status)) return bad(res, e.message);
  throw e;
};

/** PUT /api/self-study/drafts/:id/versions/:n — the teacher's edits to one version (saved in place, marked edited). */
router.put("/drafts/:id/versions/:n", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  try { ok(res, { version: await saveDraftVersion(req.user, req.params.id, req.params.n, req.body) }); }
  catch (e) { return draftError(res, e); }
}));

/** PUT /api/self-study/drafts/:id/settings { ai_auto_grade?, answer_format?, version? } — an assignment's grading settings. */
router.put("/drafts/:id/settings", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  try { ok(res, await setAssignmentSettings(req.user, req.params.id, req.body)); }
  catch (e) { return draftError(res, e); }
}));

/** POST /api/self-study/drafts/:id/versions/:n/rubric { request? } — write a version's rubric, or improve it as asked. */
router.post("/drafts/:id/versions/:n/rubric", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  try { ok(res, await generateVersionRubric(req.user, req.params.id, req.params.n, { request: req.body?.request })); }
  catch (e) { return draftError(res, e); }
}));

/** PUT /api/self-study/drafts/:id/versions/:n/rubric { scheme } — the teacher's edits to a version's rubric. */
router.put("/drafts/:id/versions/:n/rubric", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  try { ok(res, { rubric: rubricView({ rubric: await saveVersionRubric(req.user, req.params.id, req.params.n, req.body?.scheme), paper: null }) }); }
  catch (e) { return draftError(res, e); }
}));

/** POST /api/self-study/drafts/:id/versions/:n/retry — draft a failed version again. */
router.post("/drafts/:id/versions/:n/retry", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  try { ok(res, { version: await retryDraftVersion(req.user, req.params.id, req.params.n) }); }
  catch (e) { return draftError(res, e); }
}));

/** POST /api/self-study/drafts/:id/review-questions { count } — write the review battle's questions for this draft. */
router.post("/drafts/:id/review-questions", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  try { ok(res, { review_questions: await prepareReviewQuestions(req.user, req.params.id, req.body?.count) }); }
  catch (e) { return draftError(res, e); }
}));

/** POST /api/self-study/drafts/:id/history/:n/restore — go back to one round of a non-assignment draft. */
router.post("/drafts/:id/history/:n/restore", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  try { ok(res, { draft: await restoreDraftHistory(req.user, req.params.id, req.params.n) }); }
  catch (e) { return draftError(res, e); }
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
  const openTargets = (targets ?? []).filter((t) => t.status !== "complete").map((t) => t.id);
  const { data: openFiles } = openTargets.length
    ? await edu().from("self_study_files").select("id, target_id, name, size, mime, kind, question_index").in("target_id", openTargets).order("created_at", { ascending: true }).limit(500)
    : { data: [] };
  const draftFilesBy = new Map();
  for (const f of openFiles ?? []) {
    const list = draftFilesBy.get(f.target_id) || [];
    list.push({ id: f.id, name: f.name, size: f.size, mime: f.mime, kind: f.kind, ...(Number.isInteger(f.question_index) ? { question: f.question_index } : {}) });
    draftFilesBy.set(f.target_id, list);
  }
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
        details:      briefForLearner(a.details, t.grade != null),
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
        // Once graded: the rubric levels behind the score, and the marked copy.
        feedbackRubric: t.grade != null && Array.isArray(t.feedback?.rubric) ? t.feedback.rubric : [],
        feedbackQuestions: t.grade != null && Array.isArray(t.feedback?.questions) ? t.feedback.questions : [],
        // Answers submitted question by question, not yet handed in.
        draft:        t.draft?.answers ? { answers: t.draft.answers, savedAt: t.draft.savedAt ?? null } : null,
        // Files uploaded but not handed in yet — each with its question, so
        // the work follows the learner to another device.
        draftFiles:   t.status !== "complete" ? (draftFilesBy.get(t.id) || []) : [],
        markedPdf:    t.grade != null && !!t.submission?.submittedAt,
        // The work the learner turned in — text, per-question answers and
        // file metadata. Server copy wins once submitted.
        submission:   t.submission ?? null,
        submissionPdf: pdfMeta(t),
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
/**
 * GET /api/self-study/:id/reviews — the activity's review battle: when it runs
 * (one class battle, sent to their Challenges) and each learner's state
 * (waiting · sent · accepted · running · done with its mark · missed). The
 * instructor's view (self-study/activityReview.js).
 */
router.get("/:id/reviews", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");
  const review = assignment.details?.review || null;
  if (!review?.on) return ok(res, { review: null, reviews: [] });
  const { activityReviews } = await import("./activityReview.js");
  const { reviews, battleId, battleStatus, startsAt } = await activityReviews(assignment.id);
  const ids = reviews.map((r) => r.learnerId);
  const { data: users } = ids.length ? await db.from("users").select("id, full_name, username").in("id", ids) : { data: [] };
  const nameOf = new Map((users || []).map((u) => [u.id, u.full_name || u.username]));
  ok(res, { review, battleId, battleStatus, startsAt, reviews: reviews.map((r) => ({ ...r, name: nameOf.get(r.learnerId) || null })) });
}));

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
        .select("id, target_id, name, size, mime, kind, question_index, created_at").in("target_id", targetIds)
    : { data: [] };
  const filesByTarget = new Map();
  for (const f of (fileRows ?? [])) {
    (filesByTarget.get(f.target_id) ?? filesByTarget.set(f.target_id, []).get(f.target_id)).push(f);
  }

  ok(res, {
    ...assignment,
    targets: (targets ?? []).map(({ submission_pdf, marked_pdf, ...t }) => {
      // Only what was handed in: files uploaded and then left out of the
      // submission (or still in progress) aren't the learner's work yet.
      const handedIn = new Set((t.submission?.files ?? []).map((f) => f.id));
      return {
        ...t,
        full_name: byId.get(t.student_id)?.full_name ?? "Unknown",
        username:  byId.get(t.student_id)?.username ?? null,
        emoji:     byId.get(t.student_id)?.avatar_emoji ?? null,
        files:     (filesByTarget.get(t.id) ?? []).filter((f) => handedIn.has(f.id))
          .map(({ question_index, ...f }) => ({ ...f, ...(Number.isInteger(question_index) ? { question: question_index } : {}) })),
        // A draft still "making" long after it started was cut off (a restart): offer Redraft.
        ai_grade: t.ai_grade?.status === "making" && Date.now() - Date.parse(t.ai_grade.at || 0) > AI_DRAFT_STALE_MS
          ? { ...t.ai_grade, status: "failed", error: "Drafting was interrupted — draft again." } : t.ai_grade ?? null,
        submissionPdf: pdfMeta({ ...t, submission_pdf }),
        markedPdf: marked_pdf?.key ? { ready: true, builtAt: marked_pdf.builtAt ?? null } : null,
      };
    }),
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
  if (updates.details) updates.details = cleanPaperDetails(updates.details);
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
/** An AI marking draft still "making" after this long was cut off. */
const AI_DRAFT_STALE_MS = 5 * 60_000;

router.patch("/:id/targets/:studentId/grade", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");

  const studentId = req.params.studentId;
  const { grade } = req.body;
  const sentFeedback = req.body.feedback;
  if (sentFeedback != null && (typeof sentFeedback !== "object" || Array.isArray(sentFeedback))) return bad(res, "feedback must be an object");
  const feedback = sentFeedback || {};
  const n = Number(grade);
  if (!Number.isFinite(n) || n < 0 || n > 100) return bad(res, "grade must be a number from 0 to 100");

  const patch = { grade: Math.round(n), graded_at: now(), graded_by: req.user.id };
  if (sentFeedback == null) {
    // A score-only publish (the gradebook) keeps the feedback already given —
    // but a score typed over question marks is now the teacher's own number.
    const { data: prev } = await edu().from("self_study_targets").select("feedback")
      .eq("assignment_id", assignment.id).eq("student_id", studentId).maybeSingle();
    if (prev?.feedback?.mode === "questions") patch.feedback = { ...prev.feedback, mode: "manual" };
  } else {
    // Marked question by question: each row is { index, awarded, max, comment }.
    const qm = cleanQuestionMarks(assignment.details?.questions || [], feedback.questions);
    if (qm.error) return bad(res, qm.error);
    patch.feedback = {
      text: typeof feedback.text === "string" ? feedback.text.slice(0, 4000) : "",
      rubric: Array.isArray(feedback.rubric) ? feedback.rubric.slice(0, 12) : [],
      questions: qm.marks,
      mode: ["manual", "questions"].includes(feedback.mode) ? feedback.mode : "rubric",
    };
  }
  const { data: target, error: tErr } = await edu().from("self_study_targets")
    .update(patch)
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
  // The marked copy (the PDF with the grader's marks + the grade page) is
  // what the learner gets back — built now, so it's ready when they look.
  if (target.submission?.submittedAt) buildMarkedCopyLater(target.id);

  ok(res, { grade: target.grade, graded_at: target.graded_at });
}));

/**
 * DELETE /api/self-study/:id/targets/:studentId/grade — unpublish: the work
 * goes back to "submitted, not graded". The marks and comments stay as the
 * teacher's draft (they come back when the grading view reopens); the
 * learner stops seeing a grade.
 */
router.delete("/:id/targets/:studentId/grade", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");
  const { data: target, error: tErr } = await edu().from("self_study_targets")
    .update({ grade: null, graded_at: null, graded_by: null, marked_pdf: null })
    .eq("assignment_id", assignment.id).eq("student_id", req.params.studentId)
    .select("id, grade").single();
  if (tErr || !target) return missing(res, "That learner is not assigned this activity");
  global.io?.to(`user:${req.params.studentId}`).emit("activity_graded", { assignmentId: assignment.id, grade: null });
  ok(res, { grade: null });
}));

/** PUT /api/self-study/:id/targets/:studentId/markup { marks } — the
 *  grader's marks on the submission PDF (autosaved while marking). They
 *  reach the learner only inside the marked copy, after a grade is published. */
router.put("/:id/targets/:studentId/markup", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");
  const v = validateMarks(req.body?.marks);
  if (v.error) return bad(res, v.error);
  const markup = { marks: v.marks, updatedAt: now(), by: req.user.id };
  const { data: target, error: tErr } = await edu().from("self_study_targets")
    .update({ markup }).eq("assignment_id", assignment.id).eq("student_id", req.params.studentId)
    .select("id, grade, submission").maybeSingle();
  if (tErr || !target) return missing(res, "That learner is not assigned this activity");
  // Already graded: the learner's marked copy follows the new marks.
  if (target.grade != null && target.submission?.submittedAt) buildMarkedCopyLater(target.id);
  ok(res, { count: v.marks.length, updatedAt: markup.updatedAt });
}));

/** POST /api/self-study/:id/targets/:studentId/ai-grade — draft marks with
 *  AI for this submission (the instructor approves; nothing is published).
 *  Runs after the response; the draft lands on the target as ai_grade. */
router.post("/:id/targets/:studentId/ai-grade", requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  const { assignment, error } = await ownedAssignment(req, req.params.id);
  if (error === "not_found") return missing(res, "Assignment not found");
  if (error === "forbidden") return denied(res, "Not your assignment");
  const { data: t } = await edu().from("self_study_targets")
    .select("id, submission, ai_grade").eq("assignment_id", assignment.id).eq("student_id", req.params.studentId).maybeSingle();
  if (!t) return missing(res, "That learner is not assigned this activity");
  if (!t.submission?.submittedAt) return bad(res, "Nothing has been submitted yet");
  const started = Date.parse(t.ai_grade?.at || "");
  if (t.ai_grade?.status === "making" && Date.now() - started < AI_DRAFT_STALE_MS) {
    return res.status(409).json({ success: false, error: "Marks are already being drafted — they'll appear in a moment" });
  }
  void aiGradeTarget(t.id);
  res.status(202).json({ success: true, data: { ai_grade: { status: "making", at: now() } } });
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
   submission. Kept in object storage under the learner's prefix (rows from
   before that still carry base64); capped at 5MB and 5 files per target.
   Teachers reach them through the activity they own; the learner through
   their own target. */

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
  if (target.status === "complete") return bad(res, "Already submitted — files can't be added now");

  const { name, data, question } = req.body ?? {};
  const clean = typeof name === "string" ? name.trim().slice(0, 200) : "";
  // The question this file answers (assignments with questions): a real one,
  // up to PER_QUESTION files each. Without one it belongs to the submission.
  let qIndex = null;
  const { data: brief } = await edu().from("self_study_assignments").select("details").eq("id", req.params.id).maybeSingle();
  if (question !== undefined && question !== null && question !== "") {
    const n = Number(question);
    if (!Number.isInteger(n) || n < 0 || n >= (brief?.details?.questions || []).length) return bad(res, "No such question");
    qIndex = n;
  }
  if (!clean) return bad(res, "A file needs a name");
  if (typeof data !== "string" || !data) return bad(res, "File data is required (base64)");
  // base64 inflates by ~4/3 — reject early, before decoding
  if (data.length > Math.ceil(SUBMISSION_FILE_LIMITS.MAX_BYTES * 1.4)) return bad(res, "Files can be at most 5MB");
  let bytes = Buffer.from(data, "base64");
  if (!bytes.length) return bad(res, "That file is empty");
  if (bytes.length > SUBMISSION_FILE_LIMITS.MAX_BYTES) return bad(res, "Files can be at most 5MB");
  // What it IS, from its bytes — the browser's type is only a hint.
  const sniffed = sniffSubmissionFile(bytes, clean);
  if (!sniffed) return bad(res, "Upload a PDF, a photo (JPG or PNG), a Word .docx or a text file");
  // The assignment's answer format decides what may be attached (details.answer_format; none = everything).
  const refused = fileRefusal(answerFormatOf(brief?.details), sniffed.kind);
  if (refused) return bad(res, refused);

  let countQ = edu().from("self_study_files").select("id", { count: "exact", head: true }).eq("target_id", target.id);
  countQ = qIndex === null ? countQ.is("question_index", null) : countQ.eq("question_index", qIndex);
  const { count } = await countQ;
  if (qIndex !== null && (count ?? 0) >= SUBMISSION_FILE_LIMITS.PER_QUESTION) return bad(res, `At most ${SUBMISSION_FILE_LIMITS.PER_QUESTION} files per question`);
  if (qIndex === null && (count ?? 0) >= SUBMISSION_FILE_LIMITS.MAX_FILES) return bad(res, "At most 5 files per submission");

  // A whiteboard drawing is kept cropped to the handwriting (the paper shows the work, not the board).
  if (sniffed.format === "png" && isDrawingName(clean)) bytes = await cropDrawing(bytes);
  const stored = await storeSubmissionFile({ learnerId: req.user.id, targetId: target.id, name: clean, bytes, mime: sniffed.mime });
  const { data: file, error } = await edu().from("self_study_files")
    .insert({ target_id: target.id, name: clean, mime: sniffed.mime, kind: sniffed.kind, size: bytes.length, question_index: qIndex, ...stored })
    .select("id, name, size, mime, kind, question_index").single();
  if (error) {
    if (stored.storage_key) void removeSubmissionObject(stored.storage_key, req.user.id);
    throw new Error(error.message);
  }
  ok(res, { id: file.id, name: file.name, size: file.size, mime: file.mime, kind: file.kind, question: file.question_index });
}));

/** DELETE /api/self-study/files/:fileId — the owning learner removes a file.
 *  Only before submitting: once the target is complete the submission is the
 *  record the teacher grades, so it stays exactly as handed in. */
router.delete("/files/:fileId", asyncHandler(async (req, res) => {
  const { data: file } = await edu().from("self_study_files")
    .select("id, target_id, storage_key").eq("id", req.params.fileId).maybeSingle();
  if (!file) return missing(res, "File not found");
  const { data: t } = await edu().from("self_study_targets")
    .select("student_id, status").eq("id", file.target_id).maybeSingle();
  if (!t || t.student_id !== req.user.id) return denied(res, "Not your file");
  if (t.status === "complete") return bad(res, "Already submitted — the teacher needs to see this file");
  await edu().from("self_study_files").delete().eq("id", file.id);
  void removeSubmissionObject(file.storage_key, req.user.id);
  ok(res, { removed: true });
}));

/** May the caller see this target's work? The learner it belongs to, or the
 *  teacher / school that owns the activity. → { target } | { status, error } */
async function viewableTarget(req, targetId) {
  const { data: t } = await edu().from("self_study_targets")
    .select("id, assignment_id, student_id, status, submission, submission_pdf").eq("id", targetId).maybeSingle();
  if (!t) return { status: 404, error: "Not found" };
  if (t.student_id === req.user.id) return { target: t };
  if (TEACHER_ROLES.includes(req.user.role)) {
    const { error } = await ownedAssignment(req, t.assignment_id);
    if (!error) return { target: t };
  }
  return { status: 403, error: "Not yours to see" };
}

/** GET /api/self-study/files/:fileId — open (or ?download=1) one attachment:
 *  owning learner, or the teacher/school that owns the activity. */
router.get("/files/:fileId", asyncHandler(async (req, res) => {
  const { data: file } = await edu().from("self_study_files")
    .select("id, target_id, name, mime, storage_key, data").eq("id", req.params.fileId).maybeSingle();
  if (!file) return missing(res, "File not found");
  const seen = await viewableTarget(req, file.target_id);
  if (seen.error) return res.status(seen.status).json({ success: false, error: seen.status === 404 ? "File not found" : "Not your file" });

  const bytes = await readSubmissionFile(file);
  res.setHeader("Content-Type", file.mime || "application/octet-stream");
  res.setHeader("Content-Disposition", contentDisposition(file.name, req.query.download ? "attachment" : "inline"));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(bytes);
}));

/* ── The paper template (paperTemplate.js), rendered on the server ─────── */

const sendPaper = (res, html, name) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", contentDisposition(name, "inline"));
  res.setHeader("Cache-Control", "private, no-cache");
  res.send(html);
};

/** GET /api/self-study/:id/paper.html?copy=student|teacher|both&embed=1 — the
 *  assignment as the paper template. The teacher (or school) gets any copy;
 *  a learner it was given to gets the student paper only. */
router.get(/^\/([0-9a-f-]{36})\/paper\.html$/i, asyncHandler(async (req, res) => {
  const id = req.params[0];
  let copy = ["student", "teacher", "both"].includes(req.query.copy) ? req.query.copy : "student";
  let { assignment, error } = TEACHER_ROLES.includes(req.user.role) ? await ownedAssignment(req, id) : { error: "forbidden" };
  if (error) {
    const t = await myTargetOf(id, req.user.id);
    if (!t) return res.status(error === "not_found" ? 404 : 403).json({ success: false, error: "Not yours to see" });
    const { data } = await edu().from("self_study_assignments").select("*").eq("id", id).maybeSingle();
    assignment = { ...data, details: briefForLearner(data?.details, false) };
    copy = "student";
  }
  if (!(assignment.details?.questions || []).length) return bad(res, "This activity has no question paper");
  sendPaper(res, await assignmentPaperHtml(assignment, { copy, embed: !!req.query.embed }), `${assignment.title || "paper"}.html`);
}));

/** GET /api/self-study/drafts/:id/paper.html?version=n&copy=&key=1&embed=1 —
 *  a chat draft's version as the paper (the preview, its download). */
router.get(/^\/drafts\/([0-9a-f-]{36})\/paper\.html$/i, requireRole(TEACHER_ROLES), asyncHandler(async (req, res) => {
  let draft;
  try { draft = await getActivityDraft(req.user, req.params[0]); } catch (e) { return res.status(e.status || 500).json({ success: false, error: e.message }); }
  const v = req.query.version != null ? versionAt(draft.payload, Number(req.query.version)) : latestReady(draft.payload);
  if (!v || v.status !== "ready") return bad(res, "That version isn't ready");
  const p = draft.payload || {};
  const copy = ["student", "teacher", "both"].includes(req.query.copy) ? req.query.copy : "student";
  const html = await assignmentPaperHtml(
    { title: draft.title, subject: p.subject || draft.subject, topic: p.topic || draft.topic, due_at: p.due_at || null, created_at: draft.created_at,
      school_id: draft.school_id, created_by: draft.created_by, instructions: v.paper?.instructions, details: v.paper },
    { copy, showKey: !!req.query.key, embed: !!req.query.embed, changes: req.query.key ? v.changes : null, versionLabel: `V${v.n}` },
  );
  sendPaper(res, html, `${draft.title || "paper"}.html`);
}));

/** GET /api/self-study/targets/:targetId/submission.html?only=i&embed=1 — the
 *  submission as the paper template (one question when grading). */
router.get(/^\/targets\/([0-9a-f-]{36})\/submission\.html$/i, asyncHandler(async (req, res) => {
  const seen = await viewableTarget(req, req.params[0]);
  if (seen.error) return res.status(seen.status).json({ success: false, error: seen.error });
  if (!seen.target.submission?.submittedAt) return bad(res, "Nothing has been submitted yet");
  const only = req.query.only != null && req.query.only !== "" && Number.isInteger(Number(req.query.only)) ? Number(req.query.only) : null;
  const html = await submissionPaperHtml(seen.target.id, { only, embed: !!req.query.embed });
  if (!html) return missing(res, "Not found");
  sendPaper(res, html, "submission.html");
}));

/** GET /api/self-study/targets/:targetId/submission.json — the submission as
 *  the paper template lays it out (paperSchema.js submissionDocument): the
 *  learner, answered / unanswered, each question with its answer, drawings
 *  and marks box. Marks only once published. */
router.get(/^\/targets\/([0-9a-f-]{36})\/submission\.json$/i, asyncHandler(async (req, res) => {
  const seen = await viewableTarget(req, req.params[0]);
  if (seen.error) return res.status(seen.status).json({ success: false, error: seen.error });
  if (!seen.target.submission?.submittedAt) return bad(res, "Nothing has been submitted yet");
  const doc = await loadSubmissionDocument(seen.target.id);
  if (!doc) return missing(res, "Not found");
  res.setHeader("Cache-Control", "private, no-cache");
  ok(res, { document: doc });
}));

/** GET /api/self-study/targets/:targetId/submission.pdf (or .md) — the whole
 *  submission as one document. Built at submit; built now if it isn't there
 *  yet (or the learner resubmitted since). ?download=1 saves it. */
router.get(/^\/targets\/([0-9a-f-]{36})\/submission\.(pdf|md)$/i, asyncHandler(async (req, res) => {
  const [targetId, ext] = [req.params[0], req.params[1].toLowerCase()];
  const seen = await viewableTarget(req, targetId);
  if (seen.error) return res.status(seen.status).json({ success: false, error: seen.error });
  if (!seen.target.submission?.submittedAt) return bad(res, "Nothing has been submitted yet");

  const bytes = await readSubmissionArtifact(seen.target, ext);
  res.setHeader("Content-Type", ext === "pdf" ? "application/pdf" : "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", contentDisposition(`submission.${ext}`, req.query.download ? "attachment" : "inline"));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-cache");
  res.send(bytes);
}));

/** GET /api/self-study/targets/:targetId/marked.pdf — the submission with the
 *  grader's marks drawn in, opened by the grade page. The learner gets it
 *  once graded; the teacher can preview it any time. ?download=1 saves it. */
router.get(/^\/targets\/([0-9a-f-]{36})\/marked\.pdf$/i, asyncHandler(async (req, res) => {
  const seen = await viewableTarget(req, req.params[0]);
  if (seen.error) return res.status(seen.status).json({ success: false, error: seen.error });
  if (!seen.target.submission?.submittedAt) return bad(res, "Nothing has been submitted yet");
  const { data: full } = await edu().from("self_study_targets")
    .select("id, student_id, grade, graded_at, markup, marked_pdf").eq("id", seen.target.id).maybeSingle();
  const isLearner = seen.target.student_id === req.user.id;
  if (isLearner && full?.grade == null) return res.status(409).json({ success: false, error: "Your teacher hasn't graded this yet" });

  const bytes = await readMarkedCopy({ ...seen.target, ...full });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", contentDisposition("marked-submission.pdf", req.query.download ? "attachment" : "inline"));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-cache");
  res.send(bytes);
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
/**
 * PUT /api/self-study/:id/draft/:index { value } — submit ONE question's
 * answer. The assignment is answered a question at a time: each answer is
 * saved here as it's submitted (an empty value clears it), then the review
 * step hands the whole assignment in (POST /:id/complete).
 */
router.put("/:id/draft/:index", asyncHandler(async (req, res) => {
  const { data: target } = await edu().from("self_study_targets")
    .select("id, status, grade, draft").eq("assignment_id", req.params.id).eq("student_id", req.user.id).maybeSingle();
  if (!target) return missing(res, "This assignment was not given to you");
  if (target.grade != null || target.status === "complete") return res.status(409).json({ success: false, error: "Already handed in — answers can't change now" });
  const { data: assignment } = await edu().from("self_study_assignments").select("details").eq("id", req.params.id).maybeSingle();
  // A photo-only assignment takes no typed answers to open questions (picking an option is not typing;
  // clearing an answer is always fine).
  const typedNo = typedRefusal(answerFormatOf(assignment?.details));
  const asked = (assignment?.details?.questions || [])[Number(req.params.index)];
  if (typedNo && !Array.isArray(asked?.options) && String(req.body?.value ?? "").trim() !== "") return bad(res, typedNo);
  const c = cleanAnswer(assignment?.details?.questions || [], req.params.index, req.body?.value);
  if (c.error) return bad(res, c.error);

  const answers = { ...(target.draft?.answers || {}) };
  if (c.value === null) delete answers[String(c.index)]; else answers[String(c.index)] = c.value;
  const draft = { ...(target.draft || {}), answers, savedAt: now() };
  const { error } = await edu().from("self_study_targets")
    .update({ draft, ...(target.status === "assigned" ? { status: "started", started_at: now() } : {}) })
    .eq("id", target.id);
  if (error) throw new Error(error.message);
  ok(res, { index: c.index, value: c.value, savedAt: draft.savedAt, answered: Object.keys(answers).length });
}));

/**
 * PUT /api/self-study/:id/draft-text { text } — the written answer of work
 * without questions, autosaved so it follows the learner across devices.
 */
router.put("/:id/draft-text", asyncHandler(async (req, res) => {
  const { data: target } = await edu().from("self_study_targets")
    .select("id, status, grade, draft").eq("assignment_id", req.params.id).eq("student_id", req.user.id).maybeSingle();
  if (!target) return missing(res, "This assignment was not given to you");
  if (target.grade != null || target.status === "complete") return res.status(409).json({ success: false, error: "Already handed in — it can't change now" });
  if (typeof req.body?.text !== "string") return bad(res, "text must be a string");
  const { data: brief } = await edu().from("self_study_assignments").select("details").eq("id", req.params.id).maybeSingle();
  const typedNo = typedRefusal(answerFormatOf(brief?.details));
  if (typedNo && req.body.text.trim() !== "") return bad(res, typedNo);
  const draft = { ...(target.draft || {}), text: req.body.text.slice(0, 8000), savedAt: now() };
  const { error } = await edu().from("self_study_targets")
    .update({ draft, ...(target.status === "assigned" ? { status: "started", started_at: now() } : {}) })
    .eq("id", target.id);
  if (error) throw new Error(error.message);
  ok(res, { savedAt: draft.savedAt, length: draft.text.length });
}));

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
    .select("id, grade, draft, status, submission").eq("assignment_id", req.params.id).eq("student_id", req.user.id).maybeSingle();
  if (!target) return missing(res, "This assignment was not given to you");
  // Graded work is closed: a resubmission would sit under the old grade.
  if (target.grade != null) return res.status(409).json({ success: false, error: "This work has been graded — it can't be changed now" });
  // Handed in once already (another tab, a double tap): the first stays.
  if (target.status === "complete" && target.submission?.submittedAt) {
    return res.status(409).json({ success: false, error: "This work was already handed in — your teacher has it." });
  }
  const { data: brief } = await edu().from("self_study_assignments").select("details, due_at").eq("id", req.params.id).maybeSingle();
  const questions = Array.isArray(brief?.details?.questions) ? brief.details.questions : [];

  // ── The work itself: optional free text, per-question answers (keyed by
  //    question index), and the files uploaded for this target. Everything
  //    is capped so the row stays small. Backward compatible — completing
  //    with no body still works and stores an empty submission.
  const body = req.body ?? {};
  // A photo-only assignment keeps no typed words, whatever was sent with the hand-in.
  const typedNo = typedRefusal(answerFormatOf(brief?.details));
  const sentText = typeof body.text === "string" ? body.text.slice(0, 8000) : "";
  const text = typedNo ? "" : sentText.trim() ? sentText : String(target.draft?.text || "").slice(0, 8000);
  const answers = {};
  // The answers saved question by question are the work; answers sent with
  // the hand-in win where both exist. Each is checked like an autosave.
  const sent = body.answers && typeof body.answers === "object" && !Array.isArray(body.answers) ? body.answers : {};
  const merged = { ...(target.draft?.answers || {}), ...sent };
  for (const [k, v] of Object.entries(merged).slice(0, 60)) {
    if (typedNo && !Array.isArray(questions[Number(k)]?.options)) continue;   // an open answer typed on a photo-only assignment
    const c = cleanAnswer(questions, k, v);
    if (!c.error && c.value !== null) answers[String(c.index)] = c.value;
  }
  // The work is every file on this target, each with the question it
  // answers (removing a file deletes it, so what's here is what was kept).
  const { data: fileRows } = await edu().from("self_study_files").select("id, name, size, mime, kind, question_index")
    .eq("target_id", target.id).order("created_at", { ascending: true }).limit(200);
  const files = (fileRows ?? []).map((f) => ({ id: f.id, name: f.name, size: f.size, mime: f.mime, kind: f.kind, ...(Number.isInteger(f.question_index) ? { question: f.question_index } : {}) }));
  const submittedAt = now();
  // Late work is accepted and marked late, so the teacher sees it.
  const dueMs = brief?.due_at ? Date.parse(brief.due_at) : NaN;
  const late = Number.isFinite(dueMs) && Date.parse(submittedAt) > dueMs;
  const submission = { text, answers, files, submittedAt, ...(late ? { late: true, lateByMinutes: Math.round((Date.parse(submittedAt) - dueMs) / 60000) } : {}) };

  const { data, error } = await edu().from("self_study_targets")
    .update({ status: "complete", completed_at: now(), submission })
    .eq("id", target.id).select().single();
  if (error) throw new Error(error.message);

  // The submission as one PDF (+ markdown) — built and stored in the
  // background; then, when the activity has "AI auto-grade" on, the AI
  // drafts marks from it for the instructor to approve.
  // AI auto-grade: say "making" straight away, so a teacher who opens the
  // work while the PDF is still building sees the draft on its way.
  if (brief?.details?.ai_auto_grade) {
    await edu().from("self_study_targets").update({ ai_grade: { status: "making", at: now() } }).eq("id", target.id).then(() => {}, () => {});
  }
  buildSubmissionArtifacts(target.id)
    .then(() => (brief?.details?.ai_auto_grade ? aiGradeTarget(target.id) : null))
    .catch((e) => console.warn("[self-study] post-submit build failed (built on first open):", String(e?.message || e).slice(0, 160)));
  // Event trigger: study work completed — fresh signal for the planner.
  emitAutonomyEvent(req.user.id, "self_study").catch(() => {});
  ok(res, data);
}));

export default router;
