/**
 * modules/self-study/service-files.js — learner submission attachments and
 * the paper/artifact routes: upload/open/remove a file, the assignment's paper
 * (teacher or assigned learner), a draft's preview paper, and the submission
 * as HTML / JSON / PDF / markdown plus the marked copy. Bytes stay in object
 * storage; the rows carry metadata only.
 */
import {
  SUBMISSION_FILE_LIMITS, sniffSubmissionFile, storeSubmissionFile, readSubmissionFile, isDrawingName, cropDrawing,
  removeSubmissionObject, contentDisposition,
} from "./submissionFiles.js";
import { answerFormatOf, fileRefusal } from "./answerFormat.js";
import { readSubmissionArtifact, loadSubmissionDocument, readMarkedCopy } from "./submissionArtifacts.js";
import { briefForLearner } from "./submissionView.js";
import { assignmentPaperHtml, submissionPaperHtml } from "./paperRender.js";
import { getActivityDraft } from "./drafts.js";
import { versionAt, latestReady } from "./draftVersions.js";
import { ok, bad, denied, missing } from "./http.js";
import { isTeacher } from "./rules.js";
import { ownedAssignment, myTargetOf, viewableTarget } from "./service-common.js";
import * as store from "./store-assignments.js";

/** POST /api/self-study/:id/files — learner uploads one attachment. */
export async function uploadFile(req, res) {
  const target = await myTargetOf(req.params.id, req.user.id);
  if (!target) return missing(res, "This assignment was not given to you");
  if (target.status === "complete") return bad(res, "Already submitted — files can't be added now");

  const { name, data, question } = req.body ?? {};
  const clean = typeof name === "string" ? name.trim().slice(0, 200) : "";
  // The question this file answers (assignments with questions): a real one,
  // up to PER_QUESTION files each. Without one it belongs to the submission.
  let qIndex = null;
  const { data: brief } = await store.findAssignmentFields(req.params.id, "details");
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

  const { count } = await store.countFiles(target.id, qIndex);
  if (qIndex !== null && (count ?? 0) >= SUBMISSION_FILE_LIMITS.PER_QUESTION) return bad(res, `At most ${SUBMISSION_FILE_LIMITS.PER_QUESTION} files per question`);
  if (qIndex === null && (count ?? 0) >= SUBMISSION_FILE_LIMITS.MAX_FILES) return bad(res, "At most 5 files per submission");

  // A whiteboard drawing is kept cropped to the handwriting (the paper shows the work, not the board).
  if (sniffed.format === "png" && isDrawingName(clean)) bytes = await cropDrawing(bytes);
  const stored = await storeSubmissionFile({ learnerId: req.user.id, targetId: target.id, name: clean, bytes, mime: sniffed.mime });
  const { data: file, error } = await store.insertFile({
    target_id: target.id, name: clean, mime: sniffed.mime, kind: sniffed.kind, size: bytes.length, question_index: qIndex, ...stored,
  });
  if (error) {
    if (stored.storage_key) void removeSubmissionObject(stored.storage_key, req.user.id);
    throw new Error(error.message);
  }
  ok(res, { id: file.id, name: file.name, size: file.size, mime: file.mime, kind: file.kind, question: file.question_index });
}

/** DELETE /api/self-study/files/:fileId — the owning learner removes a file.
 *  Only before submitting: once the target is complete the submission is the
 *  record the teacher grades, so it stays exactly as handed in. */
export async function deleteFile(req, res) {
  const { data: file } = await store.findFile(req.params.fileId, "id, target_id, storage_key");
  if (!file) return missing(res, "File not found");
  const { data: t } = await store.targetById(file.target_id, "student_id, status");
  if (!t || t.student_id !== req.user.id) return denied(res, "Not your file");
  if (t.status === "complete") return bad(res, "Already submitted — the teacher needs to see this file");
  await store.deleteFile(file.id);
  void removeSubmissionObject(file.storage_key, req.user.id);
  ok(res, { removed: true });
}

/** GET /api/self-study/files/:fileId — open (or ?download=1) one attachment:
 *  owning learner, or the teacher/school that owns the activity. */
export async function getFile(req, res) {
  const { data: file } = await store.findFile(req.params.fileId, "id, target_id, name, mime, storage_key, data");
  if (!file) return missing(res, "File not found");
  const seen = await viewableTarget(req, file.target_id);
  if (seen.error) return res.status(seen.status).json({ success: false, error: seen.status === 404 ? "File not found" : "Not your file" });

  const bytes = await readSubmissionFile(file);
  res.setHeader("Content-Type", file.mime || "application/octet-stream");
  res.setHeader("Content-Disposition", contentDisposition(file.name, req.query.download ? "attachment" : "inline"));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(bytes);
}

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
export async function assignmentPaper(req, res) {
  const id = req.params[0];
  let copy = ["student", "teacher", "both"].includes(req.query.copy) ? req.query.copy : "student";
  let { assignment, error } = isTeacher(req.user) ? await ownedAssignment(req, id) : { error: "forbidden" };
  if (error) {
    const t = await myTargetOf(id, req.user.id);
    if (!t) return res.status(error === "not_found" ? 404 : 403).json({ success: false, error: "Not yours to see" });
    const { data } = await store.findAssignment(id);
    assignment = { ...data, details: briefForLearner(data?.details, false) };
    copy = "student";
  }
  if (!(assignment.details?.questions || []).length) return bad(res, "This activity has no question paper");
  sendPaper(res, await assignmentPaperHtml(assignment, { copy, embed: !!req.query.embed }), `${assignment.title || "paper"}.html`);
}

/** GET /api/self-study/drafts/:id/paper.html?version=n&copy=&key=1&embed=1 —
 *  a chat draft's version as the paper (the preview, its download). */
export async function draftPaper(req, res) {
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
}

/** GET /api/self-study/targets/:targetId/submission.html?only=i&embed=1 — the
 *  submission as the paper template (one question when grading). */
export async function submissionHtml(req, res) {
  const seen = await viewableTarget(req, req.params[0]);
  if (seen.error) return res.status(seen.status).json({ success: false, error: seen.error });
  if (!seen.target.submission?.submittedAt) return bad(res, "Nothing has been submitted yet");
  const only = req.query.only != null && req.query.only !== "" && Number.isInteger(Number(req.query.only)) ? Number(req.query.only) : null;
  const html = await submissionPaperHtml(seen.target.id, { only, embed: !!req.query.embed });
  if (!html) return missing(res, "Not found");
  sendPaper(res, html, "submission.html");
}

/** GET /api/self-study/targets/:targetId/draft.html?embed=1 — my answers so far, before hand-in, laid out
 *  on the same paper template as the handed-in copy (the learner's "Review" step). Mine only. */
export async function draftHtml(req, res) {
  const seen = await viewableTarget(req, req.params[0]);
  if (seen.error) return res.status(seen.status).json({ success: false, error: seen.error });
  if (seen.target.student_id !== req.user.id) return denied(res, "Not yours to see");
  const html = await submissionPaperHtml(seen.target.id, { embed: !!req.query.embed, draft: true });
  if (!html) return missing(res, "Not found");
  sendPaper(res, html, "answers.html");
}

/** GET /api/self-study/targets/:targetId/submission.json — the submission as
 *  the paper template lays it out (paperSchema.js submissionDocument): the
 *  learner, answered / unanswered, each question with its answer, drawings
 *  and marks box. Marks only once published. */
export async function submissionJson(req, res) {
  const seen = await viewableTarget(req, req.params[0]);
  if (seen.error) return res.status(seen.status).json({ success: false, error: seen.error });
  if (!seen.target.submission?.submittedAt) return bad(res, "Nothing has been submitted yet");
  const doc = await loadSubmissionDocument(seen.target.id);
  if (!doc) return missing(res, "Not found");
  res.setHeader("Cache-Control", "private, no-cache");
  ok(res, { document: doc });
}

/** GET /api/self-study/targets/:targetId/submission.pdf (or .md) — the whole
 *  submission as one document. Built at submit; built now if it isn't there
 *  yet (or the learner resubmitted since). ?download=1 saves it. */
export async function submissionDocument(req, res) {
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
}

/** GET /api/self-study/targets/:targetId/marked.pdf — the submission with the
 *  grader's marks drawn in, opened by the grade page. The learner gets it
 *  once graded; the teacher can preview it any time. ?download=1 saves it. */
export async function markedPdf(req, res) {
  const seen = await viewableTarget(req, req.params[0]);
  if (seen.error) return res.status(seen.status).json({ success: false, error: seen.error });
  if (!seen.target.submission?.submittedAt) return bad(res, "Nothing has been submitted yet");
  const { data: full } = await store.targetById(seen.target.id, "id, student_id, grade, graded_at, markup, marked_pdf");
  const isLearner = seen.target.student_id === req.user.id;
  if (isLearner && full?.grade == null) return res.status(409).json({ success: false, error: "Your teacher hasn't graded this yet" });

  const bytes = await readMarkedCopy({ ...seen.target, ...full });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", contentDisposition("marked-submission.pdf", req.query.download ? "attachment" : "inline"));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-cache");
  res.send(bytes);
}
