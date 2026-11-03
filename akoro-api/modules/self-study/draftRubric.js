/**
 * modules/self-study/draftRubric.js — the rubric of an assignment draft's version, written in the
 * background and editable, like the questions it belongs to.
 *
 *   version.rubric = { status: drafting|ready|failed, scheme, note, error, edited, digest, startedAt, readyAt }
 *
 * `digest` fingerprints the questions the scheme was written for: when the teacher edits them, the
 * preview offers to rewrite it (rubricView().stale) but never throws it away. Writes go through the
 * same per-draft lock as the versions themselves.
 */
import db from "../../db.js";
import { updateDraftPayload, versionAt, versionsOf } from "./draftVersions.js";
import { draftMarkScheme, cleanMarkScheme, paperDigest, isRubricJobStale, RUBRIC_JOB_MS } from "./markScheme.js";

const iso = () => new Date().toISOString();
const classLevelOf = (draft) => String(draft?.audience?.class_name || draft?.audience?.label || "").split(" + ")[0].slice(0, 60) || null;

/**
 * Mark a version's rubric as being written. `request` improves the scheme that is there (kept on screen
 * meanwhile); without one it is written fresh. → true when a job should start (false: nothing to do or
 * one is already running).
 */
export async function beginRubric(draftId, n, { request = null } = {}) {
  let started = false;
  await updateDraftPayload(draftId, (p, row) => {
    if (row.status !== "draft") return null;
    const i = versionsOf(p).findIndex((x) => x.n === Number(n));
    const v = p.versions?.[i];
    if (!v || v.status !== "ready" || !v.paper) return null;
    if (v.rubric?.status === "drafting" && !isRubricJobStale(v.rubric)) return null;
    p.versions[i] = { ...v, rubric: { ...(request ? v.rubric : {}), status: "drafting", startedAt: iso(), request: request || null, error: null } };
    started = true;
    return p;
  });
  return started;
}

/** Write the rubric for one version. Never throws: a failure is written onto the rubric for a retry. */
export async function runMarkSchemeJob(draftId, n, { chat }) {
  let startedAt = null;
  const work = (async () => {
    const { data: draft } = await db.from("activity_drafts").select("*").eq("id", draftId).maybeSingle();
    if (!draft || draft.status !== "draft") return;
    const payload = draft.payload || {};
    const v = versionAt(payload, n);
    if (!v?.paper || v.rubric?.status !== "drafting") return;
    startedAt = v.rubric.startedAt || null;
    const request = v.rubric.request || null;
    const r = await draftMarkScheme({
      chat, paper: v.paper, topic: payload.topic || draft.topic, subject: payload.subject || draft.subject,
      classLevel: classLevelOf(draft), current: request ? v.rubric.scheme || null : null, request,
    });
    await updateDraftPayload(draftId, (p, row) => {
      if (row.status !== "draft") return null;
      const i = versionsOf(p).findIndex((x) => x.n === Number(n));
      const cur = p.versions?.[i]?.rubric;
      // Only the job that is still waiting takes the result (a newer one, or the teacher's own save, keeps its state).
      if (i < 0 || cur?.status !== "drafting" || (startedAt && cur.startedAt !== startedAt)) return null;
      p.versions[i] = { ...p.versions[i], rubric: { status: "ready", scheme: r.scheme, note: r.note, digest: paperDigest(p.versions[i].paper), edited: false, readyAt: iso() } };
      return p;
    });
  })();
  const deadline = new Promise((_, rej) => { const t = setTimeout(() => rej(new Error("Writing the rubric took too long.")), RUBRIC_JOB_MS); t.unref?.(); });
  try {
    await Promise.race([work, deadline]);
  } catch (e) {
    console.error(`[draft-rubric] ${draftId} v${n} failed:`, String(e?.message || e).slice(0, 200));
    await updateDraftPayload(draftId, (p) => {
      const i = versionsOf(p).findIndex((x) => x.n === Number(n));
      const cur = p.versions?.[i]?.rubric;
      if (i < 0 || cur?.status !== "drafting") return null;
      p.versions[i] = { ...p.versions[i], rubric: { ...cur, status: "failed", error: String(e?.message || "Could not write the rubric.").slice(0, 200) } };
      return p;
    }).catch(() => {});
  }
}

/** The teacher's edits to a version's rubric: cleaned against its questions (marks re-fitted), saved in place. */
export async function saveRubric(draftId, n, scheme) {
  let saved = null;
  await updateDraftPayload(draftId, (p) => {
    const i = versionsOf(p).findIndex((x) => x.n === Number(n));
    const v = p.versions?.[i];
    if (!v || v.status !== "ready" || !v.paper) { const e = new Error(`Version ${n} is not ready.`); e.status = 409; throw e; }
    if (!scheme || typeof scheme !== "object" || !Array.isArray(scheme.criteria)) { const e = new Error("A rubric needs criteria."); e.status = 400; throw e; }
    const clean = cleanMarkScheme(scheme, v.paper);
    saved = { status: "ready", scheme: clean, note: "Edited by you.", digest: paperDigest(v.paper), edited: true, readyAt: v.rubric?.readyAt || iso(), editedAt: iso() };
    p.versions[i] = { ...v, rubric: saved };
    return p;
  });
  return saved;
}
