/**
 * modules/self-study/draft-edits.js — the preview's writes after a draft
 * exists: a version's teacher edits, a failed version's retry, an
 * assignment's grading settings, and its rubric writes.
 */

import { invalid } from "./createAssignment.js";
import { retryToolVersion } from "./toolDrafts.js";
import { ANSWER_FORMATS } from "./answerFormat.js";
import {
  editedVersion, latestReady, runVersionJob, updateDraftPayload, versionAt, versionsOf,
} from "./draftVersions.js";
import { beginRubric, runMarkSchemeJob, saveRubric } from "./draftRubric.js";
import { autoRubric, questionChat, schemeChat } from "./draft-model.js";
import { getActivityDraft } from "./draft-records.js";

/* ── Versions: the teacher's edits and retries (the preview) ──────────── */

/** Save the teacher's edits to one version — in place, marked edited. */
export async function saveDraftVersion(instructor, id, n, body) {
  const draft = await getActivityDraft(instructor, id);
  if (draft.status !== "draft") throw invalid("Only pending drafts can be edited", 409);
  let saved = null;
  await updateDraftPayload(draft.id, (p) => {
    const i = versionsOf(p).findIndex((v) => v.n === Number(n));
    try { saved = editedVersion(p.versions?.[i], body); } catch (e) { throw invalid(e.message, e.status || 400); }
    p.versions[i] = saved;
    return p;
  });
  return saved;
}

/** Try a failed version again. */
export async function retryDraftVersion(instructor, id, n) {
  const draft = await getActivityDraft(instructor, id);
  if (draft.status !== "draft") throw invalid("Only pending drafts can be retried", 409);
  if (draft.type === "teaching_tool") return retryToolVersion(draft, n);
  const v = versionAt(draft.payload, n);
  if (!v) throw invalid("No such version", 404);
  if (v.status !== "failed") throw invalid(`Version ${v.n} didn't fail — nothing to retry.`, 409);
  await updateDraftPayload(draft.id, (p) => {
    const i = versionsOf(p).findIndex((x) => x.n === v.n);
    p.versions[i] = { ...p.versions[i], status: "drafting", error: null, startedAt: new Date().toISOString() };
    return p;
  });
  void runVersionJob(draft.id, v.n, { chat: questionChat(instructor.id), onReady: autoRubric(draft.id, instructor.id) });
  return { n: v.n, status: "drafting" };
}


/* ── Settings and the rubric (the preview's Settings and Rubric tabs) ───── */

/**
 * The grading settings of an assignment draft: { ai_auto_grade?, answer_format? } → saved on the draft.
 * Turning auto-grading on writes the rubric for the version on screen (`version`, else the newest ready one).
 * → { details, started }  (started: the version whose rubric is now being written, or null)
 */
export async function setAssignmentSettings(instructor, id, body = {}) {
  const draft = await getActivityDraft(instructor, id);
  if (draft.status !== "draft") throw invalid("Only pending drafts can be changed", 409);
  if (draft.type !== "assignment") throw invalid("Grading settings are for assignments", 400);
  const patch = {};
  if (body.ai_auto_grade !== undefined) patch.ai_auto_grade = !!body.ai_auto_grade;
  if (body.ai_release !== undefined) {
    if (!["instant", "review"].includes(body.ai_release)) throw invalid("ai_release must be instant or review", 400);
    patch.ai_release = body.ai_release;
  }
  if (body.answer_format !== undefined) {
    if (!ANSWER_FORMATS.includes(body.answer_format)) throw invalid(`answer_format must be one of ${ANSWER_FORMATS.join(", ")}`, 400);
    patch.answer_format = body.answer_format;
  }
  if (!Object.keys(patch).length) throw invalid("Nothing to change", 400);
  const payload = await updateDraftPayload(draft.id, (p) => ({ ...p, details: { ...(p.details || {}), ...patch } }));
  let started = null;
  if (patch.ai_auto_grade) {
    const v = body.version != null ? versionAt(payload, body.version) : latestReady(payload);
    if (v?.status === "ready" && !v.rubric?.scheme && (await beginRubric(draft.id, v.n))) {
      started = v.n;
      void runMarkSchemeJob(draft.id, v.n, { chat: schemeChat(instructor.id) });
    }
  }
  return { details: payload.details, started };
}

/** (Re)write one version's rubric — or improve it, when the teacher says how. → { n, status } */
export async function generateVersionRubric(instructor, id, n, { request = null } = {}) {
  const draft = await getActivityDraft(instructor, id);
  if (draft.status !== "draft") throw invalid("Only pending drafts can be changed", 409);
  const v = versionAt(draft.payload, n);
  if (!v) throw invalid("No such version", 404);
  if (v.status !== "ready") throw invalid(`Version ${v.n} is still being drafted.`, 409);
  const ask = String(request || "").trim().slice(0, 600) || null;
  if (!(await beginRubric(draft.id, v.n, { request: ask && v.rubric?.scheme ? ask : null }))) throw invalid("The rubric is already being written.", 409);
  void runMarkSchemeJob(draft.id, v.n, { chat: schemeChat(instructor.id) });
  return { n: v.n, status: "drafting" };
}

/** Save the teacher's edits to one version's rubric. → the saved rubric */
export async function saveVersionRubric(instructor, id, n, scheme) {
  const draft = await getActivityDraft(instructor, id);
  if (draft.status !== "draft") throw invalid("Only pending drafts can be edited", 409);
  try { return await saveRubric(draft.id, n, scheme); }
  catch (e) { throw invalid(e.message, e.status || 400); }
}
