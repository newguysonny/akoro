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

/* ── Study Prep's materials tools (Grand Plan §8.8) ─────────────────────────── */

/**
 * The learner's uploads in one folder (or their newest, without one) and how
 * far each file is read — what materials.list shows the agent. Their own only.
 * → { folder: { id, name } | null, items: [{ ingestId, folderId, folder, docKind, subject, pages, state, records: [{ recordId, name, read }] }] }
 */
export async function folderMaterials({ learnerId, folderId = null, limit = 10 }) {
  if (folderId && !UUID.test(String(folderId))) return { folder: null, items: [] };
  let q = edu().from("material_ingests").select("id, record_ids, folder_id, folder_name, doc_kind, subject, pages, state, created_at")
    .eq("user_id", learnerId).neq("state", "undone");
  if (folderId) q = q.eq("folder_id", folderId);
  const { data } = await q.order("created_at", { ascending: false }).limit(Math.max(1, Math.min(Number(limit) || 10, 25)));
  const ingests = data || [];
  const ids = [...new Set(ingests.flatMap((i) => i.record_ids || []))].slice(0, 60);
  const [recs, chunks] = ids.length ? await Promise.all([
    edu().from("records").select("id, name").eq("user_id", learnerId).in("id", ids).is("deleted_at", null),
    // Read = its text is in the library index (a name-only row is not reading).
    edu().from("record_chunks").select("record_id").eq("user_id", learnerId).in("record_id", ids).neq("kind", "name").limit(1000),
  ]) : [{ data: [] }, { data: [] }];
  const names = new Map((recs.data || []).map((r) => [r.id, r.name]));
  const read = new Set((chunks.data || []).map((c) => c.record_id));
  const items = ingests.map((i) => ({
    ingestId: i.id, folderId: i.folder_id || null, folder: i.folder_name || null, docKind: i.doc_kind || null,
    subject: i.subject || null, pages: i.pages ?? null, state: i.state,
    records: (i.record_ids || []).filter((id) => names.has(id)).map((id) => ({ recordId: id, name: String(names.get(id) || "").slice(0, 120), read: read.has(id) })),
  })).filter((i) => i.records.length);
  return { folder: folderId ? { id: folderId, name: ingests[0]?.folder_name || null } : null, items };
}

/** The record ids of a folder's uploads (their own, not undone). */
export async function folderRecordIds({ learnerId, folderId }) {
  const { items } = await folderMaterials({ learnerId, folderId, limit: 25 });
  return [...new Set(items.flatMap((i) => i.records.map((r) => r.recordId)))];
}

/**
 * materials.search: the Records hybrid search, kept to these records. The
 * library search is per learner; a folder's files are filtered out of it (and,
 * for a small folder, each file is searched on its own so none is crowded out).
 * → [{ recordId, name, page, snippet }]
 */
export async function searchMaterials({ learnerId, folderId = null, recordIds = null, query, limit = 6 }, deps = {}) {
  const ids = new Set(recordIds?.length ? recordIds : (folderId ? await folderRecordIds({ learnerId, folderId }) : []));
  if (!ids.size || !String(query || "").trim()) return [];
  const search = deps.search || (await import("../records/index.js")).searchRecordChunks;
  const hits = (await search({ userId: learnerId, q: query, limit: 25 })).filter((h) => ids.has(h.recordId));
  if (hits.length < limit && ids.size <= 3) {
    for (const recordId of ids) {
      for (const h of await search({ userId: learnerId, q: query, limit: 4, recordId })) {
        if (!hits.some((x) => x.recordId === h.recordId && x.snippet === h.snippet)) hits.push(h);
      }
    }
  }
  return hits.sort((a, b) => (b.fused || 0) - (a.fused || 0)).slice(0, limit)
    .map((h) => ({ recordId: h.recordId, name: h.name, page: h.pageNumber ?? null, snippet: h.snippet }));
}

/** The text of a folder's files (first pages first), for drafting an outline when they have no topic list. */
export async function folderText({ learnerId, recordIds, maxChars = 12_000 }) {
  if (!recordIds?.length) return "";
  const { data } = await edu().from("record_chunks").select("record_id, page_number, chunk_text")
    .eq("user_id", learnerId).in("record_id", recordIds.slice(0, 20)).neq("kind", "name")
    .order("page_number", { ascending: true, nullsFirst: false }).limit(60);
  let out = "";
  for (const c of data || []) {
    if (out.length >= maxChars) break;
    out += `${String(c.chunk_text || "").slice(0, 1200)}\n\n`;
  }
  return out.slice(0, maxChars).trim();
}
