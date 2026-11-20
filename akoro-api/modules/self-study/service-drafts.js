/**
 * modules/self-study/service-drafts.js — AI activity drafts (prepare → preview
 * → assign), their question versions, rubrics and settings, plus recurring
 * draft routines. Only the human-facing endpoints here can assign; the agent
 * only prepares (via the prepare_activity chat tool).
 */
import {
  createActivityDraft, assignActivityDraft,
  listActivityDrafts, getActivityDraft, updateActivityDraft, discardActivityDraft,
  saveDraftVersion, retryDraftVersion, restoreDraftHistory, classroomName, prepareReviewQuestions,
  setAssignmentSettings, generateVersionRubric, saveVersionRubric,
} from "./drafts.js";
import { rubricView } from "./markScheme.js";
import {
  listRoutines, createRoutine, updateRoutine, deleteRoutine,
} from "./routines.js";
import { ok, bad, denied, missing } from "./http.js";

/* ── Draft routines — recurring, human-approved preparation ────────────────
   The scheduler only PREPARES drafts at the slot; the instructor assigns each
   occurrence. Declared before /:id so "routines" is never an assignment id. */

/** GET /api/self-study/routines — my weekly routines. */
export async function listRoutine(req, res) {
  ok(res, { routines: await listRoutines(req.user) });
}

/** POST /api/self-study/routines — schedule a recurring prepare. */
export async function createRoutineHandler(req, res) {
  try { ok(res, { routine: await createRoutine(req.user, req.body) }); }
  catch (e) {
    if (e.status === 400 || e.message === "audience_required") return bad(res, e.message === "audience_required" ? "Say who each occurrence is for" : e.message);
    throw e;
  }
}

/** PATCH /api/self-study/routines/:id — pause or resume. */
export async function updateRoutineHandler(req, res) {
  try { ok(res, { routine: await updateRoutine(req.user, req.params.id, req.body) }); }
  catch (e) {
    if (e.status === 404) return missing(res, e.message);
    if (e.status === 403) return denied(res, e.message);
    if (e.status === 400) return bad(res, e.message);
    throw e;
  }
}

/** DELETE /api/self-study/routines/:id — cancel the routine. */
export async function deleteRoutineHandler(req, res) {
  try { ok(res, await deleteRoutine(req.user, req.params.id)); }
  catch (e) {
    if (e.status === 404) return missing(res, e.message);
    if (e.status === 403) return denied(res, e.message);
    throw e;
  }
}

/* ── AI activity drafts — human-in-the-loop ────────────────────────────────
   The agent PREPARES (via the prepare_activity chat tool); only these
   endpoints — hit by the human's preview UI — can assign. Declared before
   the /:id routes so "drafts" is never read as an assignment id. */

/** GET /api/self-study/drafts — my pending drafts (chat reload + badges). */
export async function listDrafts(req, res) {
  ok(res, { drafts: await listActivityDrafts(req.user) });
}

/** GET /api/self-study/drafts/:id — one draft for the preview panel. */
export async function getDraft(req, res) {
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
}

/**
 * PATCH /api/self-study/drafts/:id — human edits before assign (the preview's
 * Edit flow), or the battle completion bookkeeping when the shared battle
 * form created the battle from this draft.
 */
export async function patchDraft(req, res) {
  try { ok(res, { draft: await updateActivityDraft(req.user, req.params.id, req.body) }); }
  catch (e) {
    if (e.status === 404) return missing(res, e.message);
    if (e.status === 403) return denied(res, e.message);
    if (e.status === 409 || e.status === 400) return bad(res, e.message);
    throw e;
  }
}

/**
 * POST /api/self-study/drafts/:id/assign — the approval. The only way an
 * AI-prepared activity reaches learners: replays the payload through the
 * same create path as the workbench (targets, notifications, live ding).
 * Body: optional human-edited overrides merged over the stored payload.
 */
export async function assignDraft(req, res) {
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
}

/* An assignment draft's question versions (V1, V2… — draftVersions.js). */
const draftError = (res, e) => {
  if (e.status === 404) return missing(res, e.message);
  if (e.status === 403) return denied(res, e.message);
  if ([400, 409].includes(e.status)) return bad(res, e.message);
  throw e;
};

/** PUT /api/self-study/drafts/:id/versions/:n — the teacher's edits to one version (saved in place, marked edited). */
export async function saveVersion(req, res) {
  try { ok(res, { version: await saveDraftVersion(req.user, req.params.id, req.params.n, req.body) }); }
  catch (e) { return draftError(res, e); }
}

/** PUT /api/self-study/drafts/:id/settings { ai_auto_grade?, answer_format?, version? } — an assignment's grading settings. */
export async function saveSettings(req, res) {
  try { ok(res, await setAssignmentSettings(req.user, req.params.id, req.body)); }
  catch (e) { return draftError(res, e); }
}

/** POST /api/self-study/drafts/:id/versions/:n/rubric { request? } — write a version's rubric, or improve it as asked. */
export async function writeVersionRubric(req, res) {
  try { ok(res, await generateVersionRubric(req.user, req.params.id, req.params.n, { request: req.body?.request })); }
  catch (e) { return draftError(res, e); }
}

/** PUT /api/self-study/drafts/:id/versions/:n/rubric { scheme } — the teacher's edits to a version's rubric. */
export async function editVersionRubric(req, res) {
  try { ok(res, { rubric: rubricView({ rubric: await saveVersionRubric(req.user, req.params.id, req.params.n, req.body?.scheme), paper: null }) }); }
  catch (e) { return draftError(res, e); }
}

/** POST /api/self-study/drafts/:id/versions/:n/retry — draft a failed version again. */
export async function retryVersion(req, res) {
  try { ok(res, { version: await retryDraftVersion(req.user, req.params.id, req.params.n) }); }
  catch (e) { return draftError(res, e); }
}

/** POST /api/self-study/drafts/:id/review-questions { count } — write the review battle's questions for this draft. */
export async function reviewQuestions(req, res) {
  try { ok(res, { review_questions: await prepareReviewQuestions(req.user, req.params.id, req.body?.count) }); }
  catch (e) { return draftError(res, e); }
}

/** POST /api/self-study/drafts/:id/history/:n/restore — go back to one round of a non-assignment draft. */
export async function restoreHistory(req, res) {
  try { ok(res, { draft: await restoreDraftHistory(req.user, req.params.id, req.params.n) }); }
  catch (e) { return draftError(res, e); }
}

/** DELETE /api/self-study/drafts/:id — discard a pending draft. */
export async function discardDraft(req, res) {
  try { ok(res, { draft: await discardActivityDraft(req.user, req.params.id) }); }
  catch (e) {
    if (e.status === 404) return missing(res, e.message);
    if (e.status === 403) return denied(res, e.message);
    if (e.status === 409) return bad(res, e.message);
    throw e;
  }
}
