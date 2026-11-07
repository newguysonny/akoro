/**
 * study-prep/materials-ops.js — Grand Plan §8.8 (D33): the learner's own
 * files in a Study Prep session, as harness operations.
 *
 *   materials.list                  read     the session's materials and how far each is read
 *   materials.search({ query })     read     search inside them (the Records search, scoped)
 *   syllabus.from_documents         execute  an outline from the files, saved as a labelled
 *                                            documents outline (edu.generated_syllabi, source
 *                                            'documents'); the session plans against it
 *   learner.request_materials       propose  ask the learner once for a syllabus or past
 *                                            questions — a Suggestions-inbox card, then wait
 *
 * Owner only: every operation loads the session through `ownedSession`, so a
 * learner's agent never sees or changes another learner's session or files.
 * The db side is injected (`materials`, see materials-source.js), so the
 * contract tests run without a database or a model.
 *
 *   materials.list({ learnerId, folderId, recordIds })      → { folder, items }
 *   materials.search({ learnerId, folderId, recordIds, query, limit }) → [{ recordId, name, page, snippet }]
 *   materials.latestFolder({ learnerId })                    → { folderId, name, subject } | null
 *   materials.outlineFromDocuments({ learnerId, folderId, subject, classLevel, goal })
 *                                                            → { id, topics, from, recordIds, folderName }
 *   materials.request({ learnerId, reason, goal, subject, sessionId }) → { suggestionId, duplicate? }
 */
import { HarnessRejection } from "../../agent-runtime/harness.js";

export const DOCUMENTS_OUTLINE_LABEL = "Outline drawn from your files";
export const MATERIALS_REQUESTED_NARRATIVE = "I asked for your syllabus or past questions — upload them in the chat, or tell me to draft an outline instead.";

const clip = (value, max) => String(value ?? "").replace(/[\r\n\x00]+/g, " ").trim().slice(0, max);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The label a plan made from the learner's files carries (§8.8: "Outline drawn from your files: …"). */
export const documentsLabel = (name) => (name ? `${DOCUMENTS_OUTLINE_LABEL}: ${clip(name, 80)}` : DOCUMENTS_OUTLINE_LABEL);

/** Is this a non-curricular session (scholarship, competition, professional exam, own topic)? */
export const isNonCurricular = (session) => session?.goal_type === "non_curricular";

/**
 * syllabus.generate's extra rule for a non-curricular goal (§8.8): the learner
 * is asked for materials first (once). → null | { code, message }
 */
export function generateGate(session) {
  if (!isNonCurricular(session)) return null;
  if (session.materials_requested_at) return null;
  return {
    code: "materials_not_requested",
    message: "This goal isn't a school exam — check materials.list, then ask the learner once with learner.request_materials before drafting an outline",
  };
}

export function makeMaterialsOps({ store, materials, log, reject, check, ownedSession, now }) {
  const owned = async (sessionId, learnerId) => {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    return session;
  };
  const unavailable = (session, what) => reject(session, "tool_not_permitted", `${what} is not available`);
  // The session's own folder when it plans from documents; otherwise none yet.
  const sessionFolder = (session) => (session.syllabus_source === "documents" && session.syllabus_ref ? session.syllabus_ref : null);

  /** materials.list — the session's materials, else the learner's newest uploads (so the agent can offer them). */
  async function listMaterials({ sessionId, learnerId }) {
    const session = await owned(sessionId, learnerId);
    if (!materials?.list) return unavailable(session, "Materials");
    const folderId = sessionFolder(session);
    const listed = await materials.list({ learnerId, folderId, recordIds: session.material_record_ids || null });
    return {
      sessionUsesMaterials: Boolean(folderId),
      folder: listed?.folder || null,
      items: (listed?.items || []).slice(0, 20),
      ...(listed?.items?.length ? {} : { next: "No uploaded materials. For a non-school goal, ask once with learner.request_materials; otherwise plan from syllabus.resolve." }),
    };
  }

  /** materials.search({ query }) — passages from the session's materials (or the learner's newest folder). */
  async function searchMaterials({ sessionId, learnerId, query, limit = 6 }) {
    const session = await owned(sessionId, learnerId);
    if (!materials?.search) return unavailable(session, "Materials search");
    const q = clip(query, 200);
    if (q.length < 2) return reject(session, "tool_schema_invalid", "Give the search a word or two to look for");
    let folderId = sessionFolder(session);
    if (!folderId && !(session.material_record_ids || []).length && materials.latestFolder) {
      folderId = (await materials.latestFolder({ learnerId }))?.folderId || null;
    }
    const passages = await materials.search({ learnerId, folderId, recordIds: session.material_record_ids || null, query: q, limit: Math.max(1, Math.min(Number(limit) || 6, 10)) });
    return { query: q, count: passages.length, passages };
  }

  /**
   * syllabus.from_documents — build the outline from the learner's files and
   * plan against it. Reuses the folder's read topics (material structure);
   * when the files have none, the outline is drafted from their text.
   */
  async function syllabusFromDocuments({ sessionId, learnerId, folderId = null, intent = null }) {
    const session = await owned(sessionId, learnerId);
    await check("syllabus_from_documents", { session });
    if (!materials?.outlineFromDocuments) return unavailable(session, "Outlines from documents");
    let folder = sessionFolder(session);
    let folderName = null;
    if (!folder && folderId && UUID.test(String(folderId))) folder = folderId;
    if (!folder && materials.latestFolder) {
      const latest = await materials.latestFolder({ learnerId });
      folder = latest?.folderId || null;
      folderName = latest?.name || null;
    }
    if (!folder) return reject(session, "no_materials", "The learner has no uploaded materials — ask once with learner.request_materials, or plan from syllabus.resolve");
    const outline = await materials.outlineFromDocuments({ learnerId, folderId: folder, subject: session.subject, classLevel: session.class_level, goal: session.goal });
    if (!outline?.topics?.length) {
      return reject(session, "no_materials", "Their files haven't been read into topics yet — tell them it's still being read, or plan from syllabus.resolve");
    }
    const name = outline.folderName || folderName || null;
    const updated = await store.updateSessionConditional(session.id, session.status, {
      syllabus_source: "documents", syllabus_ref: folder,
      ...(outline.recordIds?.length ? { material_record_ids: outline.recordIds.slice(0, 50) } : {}),
      updated_at: now(),
    });
    if (!updated) return reject(session, "invalid_state_transition", "The session moved on — refresh and try again");
    await log(session.id, null, {
      eventType: "harness_decision", origin: "harness", decisionNode: "syllabus_resolved", agentIntent: intent,
      facts: { source: "documents", fromDocuments: true, from: outline.from || "structure", outlineId: outline.id || null, topicCount: outline.topics.length, folder: name, subject: session.subject },
      narrative: `Planning from your own files${name ? ` in “${clip(name, 80)}”` : ""} — ${DOCUMENTS_OUTLINE_LABEL.toLowerCase()}${outline.from === "content" ? ", drafted from what they say" : ""}.`,
    });
    return {
      source: "documents", label: documentsLabel(name), from: outline.from || "structure", outlineId: outline.id || null,
      topics: outline.topics.map((t) => ({ id: t.id, label: t.label, ...(t.papers ? { papers: t.papers, marks: t.marks } : {}) })),
    };
  }

  /**
   * learner.request_materials — ask once per session. The ask lands in the
   * learner's Suggestions inbox (agent_suggestions, the existing card) and in
   * the session's log; the step then waits for the learner.
   */
  async function requestMaterials({ sessionId, learnerId, reason = null, intent = null }) {
    const session = await owned(sessionId, learnerId);
    await check("request_materials", { session });
    if (session.materials_requested_at) {
      return reject(session, "materials_already_requested", "You already asked for materials in this session — wait for their reply, or draft with syllabus.generate if they said to");
    }
    if (!materials?.request) return unavailable(session, "Asking for materials");
    const why = clip(reason, 300) || `So I can build your study plan for "${clip(session.goal, 120)}" from the real syllabus.`;
    const asked = await materials.request({ learnerId, reason: why, goal: session.goal, subject: session.subject, sessionId: session.id });
    const updated = await store.updateSessionConditional(session.id, session.status, { materials_requested_at: now(), updated_at: now() });
    if (!updated) return reject(session, "invalid_state_transition", "The session moved on — refresh and try again");
    await log(session.id, null, {
      eventType: "harness_decision", origin: "harness", decisionNode: "materials_requested", agentIntent: intent,
      facts: { reason: why, suggestionId: asked?.suggestionId || null, duplicate: Boolean(asked?.duplicate) },
      narrative: MATERIALS_REQUESTED_NARRATIVE,
    });
    return { asked: true, suggestionId: asked?.suggestionId || null, waiting: true, next: "Tell the learner what you asked for and why, then call wait_for_learner." };
  }

  return { listMaterials, searchMaterials, syllabusFromDocuments, requestMaterials };
}
