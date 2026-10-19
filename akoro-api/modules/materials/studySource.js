/**
 * modules/materials/studySource.js — the db side of a folder as Study Prep's
 * syllabus (Grand Plan §7.17.3, D54). The learner's own folder and uploads
 * only (D53); see studySourceCore.js for the rules.
 *
 *   materialTopics({ folderId, learnerId })          the folder's topics, most-tested first
 *   materialQuestions({ folderId, learnerId, topic }) its past-paper questions on one topic
 *   resolveMaterialsFolder({ learnerId, folder, conversationId })  which folder "this paper" means
 */
import db from "../../db.js";
import { folderTopics, questionsForTopic } from "./studySourceCore.js";

const edu = () => db.schema("edu");
const UUID = /^[0-9a-f-]{36}$/i;

async function folderIngests(folderId, learnerId) {
  if (!UUID.test(String(folderId || ""))) return [];
  const { data } = await edu().from("material_ingests").select("id, doc_kind, subject, structure, state")
    .eq("user_id", learnerId).eq("folder_id", folderId).neq("state", "undone").not("structure", "is", null).limit(50);
  return data || [];
}

async function folderQuestions(ingestIds, learnerId) {
  if (!ingestIds.length) return [];
  const { data } = await edu().from("material_questions").select("ingest_id, exam, year, number, marks, topic, text")
    .eq("user_id", learnerId).in("ingest_id", ingestIds).limit(2000);
  return data || [];
}

export async function materialTopics({ folderId, learnerId }) {
  const ingests = await folderIngests(folderId, learnerId);
  return folderTopics({ ingests, questions: await folderQuestions(ingests.map((i) => i.id), learnerId) });
}

export async function materialQuestions({ folderId, learnerId, topic }) {
  const ingests = await folderIngests(folderId, learnerId);
  return questionsForTopic(await folderQuestions(ingests.map((i) => i.id), learnerId), topic);
}

/**
 * "Make a study plan from this paper": the folder of the newest read upload in
 * this chat, else the learner's newest, else a folder they named. Only their
 * own. → { folderId, name, subject } | null
 */
export async function resolveMaterialsFolder({ learnerId, folder = null, conversationId = null }) {
  const name = String(folder || "").trim();
  if (name) {
    const { data } = await edu().from("library_folders").select("id, name").eq("user_id", learnerId).ilike("name", `%${name.replace(/[%_]/g, "")}%`).limit(1).maybeSingle();
    if (data) {
      const ing = (await folderIngests(data.id, learnerId))[0];
      return { folderId: data.id, name: data.name, subject: ing?.subject || null };
    }
  }
  const pick = async (scope) => {
    let q = edu().from("material_ingests").select("folder_id, folder_name, subject").eq("user_id", learnerId)
      .neq("state", "undone").not("structure", "is", null).not("folder_id", "is", null);
    if (scope) q = q.eq("chat_session_id", scope);
    const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
    return data ? { folderId: data.folder_id, name: data.folder_name, subject: data.subject || null } : null;
  };
  return (UUID.test(String(conversationId || "")) ? await pick(conversationId) : null) || await pick(null);
}
