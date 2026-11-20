/**
 * modules/records/study-material-store.js — where a study build's material
 * comes from: the learner's Library, the files of one chat, Discover's free
 * notes, and the notes they taught their agent. Every query is owner-scoped,
 * and a platform winner is copied into the learner's Library before it is
 * built from.
 */
import db from "../../db.js";
import { pagePassages } from "./toolsLib.js";
import { searchRecordChunks, searchPlatformChunks, indexRecord } from "./searchLib.js";
import { getExtraction } from "./extractLib.js";
import { escapeLike, rankContentHits, pickContentWinner, passagesFromExtraction, pickChatRecord, platformTerms, platformChunkScore, platformHelpfulSet, platformTopicName, taughtRecordName, taughtNotesText } from "./studyMaterialCore.js";
import { synthesiseGatheredText } from "./study-material-generate.js";
import { UUID } from "./study-material-shape.js";

/**
 * The read files of one chat, newest upload first — the candidates behind
 * "this material". The mechanism is the ingest pipeline's own: an ingest row
 * names its records (record_ids) and, once its read has run, carries what the
 * read found per file (structure.items, keyed by recordId) — the same rows
 * chatFilesBrief narrates from. Only files a read actually covered count
 * (an ingest can hold more files than one read covers), and only records
 * still live in the learner's Library. → [{ recordId, name, title, subject, topics }]
 */
async function chatReadRecords({ userId, conversationId }) {
  const E = db.schema("edu");
  const { data: rows } = await E.from("material_ingests")
    .select("record_ids, structure")
    .eq("user_id", userId).eq("chat_session_id", conversationId)
    .neq("state", "undone").not("structure", "is", null)
    .order("created_at", { ascending: false }).limit(10);
  const byRecord = new Map();
  for (const row of rows || []) {
    const items = Array.isArray(row.structure?.items) ? row.structure.items : [];
    for (const id of row.record_ids || []) {
      if (!UUID.test(String(id)) || byRecord.has(id)) continue;
      const it = items.find((x) => String(x?.recordId) === String(id)) || null;
      if (!it) continue; // saved in this chat, but no read covered it
      byRecord.set(id, {
        recordId: id, itemName: it.name || "", title: it.title || "", subject: it.subject || "",
        topics: (it.topics || []).map((t) => t?.name).filter(Boolean),
      });
    }
  }
  if (!byRecord.size) return [];
  const { data: recs } = await E.from("records").select("id, name")
    .eq("user_id", userId).is("deleted_at", null).in("id", [...byRecord.keys()]);
  const liveById = new Map((recs || []).map((r) => [r.id, r]));
  return [...byRecord.values()].filter((c) => liveById.has(c.recordId))
    .map((c) => ({ recordId: c.recordId, name: liveById.get(c.recordId).name || c.itemName || "Untitled",
      title: c.title, subject: c.subject, topics: c.topics }));
}

/* ── The platform tier (Discover) ───────────────────────────────────────────
   Reached only when the learner's own Library has nothing: the community's
   free notes — the records the Discover feed shows (uploads and pastes, not
   private, not deleted, never a Premium subscriber's, never the learner's
   own). Name first (the feed's own signal), then content. A winner is NOT
   built from directly: makeStudyMaterial first saves the learner their own
   copy (copyPlatformRecord), because reader access is owner-only — the
   artifact, its card and its dedupe all hang off a record the learner owns.
   The shared content key means the copy costs no re-upload and no re-parse:
   the extraction the owner paid for answers for both. */

async function platformOwners(E, rows) {
  const ids = [...new Set((rows || []).map((r) => r.user_id).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data: users } = await E.from("users").select("id, full_name").in("id", ids);
  return new Map((users || []).map((u) => [u.id, u.full_name || "Learner"]));
}

async function platformFind({ userId, q }) {
  const E = db.schema("edu");
  const { activePremiumUserIds } = await import("./access.js");
  const premium = await activePremiumUserIds().catch(() => []);
  const discoverable = (query) => {
    let x = query.eq("private", false).in("kind", ["upload", "paste"])
      .is("deleted_at", null).neq("user_id", userId);
    if (premium.length) x = x.not("user_id", "in", `(${premium.join(",")})`);
    return x;
  };
  // By name first — a free note actually called what the learner asked for.
  const { data: named } = await discoverable(E.from("records").select("id, name, user_id, kind, file_key"))
    .ilike("name", `%${escapeLike(q)}%`).order("created_at", { ascending: false }).limit(6);
  if (named?.length) {
    const owners = await platformOwners(E, named);
    const withOwners = named.map((r) => ({ ...r, ownerName: owners.get(r.user_id) || "Learner" }));
    if (withOwners.length === 1) {
      const r = withOwners[0];
      return { record: { id: r.id, name: r.name }, platform: { ownerId: r.user_id, ownerName: r.ownerName } };
    }
    // Several free notes carry the topic's name: all of them would help —
    // they become ONE gathered content (Matt, 2026-11-16), not a question.
    return { records: withOwners.slice(0, 5).map((r) => ({ id: r.id, name: r.name, ownerId: r.user_id, ownerName: r.ownerName, kind: r.kind, file_key: r.file_key || null })) };
  }
  // Then by what is inside: lexical chunk hits over Discover-eligible
  // records, scored by term coverage, ranked like the own-Library tier.
  const hits = await searchPlatformChunks({ userId, q, limit: 60 }).catch(() => []);
  if (!hits.length) return null;
  const terms = platformTerms(q);
  const ownersByRecord = new Map(hits.map((h) => [h.recordId, { ownerId: h.ownerId, ownerName: h.ownerName }]));
  const ranked = rankContentHits(hits.map((h) => ({ ...h, fused: platformChunkScore(h.text, terms) })));
  // One clear source builds alone; several that would help build together
  // from a folder (platformHelpfulSet) — the platform tier no longer asks
  // the learner to choose between near-equal free notes.
  const set = platformHelpfulSet(ranked);
  if (!set.length) return null;
  if (set.length === 1) {
    const rec = hits.find((h) => h.recordId === set[0].recordId);
    if (!rec) return null;
    return { record: { id: rec.recordId, name: rec.name },
      platform: { ownerId: rec.ownerId, ownerName: rec.ownerName } };
  }
  const { data: full } = await E.from("records").select("id, kind, file_key").in("id", set.map((e) => e.recordId));
  const fullById = new Map((full || []).map((r) => [r.id, r]));
  return { records: set.map((e) => {
    const h = hits.find((x) => x.recordId === e.recordId);
    const owner = ownersByRecord.get(e.recordId) || {};
    const f = fullById.get(e.recordId) || {};
    return { id: e.recordId, name: e.name || h?.name || "", ownerId: owner.ownerId || h?.ownerId || null, ownerName: owner.ownerName || h?.ownerName || null, kind: f.kind || null, file_key: f.file_key || null };
  }) };
}

/**
 * Save the learner their own copy of a Discover record, re-verifying the
 * discovery rule at copy time (a record made private, deleted or Premium
 * since the search must not be copied). The copy is private (it never
 * re-enters the feed as a duplicate) and points at the SAME file, so the
 * shared extraction answers for it; a paste copies its text. An existing
 * copy of the same file is reused, never duplicated.
 * → { record } | { error }
 */
export async function copyPlatformRecord({ userId, sourceId }) {
  const E = db.schema("edu");
  const { data: src } = await E.from("records")
    .select("id, user_id, kind, name, mime, size, duration, file_key, content, private")
    .eq("id", sourceId).is("deleted_at", null).maybeSingle();
  if (!src || src.user_id === userId || src.private || !["upload", "paste"].includes(src.kind)) {
    return { error: "That free note isn't available anymore — say so and offer another way." };
  }
  const { activePremiumUserIds } = await import("./access.js");
  const premium = await activePremiumUserIds().catch(() => []);
  if (premium.includes(src.user_id)) return { error: "That free note isn't available anymore — say so and offer another way." };
  if (src.kind === "upload" && src.file_key) {
    const { data: existing } = await E.from("records").select("id, name")
      .eq("user_id", userId).eq("file_key", src.file_key).is("deleted_at", null)
      .order("created_at", { ascending: true }).limit(1);
    if (existing?.[0]) return { record: existing[0] };
  }
  if (src.kind === "paste" && src.content) {
    // A paste copies its text verbatim, so an existing copy is recognisable
    // by name + identical content — reuse it, never duplicate it (an
    // explicit Discover re-ask used to stack identical copies).
    const { data: existing } = await E.from("records").select("id, name")
      .eq("user_id", userId).eq("kind", "paste").eq("name", src.name).eq("content", src.content)
      .is("deleted_at", null).order("created_at", { ascending: true }).limit(1);
    if (existing?.[0]) return { record: existing[0] };
  }
  const { count } = await E.from("records").select("id", { count: "exact", head: true })
    .eq("user_id", userId).is("deleted_at", null);
  if ((count || 0) >= 200) return { error: "Their Library shelf is full (200) — ask them to remove something before saving a copy of a free note." };
  const { data: copy, error } = await E.from("records").insert({
    user_id: userId, kind: src.kind, name: src.name,
    mime: src.mime || null, size: src.size || 0,
    duration: src.duration ?? null,
    file_key: src.kind === "upload" ? src.file_key : null,
    content: src.kind === "paste" ? src.content : null,
    private: true,
  }).select("id, name").single();
  if (error || !copy) return { error: "Couldn't save a copy of that free note to their Library — try again in a moment." };
  // The create route's indexing, mirrored: the name always, a paste's text
  // too. An upload copy needs no page chunks — generation reads the shared
  // extraction by content key. Fire-and-forget, like the route.
  void indexRecord({ userId, recordId: copy.id, name: copy.name, contentKey: src.file_key || null,
    pasteText: src.kind === "paste" ? src.content : null });
  return { record: copy };
}

/** Readable passages of ONE Discover source, server-side: an upload reads
 *  its shared extraction, a paste reads its own text. → [passage] */
async function gatherSourcePassages(source) {
  try {
    if (source.kind === "paste") {
      const E = db.schema("edu");
      const { data } = await E.from("records").select("content").eq("id", source.id).maybeSingle();
      const text = String(data?.content || "");
      return text ? pagePassages(1, { markdown: text }) : [];
    }
    if (source.file_key) {
      const ext = await getExtraction(source.file_key).catch(() => null);
      return passagesFromExtraction({ pages: ext?.pages || [], scope: "document" });
    }
    return [];
  } catch { return []; }
}

/**
 * Build the gathered content for a multi-source platform hit and save it as
 * ONE text record in the learner's Library. Sources are re-verified against
 * the discovery rule first (a note made private, deleted or Premium since
 * the search must not be gathered). The record is private — it is a
 * derivative of other learners' notes, not the learner's own upload.
 * → { record, sources: [{ marker, recordId, name, ownerName, contentKey, kind }] } | { error }
 */
export async function buildGatheredContent({ userId, query, sources }) {
  const E = db.schema("edu");
  const { activePremiumUserIds } = await import("./access.js");
  const premium = await activePremiumUserIds().catch(() => []);
  const { data: rows } = await E.from("records")
    .select("id, user_id, kind, name, file_key, private")
    .in("id", (sources || []).map((s) => s.id)).is("deleted_at", null);
  const byId = new Map((rows || []).map((r) => [r.id, r]));
  const usable = [];
  for (const s of sources || []) {
    const row = byId.get(s.id);
    if (!row || row.user_id === userId || row.private || premium.includes(row.user_id)) continue;
    const passages = await gatherSourcePassages({ ...s, kind: row.kind, file_key: row.file_key });
    if (passages.length) usable.push({ ...s, kind: row.kind, file_key: row.file_key || null, passages });
  }
  if (!usable.length) return { error: "Those free notes aren't available anymore — say so and offer another way." };
  const { count } = await E.from("records").select("id", { count: "exact", head: true })
    .eq("user_id", userId).is("deleted_at", null);
  if ((count || 0) >= 200) return { error: "Their Library shelf is full (200) — ask them to remove something before saving gathered notes." };
  const topic = platformTopicName(query);
  const text = await synthesiseGatheredText({ userId, topic, sources: usable });
  const citations = usable.map((s, i) => ({
    marker: i + 1, recordId: s.id, name: s.name, ownerName: s.ownerName || null,
    contentKey: s.file_key || null, kind: s.kind || null,
  }));
  const { data: record, error } = await E.from("records").insert({
    user_id: userId, kind: "paste", name: topic, content: text, size: text.length,
    private: true, sources: citations,
  }).select("id, name").single();
  if (error || !record) return { error: "Couldn't save the gathered notes to their Library — try again in a moment." };
  void indexRecord({ userId, recordId: record.id, name: record.name, pasteText: text });
  return { record, sources: citations };
}

/* ── The taught source (agent knowledge) ───────────────────────────────────
   What the learner taught their agent lives in edu.agent_knowledge as
   chunks (topic, subject, content, confidence) under their agent's row in
   edu.student_agents. A taught build materialises the matching chunks as
   ONE Library record — "Taught notes · <Topic>", a private paste — and
   generates from it like from any document, so the artifact, its card and
   its dedupe all hang off a record the learner owns and can open. The
   record is kept current: when the taught chunks change, its text is
   rewritten in place rather than duplicated. */

async function taughtFind({ userId, q }) {
  const terms = platformTerms(q);
  if (!terms.length) return null;
  const E = db.schema("edu");
  const { data: agent } = await E.from("student_agents").select("id").eq("student_id", userId).maybeSingle();
  if (!agent?.id) return null;
  const ors = terms.flatMap((t) => {
    const p = `%${escapeLike(t)}%`;
    return [`topic.ilike.${p}`, `subject.ilike.${p}`, `content.ilike.${p}`];
  }).join(",");
  const { data: rows } = await E.from("agent_knowledge")
    .select("topic, subject, content, confidence")
    .eq("agent_id", agent.id).not("content", "is", null)
    .or(ors).order("confidence", { ascending: false }).limit(12);
  const ql = String(q || "").toLowerCase();
  const topicHit = (c) => {
    const t = String(c.topic || "").toLowerCase().trim();
    return t.length >= 3 && (t.includes(ql) || ql.includes(t));
  };
  const kept = (rows || [])
    .filter((r) => String(r.content || "").trim())
    .map((c) => ({ ...c, score: platformChunkScore(`${c.topic || ""} ${c.content || ""}`, terms), hit: topicHit(c) }))
    .filter((c) => c.hit || c.score >= 0.5)
    .sort((a, b) => b.score - a.score).slice(0, 8);
  return kept.length ? { chunks: kept } : null;
}

async function materialiseTaughtRecord({ userId, query, chunks }) {
  const E = db.schema("edu");
  const name = taughtRecordName(query);
  const text = taughtNotesText({ topic: platformTopicName(query), chunks });
  const { data: existing } = await E.from("records").select("id, name, content")
    .eq("user_id", userId).eq("kind", "paste").eq("name", name).is("deleted_at", null)
    .order("created_at", { ascending: true }).limit(1);
  if (existing?.[0]) {
    if (existing[0].content === text) return { record: { id: existing[0].id, name } };
    const { error } = await E.from("records").update({ content: text, size: text.length }).eq("id", existing[0].id);
    if (error) return { error: "Couldn't refresh their taught notes — try again in a moment." };
    void indexRecord({ userId, recordId: existing[0].id, name, pasteText: text });
    return { record: { id: existing[0].id, name } };
  }
  const { count } = await E.from("records").select("id", { count: "exact", head: true })
    .eq("user_id", userId).is("deleted_at", null);
  if ((count || 0) >= 200) return { error: "Their Library shelf is full (200) — ask them to remove something before saving their taught notes." };
  const { data: record, error } = await E.from("records").insert({
    user_id: userId, kind: "paste", name, content: text, size: text.length, private: true,
  }).select("id, name").single();
  if (error || !record) return { error: "Couldn't save their taught notes — try again in a moment." };
  void indexRecord({ userId, recordId: record.id, name, pasteText: text });
  return { record };
}

export async function resolveTaughtRecord({ userId, query = "" }) {
  const q = String(query || "").trim().slice(0, 200);
  if (q.length < 3) return null;
  const found = await taughtFind({ userId, q }).catch(() => null);
  if (!found) return null;
  const built = await materialiseTaughtRecord({ userId, query: q, chunks: found.chunks });
  if (built.error) return { error: built.error };
  return { record: built.record, taught: { topics: found.chunks.map((c) => c.topic).filter(Boolean) } };
}

/* ── The source resolvers ──────────────────────────────────────────────────
   One per source action. Each returns a resolution ({ record, … }), a
   needsChoice, an { error } for the cases that are answers in themselves
   (a named folder that doesn't exist, a chat file not read yet), or null
   for a plain miss — the caller turns a miss into the guided next step. */

/** upload: a file they sent in THIS chat, already read. Never substitutes
 *  another document — no read file is the answer, not a miss. */
export async function resolveUploadRecord({ userId, query = "", conversationId = null }) {
  const q = String(query || "").trim().slice(0, 200);
  if (!UUID.test(String(conversationId || ""))) {
    return { code: "no_chat_file",
      error: "No file was sent in this chat to build from — ask them to attach it here, or to name a document or a topic instead. Don't build from a different document." };
  }
  const chat = await chatReadRecords({ userId, conversationId });
  if (!chat.length) {
    return { code: "no_chat_file",
      error: "No file sent in this chat has been read yet — if they just sent it, say it's still being read and ask them to try again in a moment. Don't build from a different document." };
  }
  const pick = pickChatRecord(chat, q);
  if (pick?.needsChoice) return { needsChoice: pick.needsChoice, chat: true };
  if (pick?.recordId) {
    const rec = chat.find((c) => c.recordId === pick.recordId);
    if (rec) return { record: { id: rec.recordId, name: rec.name }, chat: true };
  }
  return { code: "no_chat_file",
    error: "No file sent in this chat has been read yet — if they just sent it, say it's still being read and ask them to try again in a moment. Don't build from a different document." };
}

/** library: the learner's own documents — by id, inside a named folder,
 *  by name, or by what they say. */
export async function resolveLibraryRecord({ userId, query = "", folder = "", recordId = null }) {
  const E = db.schema("edu");
  const live = (q) => q.eq("user_id", userId).is("deleted_at", null);
  if (recordId && UUID.test(String(recordId))) {
    const { data } = await live(E.from("records").select("id, name").eq("id", recordId)).maybeSingle();
    return data ? { record: data } : { error: "That document isn't in their Library." };
  }
  const q = String(query || "").trim().slice(0, 200);
  const f = String(folder || "").trim().slice(0, 120);
  let candidates = null, folderRow = null;
  if (f) {
    const { data: folders } = await E.from("library_folders").select("id, name").eq("user_id", userId)
      .ilike("name", `%${escapeLike(f)}%`).limit(3);
    folderRow = (folders || [])[0] || null;
    if (!folderRow) return { error: `No folder called "${f}" in their Library — say so and offer to search all their documents.` };
    // A folder holds its documents as items (item_type 'record'); only the learner's live records count.
    const { data: items } = await E.from("library_folder_items").select("item_ref").eq("folder_id", folderRow.id).eq("user_id", userId)
      .eq("item_type", "record").order("created_at", { ascending: false }).limit(30);
    const ids = (items || []).map((i) => i.item_ref).filter((x) => UUID.test(String(x)));
    const { data } = ids.length ? await live(E.from("records").select("id, name").in("id", ids)) : { data: [] };
    candidates = data || [];
    if (!candidates.length) return { error: `Their "${folderRow.name}" folder is empty.` };
    if (candidates.length === 1) return { record: candidates[0], folder: folderRow };
  }
  // By name first, then by what is inside (the learner's own records only).
  if (q.length >= 3) {
    const pool = candidates ? new Map(candidates.map((r) => [r.id, r])) : null;
    const byName = (candidates || []).find((r) => r.name?.toLowerCase().includes(q.toLowerCase()));
    if (byName) return { record: byName, folder: folderRow };
    if (!candidates) {
      // Deterministic: the most recently added match wins, never whichever
      // row the database happens to return first. escapeLike keeps the
      // query's real characters (the _ in a camera filename) while making
      // the LIKE wildcards literal.
      const { data: named } = await live(E.from("records").select("id, name"))
        .ilike("name", `%${escapeLike(q)}%`).order("created_at", { ascending: false }).limit(1);
      if (named?.[0]) return { record: named[0] };
    }
    const hits = await searchRecordChunks({ userId, q, limit: 20 }).catch(() => []);
    const ranked = rankContentHits(hits, {
      poolIds: pool ? new Set(pool.keys()) : null,
      names: pool ? new Map([...pool.values()].map((r) => [r.id, r.name])) : null,
    });
    const pick = pickContentWinner(ranked);
    if (pick?.needsChoice) return { needsChoice: pick.needsChoice, folder: folderRow };
    if (pick?.recordId) {
      const rec = pool?.get(pick.recordId) || (await live(E.from("records").select("id, name").eq("id", pick.recordId)).maybeSingle()).data;
      if (rec) return { record: rec, folder: folderRow };
    }
  }
  if (candidates) return { needsChoice: candidates.slice(0, 6).map((r) => ({ recordId: r.id, name: r.name })), folder: folderRow };
  return null;
}

/** discover: the community's free notes (the platform tier). */
export async function resolveDiscoverRecord({ userId, query = "" }) {
  const q = String(query || "").trim().slice(0, 200);
  if (q.length < 3) return null;
  const plat = await platformFind({ userId, q }).catch(() => null);
  if (plat?.records?.length) return { records: plat.records, platform: true };
  if (plat?.record) return { record: plat.record, platform: plat.platform };
  return null;
}

/**
 * The no-source cascade, kept as one call: a named folder or an explicit
 * chat file answers first (their errors are answers, not misses), then the
 * chain in order — taught → library → discover. makeStudyMaterial prefers
 * the per-source actions; this serves callers that pass no source.
 */
export async function findStudyRecord({ userId, query = "", folder = "", recordId = null, conversationId = null, fromChatFile = false }) {
  const f = String(folder || "").trim();
  if (recordId || f) {
    const r = await resolveLibraryRecord({ userId, query, folder, recordId });
    if (r) return r;
  }
  if (fromChatFile && !f) return resolveUploadRecord({ userId, query, conversationId });
  const taught = await resolveTaughtRecord({ userId, query });
  if (taught) return taught;
  const library = await resolveLibraryRecord({ userId, query, folder: "", recordId: null });
  if (library) return library;
  const discover = await resolveDiscoverRecord({ userId, query });
  if (discover) return discover;
  return { error: "Nothing in their Library matches, and no free notes in Discover match either — say so; don't invent a document. Offer the ways forward: teach you the topic, or upload the document." };
}
