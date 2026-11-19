/**
 * study-prep/materials-source.js — the db side of Study Prep's materials
 * tools (Grand Plan §8.8), injected into the harness as `syllabus.materials`
 * (materials-ops.js holds the rules). Everything is scoped to the learner:
 * their own folders, uploads and records only.
 *
 *   list / search / latestFolder        the learner's uploads (modules/materials/studySource.js)
 *   outlineFromDocuments                the folder's read topics, else an outline drafted from
 *                                       the files' text; saved as a documents outline
 *   request                             a Suggestions-inbox card asking for materials
 *   documentTopics                      a documents session's topics (folder topics, else its outline)
 */
import db from "../../../db.js";
import {
  folderMaterials, folderText, materialTopics, resolveMaterialsFolder, searchMaterials,
} from "../../materials/index.js";
import { documentsOutlineFor, draftOutlineFromText, saveDocumentsOutline } from "./syllabus-generator.js";

export const MATERIALS_REQUEST_TITLE = "Upload your syllabus or past questions for your study plan";

/**
 * The topics of a session planned from documents: the folder's read topics
 * (most-tested first), else the outline drafted from its files.
 */
export async function documentTopics({ folderId, learnerId }) {
  const topics = await materialTopics({ folderId, learnerId });
  if (topics.length) return topics;
  const outline = await documentsOutlineFor({ folderId, learnerId }).catch(() => null);
  return (outline?.topics || []).map((t) => ({ id: t.id, label: t.label, objectives: t.objectives || [], source: "documents" }));
}

/** syllabus.from_documents: reuse the folder's read topics; draft from the text only when there are none. */
export async function outlineFromDocuments({ learnerId, folderId, subject, classLevel, goal }, deps = {}) {
  const draft = deps.draft || draftOutlineFromText;
  const listed = await folderMaterials({ learnerId, folderId, limit: 25 });
  const recordIds = [...new Set(listed.items.flatMap((i) => i.records.map((r) => r.recordId)))];
  const folderName = listed.folder?.name || listed.items[0]?.folder || null;
  if (!recordIds.length) return { topics: [], recordIds, folderName };
  let topics = await materialTopics({ folderId, learnerId });
  let from = "structure";
  let model = null;
  if (!topics.length) {
    const earlier = await documentsOutlineFor({ folderId, learnerId });
    if (earlier?.topics?.length && earlier.grounding?.from === "content") {
      return { id: earlier.id, topics: earlier.topics, from: "content", recordIds, folderName, reused: true };
    }
    const text = await folderText({ learnerId, recordIds });
    if (text.length < 200) return { topics: [], recordIds, folderName };
    const drafted = await draft({ subject, classLevel, goal, text });
    topics = drafted.topics;
    model = drafted.model || null;
    from = "content";
  }
  const saved = await saveDocumentsOutline({ learnerId, folderId, subject, classLevel, topics, recordIds, from, model });
  return { id: saved.id, topics, from, recordIds, folderName };
}

/**
 * learner.request_materials: one card in the learner's Suggestions inbox
 * (agent_suggestions, kind conversation — accepting opens the chat to upload
 * in). An identical open ask is not added twice.
 */
export async function requestMaterials({ learnerId, reason }) {
  const { openTitles, normalizeTitle } = await import("../../agent-proposals/index.js");
  if ((await openTitles(learnerId)).has(normalizeTitle(MATERIALS_REQUEST_TITLE))) return { suggestionId: null, duplicate: true };
  const { data: agentRow } = await db.from("user_agents").select("id").eq("user_id", learnerId).maybeSingle();
  const { data, error } = await db.from("agent_suggestions").insert({
    user_id: learnerId, agent_id: agentRow?.id ?? null, kind: "conversation",
    title: MATERIALS_REQUEST_TITLE, rationale: String(reason || "").slice(0, 400) || null, source: "study_prep",
  }).select().single();
  if (error) throw error;
  global.io?.to(`user:${learnerId}`).emit("agent:suggestion", data);
  return { suggestionId: data.id };
}

/** The `materials` dependency the harness takes (createHarness → syllabus.materials). */
export const studyPrepMaterials = Object.freeze({
  list: ({ learnerId, folderId }) => folderMaterials({ learnerId, folderId }),
  search: (args) => searchMaterials(args),
  latestFolder: ({ learnerId }) => resolveMaterialsFolder({ learnerId }),
  outlineFromDocuments: (args) => outlineFromDocuments(args),
  request: (args) => requestMaterials(args),
});

/** The Study Prep states a session can still use new materials in. */
export const OPEN_SESSION_STATES = Object.freeze(["planning", "awaiting_confirmation", "topic_active", "replanning", "paused"]);

/**
 * PURE: which open session a chat upload belongs to — the one in the same
 * subject (canonical names, so "Bio" and "Biology" match), else the only open
 * session when the upload has no subject. → session row | null
 */
export function sessionForUpload(sessions = [], subject = null, canonical = (s) => String(s || "").trim().toLowerCase()) {
  const open = (sessions || []).filter((s) => s && OPEN_SESSION_STATES.includes(s.status));
  if (!open.length) return null;
  const want = subject ? canonical(subject) : null;
  if (want) return open.find((s) => canonical(s.subject) === want) || null;
  return open.length === 1 ? open[0] : null;
}

/**
 * Chat uploads → Study Prep (§8.8): files the learner adds in chat join their
 * open Study Prep session in that subject, so the agent's materials tools
 * (materials.list / materials.search / syllabus.from_documents) see them.
 * Best effort: never fails the upload. → { sessionId, added } | null
 */
export async function attachUploadsToStudyPrep({ learnerId, subject = null, recordIds = [] }) {
  const ids = [...new Set((recordIds || []).map(String))].filter(Boolean);
  if (!learnerId || !ids.length) return null;
  try {
    const { canonicalSubject } = await import("../../materials/index.js");
    const { data: sessions } = await db.schema("edu").from("study_prep_sessions")
      .select("id, subject, status, material_record_ids").eq("learner_id", learnerId)
      .in("status", OPEN_SESSION_STATES).order("updated_at", { ascending: false }).limit(10);
    const session = sessionForUpload(sessions || [], subject, (s) => (canonicalSubject(s) || String(s || "")).trim().toLowerCase());
    if (!session) return null;
    const merged = [...new Set([...(session.material_record_ids || []), ...ids])].slice(-50);
    const added = merged.length - (session.material_record_ids || []).length;
    if (added <= 0) return { sessionId: session.id, added: 0 };
    const { error } = await db.schema("edu").from("study_prep_sessions").update({ material_record_ids: merged }).eq("id", session.id).eq("learner_id", learnerId);
    return error ? null : { sessionId: session.id, added };
  } catch (e) {
    console.warn("[study-prep] uploads not attached:", e?.message || e);
    return null;
  }
}
