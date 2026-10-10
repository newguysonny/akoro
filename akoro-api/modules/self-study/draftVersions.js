/**
 * modules/self-study/draftVersions.js — an assignment draft's questions,
 * one VERSION per round with the AI.
 *
 *   V1  the teacher's request in chat ("5 questions on photosynthesis,
 *       3 MCQ, 2 direct theory") — built in the background, never inside
 *       the chat turn
 *   V2… each follow-up ("make Q4 harder, add a diagram question") starts
 *       from the latest version — the teacher's own edits included — or
 *       from the one they name, and changes only what was asked
 *
 * The preview shows the versions as tabs; Assign sends the one on screen.
 * The teacher's edits change the version they're on (marked `edited`);
 * only AI rounds make new versions. At most MAX_VERSIONS per draft.
 *
 * Versions live in the draft's payload:
 *   payload.versions = [{ n, status: drafting|ready|failed, request, basedOn,
 *     note, warning, error, changes, edited, paper, summary, createdAt, readyAt }]
 */
import db from "../../db.js";
import { cleanPaperDetails } from "./paperLayout.js";
import { draftPaper, revisePaper, summarizePaper, describePlan, mergePlan, parseQuestionRequest, MAX_VERSIONS } from "./questionPaper.js";

export { MAX_VERSIONS };
const VERSION_TIMEOUT_MS = 170_000;   // two bounded model calls (45s ×1 retry each) and the writes

/* ── One writer per draft at a time ───────────────────────────────────────
   The plan enrichment and a version job can finish together; both
   read-modify-write the payload. Chaining them per draft keeps either from
   overwriting the other. */
const locks = new Map();
export function withDraftLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  const tail = next.catch(() => {});
  locks.set(id, tail);
  tail.then(() => { if (locks.get(id) === tail) locks.delete(id); });
  return next;
}

/** Read the draft, change its payload, write it back — under the lock. */
export function updateDraftPayload(id, change) {
  return withDraftLock(id, async () => {
    const { data: row, error } = await db.from("activity_drafts").select("status, payload").eq("id", id).maybeSingle();
    if (error || !row) throw new Error(error?.message || "draft no longer readable");
    const payload = change(structuredClone(row.payload || {}), row);
    if (!payload) return row.payload;
    const { error: uErr } = await db.from("activity_drafts").update({ payload }).eq("id", id);
    if (uErr) throw new Error(uErr.message);
    return payload;
  });
}

/** A version still "drafting" this long after it started was cut off (a restart mid-job). */
export const STALE_DRAFTING_MS = VERSION_TIMEOUT_MS + 60_000;
export const isStaleDrafting = (v, now = Date.now()) =>
  v?.status === "drafting" && (!v.createdAt || now - Date.parse(v.startedAt || v.createdAt) > STALE_DRAFTING_MS);

/** Mark cut-off versions failed, so Try again works. → the payload, or null when nothing changed. */
export function expireStaleVersions(payload, now = Date.now()) {
  const list = Array.isArray(payload?.versions) ? payload.versions : [];
  if (!list.some((v) => isStaleDrafting(v, now))) return null;
  return {
    ...payload,
    versions: list.map((v) => (isStaleDrafting(v, now) ? { ...v, status: "failed", error: "Drafting was interrupted — try again." } : v)),
  };
}

export const versionsOf = (payload) => (Array.isArray(payload?.versions) ? payload.versions : []);
export const latestReady = (payload) => [...versionsOf(payload)].reverse().find((v) => v.status === "ready") || null;
export const versionAt = (payload, n) => versionsOf(payload).find((v) => v.n === Number(n)) || null;

/** A new version row (not yet written). */
export function newVersion(payload, { request, basedOn = null }) {
  const list = versionsOf(payload);
  if (list.length >= MAX_VERSIONS) {
    const e = new Error(`This draft already has ${MAX_VERSIONS} versions — assign one, or start a fresh draft.`);
    e.status = 409;
    throw e;
  }
  return { n: (list.at(-1)?.n || 0) + 1, status: "drafting", request: String(request || "").slice(0, 1500), basedOn, createdAt: new Date().toISOString() };
}

/** The class the work is for, as the model should pitch it ("JSS 2"). */
const classLevelOf = (draft) => String(draft?.audience?.class_name || draft?.audience?.label || "").split(" + ")[0].slice(0, 60) || null;

/**
 * Build one version in the background. Never throws: a failure is written
 * onto the version ("failed" + why) for the preview to offer a retry.
 */
export async function runVersionJob(draftId, n, { chat }) {
  let startedAt = null;
  const work = (async () => {
    const { data: draft } = await db.from("activity_drafts").select("*").eq("id", draftId).maybeSingle();
    if (!draft || draft.status !== "draft") return;
    const payload = draft.payload || {};
    const v = versionAt(payload, n);
    if (!v || v.status !== "drafting") return;
    startedAt = v.startedAt || null;
    const common = { chat, topic: payload.topic || draft.topic, subject: payload.subject || draft.subject, classLevel: classLevelOf(draft) };
    let out;
    if (v.basedOn) {
      const base = versionAt(payload, v.basedOn);
      if (!base?.paper) throw new Error(`Version ${v.basedOn} isn't ready to build on.`);
      const r = await revisePaper({ ...common, request: v.request, base: base.paper });
      out = { paper: r.paper, changes: r.changes, note: r.note || "Revised as asked.", warning: r.warning };
    } else {
      const r = await draftPaper({ ...common, request: v.request, plan: payload.paper_request?.plan || null, difficulty: payload.difficulty || null });
      out = { paper: r.paper, changes: {}, note: describePlan(r.plan) ? `First draft — ${describePlan(r.plan)} as asked.` : "First draft.", warning: r.warning };
    }
    const paper = cleanPaperDetails(out.paper);
    await updateDraftPayload(draftId, (p, row) => {
      if (row.status !== "draft") return null;
      const i = versionsOf(p).findIndex((x) => x.n === n);
      // Only a version still waiting takes the result: one that timed out
      // (failed) or was started again keeps its own state.
      if (i < 0 || p.versions[i].status !== "drafting" || (startedAt && p.versions[i].startedAt && p.versions[i].startedAt !== startedAt)) return null;
      p.versions[i] = { ...p.versions[i], status: "ready", paper, summary: summarizePaper(paper), note: out.note, warning: out.warning || null, changes: out.changes || {}, error: null, readyAt: new Date().toISOString() };
      return p;
    });
  })();
  const deadline = new Promise((_, rej) => { const t = setTimeout(() => rej(new Error("Drafting took too long.")), VERSION_TIMEOUT_MS); t.unref?.(); });
  try {
    await Promise.race([work, deadline]);
  } catch (e) {
    console.error(`[draft-versions] ${draftId} v${n} failed:`, String(e?.message || e).slice(0, 200));
    await updateDraftPayload(draftId, (p) => {
      const i = versionsOf(p).findIndex((x) => x.n === n);
      if (i < 0 || p.versions[i].status !== "drafting") return null;
      p.versions[i] = { ...p.versions[i], status: "failed", error: String(e?.message || "Could not draft the questions.").slice(0, 200) };
      return p;
    }).catch(() => {});
  }
}

/** The plan the first version is held to — stored with the draft. */
export function paperRequestFrom(input) {
  const request = String(input?.question_request || "").trim().slice(0, 1500);
  const plan = input?.question_plan && typeof input.question_plan === "object" ? input.question_plan : null;
  return { request, plan, parsed: mergePlan(parseQuestionRequest(request), plan) };
}

/** The teacher's edits to one version: cleaned, saved in place, marked edited. */
export function editedVersion(v, body) {
  if (!v) { const e = new Error("No such version."); e.status = 404; throw e; }
  if (v.status !== "ready") { const e = new Error(`Version ${v.n} is still being drafted.`); e.status = 409; throw e; }
  const qs = Array.isArray(body?.questions) ? body.questions.slice(0, 30) : null;
  if (!qs || !qs.length) { const e = new Error("A version needs at least one question."); e.status = 400; throw e; }
  const paper = cleanPaperDetails({
    instructions: String(body.instructions ?? v.paper?.instructions ?? "").trim().slice(0, 300),
    questions: qs, sections: body.sections, passages: body.passages,
  });
  return { ...v, paper, summary: summarizePaper(paper), edited: true, editedAt: new Date().toISOString() };
}

/** What assigning a version puts into the assignment's details. */
export function detailsFromVersion(details, v) {
  const p = v.paper || {};
  const total = summarizePaper(p).totalPoints;
  return {
    ...(details || {}),
    questions: p.questions || [],
    ...(p.sections ? { sections: p.sections } : {}),
    ...(p.passages ? { passages: p.passages } : {}),
    total_points: total,
    ai_auto_allocate_points: false,
    ai_auto_grade: !!details?.ai_auto_grade,
    question_types: [...new Set((p.questions || []).map((q) => q.type).filter(Boolean))],
    version: v.n,
  };
}
