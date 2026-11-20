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
 *   POST   /:id/start          → mark started + get the brief (session is made by the WS)
 *   POST   /:id/link           → record which adaptive session it became
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
 *
 * Layering (Phase 19 step 4): this router only authenticates and wires
 * handlers. service-*.js owns the orchestration by resource, rules.js the pure
 * validation/windows/ownership predicates, and store-*.js every Supabase query.
 * Ownership checks (ownedAssignment, viewableTarget, teacher/parent scoping)
 * run in the service before any read or write.
 */

import { Router }                         from "express";
import { authenticateToken, requireRole } from "../auth/index.js";
import { asyncHandler }                   from "./http.js";
import { TEACHER_ROLES }                  from "./rules.js";
import * as activities                    from "./service-activities.js";
import * as drafts                        from "./service-drafts.js";
import * as files                         from "./service-files.js";
import * as grading                       from "./service-grading.js";
import * as learner                       from "./service-learner.js";
import * as mine                          from "./service-mine.js";

const router = Router();

router.use(authenticateToken);

/* ═══════════════════════════ TEACHER / SCHOOL ═══════════════════════════ */

/** POST /api/self-study/plan — subtopics + objectives to review before assigning. */
router.post("/plan", requireRole(TEACHER_ROLES), asyncHandler(activities.plan));

/* ═══ Assignment drafting — points, rubric and questions ═════════════════════
   The workbench's Assignment form exposes only the necessary fields
   (reference: assignment generation and creator.md): total points, the AI
   switches, the question types to use, and the rubric. Everything
   question-level — text, type, max_points, difficulty, cognitive level —
   is drafted HERE and handed back for review. Nothing is assigned by
   these routes; the instructor edits before anything is sent. */

router.post("/assignment-draft/questions", requireRole(TEACHER_ROLES), asyncHandler(activities.draftQuestions));
router.post("/assignment-draft/rubric", requireRole(TEACHER_ROLES), asyncHandler(activities.draftRubric));

/* ═══ Draft routines — recurring, human-approved preparation ══════════════════
   The scheduler only PREPARES drafts at the slot; the instructor assigns each
   occurrence. Declared before /:id so "routines" is never an assignment id. */

router.get("/routines", requireRole(TEACHER_ROLES), asyncHandler(drafts.listRoutine));
router.post("/routines", requireRole(TEACHER_ROLES), asyncHandler(drafts.createRoutineHandler));
router.patch("/routines/:id", requireRole(TEACHER_ROLES), asyncHandler(drafts.updateRoutineHandler));
router.delete("/routines/:id", requireRole(TEACHER_ROLES), asyncHandler(drafts.deleteRoutineHandler));

/* ═══ AI activity drafts — human-in-the-loop ══════════════════════════════════
   The agent PREPARES (via the prepare_activity chat tool); only these
   endpoints — hit by the human's preview UI — can assign. Declared before
   the /:id routes so "drafts" is never read as an assignment id. */

router.get("/drafts", requireRole(TEACHER_ROLES), asyncHandler(drafts.listDrafts));
router.get("/drafts/:id", requireRole(TEACHER_ROLES), asyncHandler(drafts.getDraft));
router.patch("/drafts/:id", requireRole(TEACHER_ROLES), asyncHandler(drafts.patchDraft));
router.post("/drafts/:id/assign", requireRole(TEACHER_ROLES), asyncHandler(drafts.assignDraft));

/* An assignment draft's question versions (V1, V2… — draftVersions.js). */
router.put("/drafts/:id/versions/:n", requireRole(TEACHER_ROLES), asyncHandler(drafts.saveVersion));
router.put("/drafts/:id/settings", requireRole(TEACHER_ROLES), asyncHandler(drafts.saveSettings));
router.post("/drafts/:id/versions/:n/rubric", requireRole(TEACHER_ROLES), asyncHandler(drafts.writeVersionRubric));
router.put("/drafts/:id/versions/:n/rubric", requireRole(TEACHER_ROLES), asyncHandler(drafts.editVersionRubric));
router.post("/drafts/:id/versions/:n/retry", requireRole(TEACHER_ROLES), asyncHandler(drafts.retryVersion));
router.post("/drafts/:id/review-questions", requireRole(TEACHER_ROLES), asyncHandler(drafts.reviewQuestions));
router.post("/drafts/:id/history/:n/restore", requireRole(TEACHER_ROLES), asyncHandler(drafts.restoreHistory));
router.delete("/drafts/:id", requireRole(TEACHER_ROLES), asyncHandler(drafts.discardDraft));

/** POST /api/self-study — create the brief and assign it (the shared path). */
router.post("/", requireRole(TEACHER_ROLES), asyncHandler(activities.create));

/** GET /api/self-study — assignments I created (or my school's), with progress. */
router.get("/", requireRole(TEACHER_ROLES), asyncHandler(activities.list));

/** GET /api/self-study/mine — what I, a learner, have been assigned. */
router.get("/mine", asyncHandler(mine.mine));

/**
 * GET /api/self-study/:id/reviews — the activity's review battle: when it runs
 * (one class battle, sent to their Challenges) and each learner's state
 * (waiting · sent · accepted · running · done with its mark · missed). The
 * instructor's view (self-study/activityReview.js).
 */
router.get("/:id/reviews", requireRole(TEACHER_ROLES), asyncHandler(activities.reviews));

/** GET /api/self-study/:id/analytics — class results for one activity, plus any saved AI report. */
router.get("/:id/analytics", requireRole(TEACHER_ROLES), asyncHandler(activities.analytics));

/** POST /api/self-study/:id/report — generate (and save) the AI report for this activity. */
router.post("/:id/report", requireRole(TEACHER_ROLES), asyncHandler(activities.report));

/**
 * GET /api/self-study/streak — the learner's activity streak.
 *
 * Consecutive days ending today (or yesterday, so an early visit keeps a
 * streak alive) with at least one completed activity, derived from the
 * learner's own completion timestamps. No new state: it is computed from
 * what really happened, so it can never show a number the learner did not
 * earn. Registered before /:id so "streak" is never read as an id.
 */
router.get("/streak", asyncHandler(mine.streak));

/** GET /api/self-study/:id — the brief plus every learner's state. */
router.get("/:id", asyncHandler(activities.detail));

/** PATCH /api/self-study/:id — edit the brief. */
router.patch("/:id", requireRole(TEACHER_ROLES), asyncHandler(activities.patch));

/** POST /api/self-study/:id/assign — add more learners later. */
router.post("/:id/assign", requireRole(TEACHER_ROLES), asyncHandler(activities.assignMore));

/**
 * PATCH /api/self-study/:id/targets/:studentId/grade — publish a grade.
 *
 * The workbench autosaves drafts locally (they never touch the server);
 * this is the deliberate PUBLISH: the number becomes the learner's grade,
 * the feedback (text + rubric levels) travels with it, the learner is
 * notified, and their gradebook files the work under "Graded activity".
 * Republishing overwrites — the latest deliberate grade wins.
 */
router.patch("/:id/targets/:studentId/grade", requireRole(TEACHER_ROLES), asyncHandler(grading.publishGrade));

/**
 * DELETE /api/self-study/:id/targets/:studentId/grade — unpublish: the work
 * goes back to "submitted, not graded". The marks and comments stay as the
 * teacher's draft (they come back when the grading view reopens); the
 * learner stops seeing a grade.
 */
router.delete("/:id/targets/:studentId/grade", requireRole(TEACHER_ROLES), asyncHandler(grading.unpublishGrade));

/** PUT /api/self-study/:id/targets/:studentId/markup { marks } — the
 *  grader's marks on the submission PDF (autosaved while marking). They
 *  reach the learner only inside the marked copy, after a grade is published. */
router.put("/:id/targets/:studentId/markup", requireRole(TEACHER_ROLES), asyncHandler(grading.saveMarkup));

/** POST /api/self-study/:id/targets/:studentId/ai-grade — draft marks with
 *  AI for this submission (the instructor approves; nothing is published).
 *  Runs after the response; the draft lands on the target as ai_grade. */
router.post("/:id/targets/:studentId/ai-grade", requireRole(TEACHER_ROLES), asyncHandler(grading.draftAiGrade));

/** DELETE /api/self-study/:id/targets/:studentId — unassign one learner. */
router.delete("/:id/targets/:studentId", requireRole(TEACHER_ROLES), asyncHandler(activities.unassign));

/**
 * DELETE /api/self-study/:id
 * Removes the assignment and its targets. Any adaptive sessions learners
 * already started are left alone — that work is theirs, and the FK is
 * ON DELETE SET NULL precisely so deleting the brief cannot destroy it.
 */
router.delete("/:id", requireRole(TEACHER_ROLES), asyncHandler(activities.remove));

/* ═════════════════════════ SUBMISSION FILES ═════════════════════════
   Attachments a learner uploads BEFORE completing — the work behind the
   submission. Kept in object storage under the learner's prefix (rows from
   before that still carry base64); capped at 5MB and 5 files per target.
   Teachers reach them through the activity they own; the learner through
   their own target. */

/** POST /api/self-study/:id/files — learner uploads one attachment. */
router.post("/:id/files", asyncHandler(files.uploadFile));

/** DELETE /api/self-study/files/:fileId — the owning learner removes a file.
 *  Only before submitting: once the target is complete the submission is the
 *  record the teacher grades, so it stays exactly as handed in. */
router.delete("/files/:fileId", asyncHandler(files.deleteFile));

/** GET /api/self-study/files/:fileId — open (or ?download=1) one attachment:
 *  owning learner, or the teacher/school that owns the activity. */
router.get("/files/:fileId", asyncHandler(files.getFile));

/* ── The paper template (paperTemplate.js), rendered on the server ─────── */

/** GET /api/self-study/:id/paper.html?copy=student|teacher|both&embed=1 — the
 *  assignment as the paper template. The teacher (or school) gets any copy;
 *  a learner it was given to gets the student paper only. */
router.get(/^\/([0-9a-f-]{36})\/paper\.html$/i, asyncHandler(files.assignmentPaper));

/** GET /api/self-study/drafts/:id/paper.html?version=n&copy=&key=1&embed=1 —
 *  a chat draft's version as the paper (the preview, its download). */
router.get(/^\/drafts\/([0-9a-f-]{36})\/paper\.html$/i, requireRole(TEACHER_ROLES), asyncHandler(files.draftPaper));

/** GET /api/self-study/targets/:targetId/submission.html?only=i&embed=1 — the
 *  submission as the paper template (one question when grading). */
router.get(/^\/targets\/([0-9a-f-]{36})\/submission\.html$/i, asyncHandler(files.submissionHtml));

/** GET /api/self-study/targets/:targetId/draft.html?embed=1 — my answers so far, before hand-in, laid out
 *  on the same paper template as the handed-in copy (the learner's "Review" step). Mine only. */
router.get(/^\/targets\/([0-9a-f-]{36})\/draft\.html$/i, asyncHandler(files.draftHtml));

/** GET /api/self-study/targets/:targetId/submission.json — the submission as
 *  the paper template lays it out (paperSchema.js submissionDocument): the
 *  learner, answered / unanswered, each question with its answer, drawings
 *  and marks box. Marks only once published. */
router.get(/^\/targets\/([0-9a-f-]{36})\/submission\.json$/i, asyncHandler(files.submissionJson));

/** GET /api/self-study/targets/:targetId/submission.pdf (or .md) — the whole
 *  submission as one document. Built at submit; built now if it isn't there
 *  yet (or the learner resubmitted since). ?download=1 saves it. */
router.get(/^\/targets\/([0-9a-f-]{36})\/submission\.(pdf|md)$/i, asyncHandler(files.submissionDocument));

/** GET /api/self-study/targets/:targetId/marked.pdf — the submission with the
 *  grader's marks drawn in, opened by the grade page. The learner gets it
 *  once graded; the teacher can preview it any time. ?download=1 saves it. */
router.get(/^\/targets\/([0-9a-f-]{36})\/marked\.pdf$/i, asyncHandler(files.markedPdf));

/* ═══════════════════════════════ LEARNER ═══════════════════════════════ */

/**
 * PUT /api/self-study/:id/draft/:index { value } — submit ONE question's
 * answer. The assignment is answered a question at a time: each answer is
 * saved here as it's submitted (an empty value clears it), then the review
 * step hands the whole assignment in (POST /:id/complete).
 */
router.put("/:id/draft/:index", asyncHandler(learner.saveDraftAnswer));

/**
 * PUT /api/self-study/:id/draft-text { text } — the written answer of work
 * without questions, autosaved so it follows the learner across devices.
 */
router.put("/:id/draft-text", asyncHandler(learner.saveDraftText));

/**
 * POST /api/self-study/:id/start
 *
 * Marks the learner's copy as started and hands back the brief. It deliberately
 * does NOT create the adaptive session: the teaching WebSocket
 * (start_adaptive_session) already creates one when the modal opens, and
 * creating a second here would leave an orphan row and a session id that points
 * at nothing. The client calls /link once the socket tells it the real id.
 */
router.post("/:id/start", asyncHandler(learner.start));

/**
 * POST /api/self-study/:id/link  { sessionId }
 * Records which adaptive session this learner's attempt actually became, so the
 * teacher's progress view can point at real work.
 */
router.post("/:id/link", asyncHandler(learner.link));

/**
 * POST /api/self-study/:id/complete
 * Marks the learner's copy done. The session itself is completed by the
 * teaching engine; this just closes the assignment side so the teacher's
 * progress column moves.
 */
router.post("/:id/complete", asyncHandler(learner.complete));

export default router;
