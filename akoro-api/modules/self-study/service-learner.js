/**
 * modules/self-study/service-learner.js — the learner's own flow: save one
 * answer at a time, autosave free text, start/link the adaptive session, and
 * hand the work in (which builds the submission artifacts and, when the
 * activity opts in, starts AI marking). Everything is scoped to the caller's
 * target row.
 */
import { answerFormatOf, typedRefusal } from "./answerFormat.js";
import { cleanAnswer } from "./submissionView.js";
import { buildSubmissionArtifacts, aiGradeTarget } from "./submissionArtifacts.js";
import { emitAutonomyEvent } from "../autonomy/index.js";
import { ok, bad, denied, missing } from "./http.js";
import { lateOf } from "./rules.js";
import { now } from "./service-common.js";
import { releaseAiGrade } from "./service-grading.js";
import * as store from "./store-assignments.js";
import * as people from "./store-people.js";

/**
 * PUT /api/self-study/:id/draft/:index { value } — submit ONE question's
 * answer. The assignment is answered a question at a time: each answer is
 * saved here as it's submitted (an empty value clears it), then the review
 * step hands the whole assignment in (POST /:id/complete).
 */
export async function saveDraftAnswer(req, res) {
  const { data: target } = await store.targetByStudent(req.params.id, req.user.id, "id, status, grade, draft");
  if (!target) return missing(res, "This assignment was not given to you");
  if (target.grade != null || target.status === "complete") return res.status(409).json({ success: false, error: "Already handed in — answers can't change now" });
  const { data: assignment } = await store.findAssignmentFields(req.params.id, "details");
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
  const { error } = await store.updateTarget(target.id, { draft, ...(target.status === "assigned" ? { status: "started", started_at: now() } : {}) });
  if (error) throw new Error(error.message);
  ok(res, { index: c.index, value: c.value, savedAt: draft.savedAt, answered: Object.keys(answers).length });
}

/**
 * PUT /api/self-study/:id/draft-text { text } — the written answer of work
 * without questions, autosaved so it follows the learner across devices.
 */
export async function saveDraftText(req, res) {
  const { data: target } = await store.targetByStudent(req.params.id, req.user.id, "id, status, grade, draft");
  if (!target) return missing(res, "This assignment was not given to you");
  if (target.grade != null || target.status === "complete") return res.status(409).json({ success: false, error: "Already handed in — it can't change now" });
  if (typeof req.body?.text !== "string") return bad(res, "text must be a string");
  const { data: brief } = await store.findAssignmentFields(req.params.id, "details");
  const typedNo = typedRefusal(answerFormatOf(brief?.details));
  if (typedNo && req.body.text.trim() !== "") return bad(res, typedNo);
  const draft = { ...(target.draft || {}), text: req.body.text.slice(0, 8000), savedAt: now() };
  const { error } = await store.updateTarget(target.id, { draft, ...(target.status === "assigned" ? { status: "started", started_at: now() } : {}) });
  if (error) throw new Error(error.message);
  ok(res, { savedAt: draft.savedAt, length: draft.text.length });
}

/**
 * POST /api/self-study/:id/start
 *
 * Marks the learner's copy as started and hands back the brief. It deliberately
 * does NOT create the adaptive session: the teaching WebSocket
 * (start_adaptive_session) already creates one when the modal opens, and
 * creating a second here would leave an orphan row and a session id that points
 * at nothing. The client calls /link once the socket tells it the real id.
 */
export async function start(req, res) {
  const { data: target } = await store.targetByStudent(req.params.id, req.user.id, "*");
  if (!target) return missing(res, "This assignment was not given to you");

  const { data: assignment } = await store.findAssignment(req.params.id);
  if (!assignment) return missing(res, "Assignment not found");

  if (target.status === "assigned") {
    await store.updateTarget(target.id, { status: "started", started_at: now() });
  }

  ok(res, {
    assignment,
    target: { ...target, status: target.status === "assigned" ? "started" : target.status },
    // Present so the client can resume rather than start fresh.
    sessionId: target.session_id ?? null,
  });
}

/**
 * POST /api/self-study/:id/link  { sessionId }
 * Records which adaptive session this learner's attempt actually became, so the
 * teacher's progress view can point at real work.
 */
export async function link(req, res) {
  const { sessionId } = req.body;
  if (!sessionId) return bad(res, "sessionId is required");

  const { data: target } = await store.targetByStudent(req.params.id, req.user.id, "id");
  if (!target) return missing(res, "This assignment was not given to you");

  // Only link a session the learner owns — otherwise anyone could point their
  // assignment at somebody else's work.
  const { data: session } = await people.sessionById(sessionId);
  if (!session || session.student_id !== req.user.id) return denied(res, "Not your session");

  const { data, error } = await store.updateTargetReturning(target.id, { session_id: sessionId });
  if (error) throw new Error(error.message);
  ok(res, data);
}

/**
 * POST /api/self-study/:id/complete
 * Marks the learner's copy done. The session itself is completed by the
 * teaching engine; this just closes the assignment side so the teacher's
 * progress column moves.
 */
export async function complete(req, res) {
  const { data: target } = await store.targetByStudent(req.params.id, req.user.id, "id, grade, draft, status, submission");
  if (!target) return missing(res, "This assignment was not given to you");
  // Graded work is closed: a resubmission would sit under the old grade.
  if (target.grade != null) return res.status(409).json({ success: false, error: "This work has been graded — it can't be changed now" });
  // Handed in once already (another tab, a double tap): the first stays.
  if (target.status === "complete" && target.submission?.submittedAt) {
    return res.status(409).json({ success: false, error: "This work was already handed in — your teacher has it." });
  }
  const { data: brief } = await store.findAssignmentFields(req.params.id, "details, due_at");
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
  const { data: fileRows } = await store.filesForTarget(target.id);
  const files = (fileRows ?? []).map((f) => ({ id: f.id, name: f.name, size: f.size, mime: f.mime, kind: f.kind, ...(Number.isInteger(f.question_index) ? { question: f.question_index } : {}) }));
  const submittedAt = now();
  // Late work is accepted and marked late, so the teacher sees it.
  const submission = { text, answers, files, submittedAt, ...lateOf(submittedAt, brief?.due_at) };

  const { data, error } = await store.updateTargetReturning(target.id, { status: "complete", completed_at: now(), submission });
  if (error) throw new Error(error.message);

  // The submission as one PDF (+ markdown) — built and stored in the
  // background; then, when the activity has "AI auto-grade" on, the AI
  // drafts marks from it for the instructor to approve.
  // AI auto-grade: say "making" straight away, so a teacher who opens the
  // work while the PDF is still building sees the draft on its way.
  if (brief?.details?.ai_auto_grade) {
    await store.updateTarget(target.id, { ai_grade: { status: "making", at: now() } }).then(() => {}, () => {});
  }
  // Marking starts at once, in parallel with the PDF — the learner's score takes seconds, not the PDF's time.
  // With auto-grading on, the PDF is built AFTER the marking: three hand-ins at once used to build three PDFs
  // beside their marking and slow it (the learner's score doesn't need the PDF; the marker reads the answers).
  const buildCopies = () => buildSubmissionArtifacts(target.id)
    .catch((e) => console.warn("[self-study] post-submit build failed (built on first open):", String(e?.message || e).slice(0, 160)));
  if (brief?.details?.ai_auto_grade) {
    aiGradeTarget(target.id)
      .then((draft) => (draft && brief.details.ai_release !== "review" ? releaseAiGrade(target.id) : null))
      .catch((e) => console.warn("[self-study] instant marking failed:", String(e?.message || e).slice(0, 160)))
      .finally(buildCopies);
  } else buildCopies();
  // Event trigger: study work completed — fresh signal for the planner.
  emitAutonomyEvent(req.user.id, "self_study").catch(() => {});
  ok(res, data);
}
