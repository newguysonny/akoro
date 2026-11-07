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
} from "../../materials/studySource.js";
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
  const { openTitles, normalizeTitle } = await import("../../agent-proposals/inbox.js");
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
