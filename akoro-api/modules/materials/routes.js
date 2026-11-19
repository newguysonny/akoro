/**
 * modules/materials/routes.js — the `material_ingest` workflow (Grand Plan
 * §7.17.2, D51–D54): a file the learner drops into Agent Chat is saved to
 * their Library, in a folder the protégé picks or creates.
 *
 *   POST /api/agent/materials/ingest                { names, ask, chatSessionId?, replaces? }
 *        → one ingest for the message's files, UNFILED: no folder, subject or kind
 *          until it is read (Stage 4 — nothing is guessed from file names) → { data, ingests, batchId }
 *   POST /api/agent/materials/ingest/:id/records    { recordIds }
 *        → the uploaded records are the upload's (Library visibility rule:
 *          public for free users, Premium stays private); filing waits for the read
 *   POST /api/agent/materials/ingest/:id/progress   { state: extracting|ready|failed, pages?, error? }
 *   POST /api/agent/materials/ingest/:id/structure  → reads it: topics (+ a past paper's questions,
 *        private, D53), then files it ONCE from the read (folderMatch.js: the learner's
 *        own folder for the subject first, a new one only when none fits; no subject
 *        → "From chat — Unsorted" and the card asks) → ready. (The agent's upload
 *        tools are the live path now; this route files the same way, silently.)
 *   POST /api/agent/materials/ingest/:id/similar    → Akoro material on its topics (D52) → offering_more
 *   POST /api/agent/materials/ingest/:id/similar/add { keys } → the chosen ones into the folder → ready
 *   POST /api/agent/materials/ingest/:id/similar/dismiss      → "Not now" → ready
 *   POST /api/agent/materials/ingest/:id/folder     { folderId } → "save to A or B?" answered, remembered per subject
 *   POST /api/agent/materials/ingest/:id/subject    { subject | null } → "which subject?" answered (null: keep it unsorted)
 *   POST /api/agent/materials/ingest/:id/undo       → Recently deleted (30 days) → undone
 *   POST /api/agent/materials/ingest/:id/restore    → back where it was → ready
 *   GET  /api/agent/materials/ingest/:id
 *   GET  /api/agent/materials/chat/:chatId           → "Files in this chat"
 *   GET  /api/agent/materials/deleted                → Recently deleted (within 30 days)
 *   POST /api/agent/materials/ingest/:id/purge       → delete forever now
 *
 * The bytes go up the way a Library upload does (presign → PUT → POST
 * /api/records) and the uploader's browser runs the same extraction (hanji
 * for scans) — this module only owns the folder, the state and the Undo.
 * Folders made here are private (D53); every move is checked against the
 * workflow definition (an unlisted move answers 409).
 */
import { Router } from "express";
import { randomUUID } from "node:crypto";
import db from "../../db.js";
import { authenticateToken } from "../auth/routes.js";
import { openai } from "../../lib/aiModel.js";
import { getExtraction } from "../records/extractLib.js";
import { indexRecord } from "../records/searchLib.js";
import { removeRecordFile } from "../records/lib/storage.js";
import { cleanStructure, structureChips, structureMessage, structureMessages, structureSchema, STRUCTURE_LIMITS } from "./structureCore.js";
import { folderItemForCandidate, searchTopics, shapeCandidates, SIMILAR_LIMITS } from "./similarCore.js";
import { searchBlogPosts } from "../../lib/blogResearch.js";
import { assertTransition, TransitionError } from "../workflows/definition.js";
import {
  INGEST_LIMITS, RESTORE_DAYS, ingestWorkflow, folderItemFor, ingestToApi,
} from "./ingestCore.js";
import { pickFolder, subjectKey, subjectLabel, UNSORTED_FOLDER } from "./folderMatch.js";
import { filingSentence } from "./structureCore.js";
import { appendSteps, filedSteps, messageStep, readSteps, receivedSteps, savedSteps, similarSteps, toolStep } from "./stepsCore.js";
import { now, loadOwn, move, folderContext, resolveFolder, refile, fileUnsorted, withFiling, addSteps, pagesOfRecord, readStructure, fileIngestFromDecision } from "./filingDb.js";

const router = Router();
router.use(authenticateToken);
const edu = () => db.schema("edu");
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const UUID = /^[0-9a-f-]{36}$/i;
const MAX_FOLDERS = 50;
router.post("/ingest", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const names = (Array.isArray(req.body?.names) ? req.body.names : []).map((n) => String(n || "").trim().slice(0, INGEST_LIMITS.NAME)).filter(Boolean).slice(0, INGEST_LIMITS.FILES);
  if (!names.length) return res.status(400).json({ success: false, message: "names: at least one file name is required." });
  let chatSessionId = UUID.test(String(req.body?.chatSessionId || "")) ? req.body.chatSessionId : null;
  if (chatSessionId) {
    const { data: chat } = await db.from("chat_sessions").select("id").eq("id", chatSessionId).eq("user_id", userId).maybeSingle();
    if (!chat) chatSessionId = null;
  }
  // "Save it again" after an Undo: the new upload takes over the old one's chat message.
  const replaced = req.body?.replaces ? await loadOwn(req.body.replaces, userId) : null;
  // ONE upload for the message's files, starting UNFILED (Stage 4): no
  // classify call, no folder resolved or created, no subject or kind — the
  // read at /structure decides all of it, once. (One row per batch is the
  // table's own design; the per-folder split only ever served the guess.)
  const batchId = randomUUID();
  const { data, error } = await edu().from("material_ingests").insert({
    user_id: userId, chat_session_id: chatSessionId, names, state: "received",
    folder_id: null, folder_name: null, folder_created: false,
    doc_kind: null, subject: null, batch_id: batchId,
    filing: { fileIndexes: names.map((_, i) => i) },
    ...(replaced?.state === "undone" && replaced.chat_message_id ? { chat_message_id: replaced.chat_message_id, chat_session_id: replaced.chat_session_id } : {}),
  }).select("*").single();
  if (error) throw error;
  const row = await addSteps(data, receivedSteps({ batchId, count: names.length }));
  if (row?.chat_message_id) {
    const { data: msg } = await db.from("chat_messages").select("meta").eq("id", row.chat_message_id).eq("user_id", userId).maybeSingle();
    if (msg) await db.from("chat_messages").update({ meta: { ...(msg.meta || {}), ingest: { id: row.id }, ingests: [{ id: row.id }] } }).eq("id", row.chat_message_id).eq("user_id", userId);
  }
  // `data` is the upload (older apps read it); `ingests` is the batch — one entry now.
  res.status(201).json({ success: true, data: ingestToApi(row), ingests: [ingestToApi(row)], batchId });
}));

router.post("/ingest/:id/records", asyncHandler(async (req, res) => {
  const row = await loadOwn(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ success: false, message: "Upload not found." });
  const ids = [...new Set((Array.isArray(req.body?.recordIds) ? req.body.recordIds : []).map(String))].filter((x) => UUID.test(x)).slice(0, INGEST_LIMITS.FILES);
  if (!ids.length) return res.status(400).json({ success: false, message: "recordIds: at least one record is required." });
  const { data: records } = await edu().from("records").select("id, name, mime").eq("user_id", req.user.id).in("id", ids);
  if ((records || []).length !== ids.length) return res.status(403).json({ success: false, message: "One of those records isn't yours." });
  // Visibility follows the Library rule (Matt, 2026-11-16; supersedes the
  // D53 blanket-private marking): a chat upload is NOT marked private — it is
  // discoverable like any Library upload, and a Premium subscriber's uploads
  // stay out of Discover via the dynamic premium exclusion every consumer
  // enforces (records feed, discover/open, resolveContentAccess, platform
  // search). The record keeps the schema default, private = false.
  // Stage 4: the records are the upload's, but NOT filed into a folder here —
  // filing happens once, at /structure, from the read (which also fires the
  // Study Prep attach, with the read subject instead of a name guess).
  const recordIds = [...new Set([...(row.record_ids || []), ...ids])];
  let next = row.state === "received" ? await move(row, "filed", { record_ids: recordIds })
    : (await edu().from("material_ingests").update({ record_ids: recordIds, updated_at: now() }).eq("id", row.id).select("*").single()).data;
  if (row.state === "received") {
    const first = !Array.isArray(row.filing?.fileIndexes) || row.filing.fileIndexes.includes(0);
    next = await addSteps(next, savedSteps({ ingestId: row.id, first }));
  }
  res.json({ success: true, data: ingestToApi(next) });
}));

const PROGRESS = new Set(["extracting", "ready", "failed"]);
router.post("/ingest/:id/progress", asyncHandler(async (req, res) => {
  const row = await loadOwn(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ success: false, message: "Upload not found." });
  const to = String(req.body?.state || "");
  if (!PROGRESS.has(to)) return res.status(400).json({ success: false, message: "state: extracting, ready or failed." });
  // Undone is Recently deleted: only Restore brings it back, never a late step of the read.
  if (row.state === "undone") return res.status(409).json({ success: false, code: "invalid_state_transition", message: "This upload was undone." });
  const patch = {};
  if (Number.isFinite(Number(req.body?.pages))) patch.pages = Math.max(0, Math.min(2000, Math.round(Number(req.body.pages))));
  if (to === "failed") patch.error = String(req.body?.error || "Couldn't read it.").slice(0, 300);
  if (to !== "failed") patch.error = null;
  if (row.state === to) {   // a repeat (a page count update) is not a move
    const { data } = await edu().from("material_ingests").update({ ...patch, updated_at: now() }).eq("id", row.id).select("*").single();
    return res.json({ success: true, data: ingestToApi(data) });
  }
  res.json({ success: true, data: ingestToApi(await move(row, to, patch)) });
}));

router.post("/ingest/:id/structure", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  let row = await loadOwn(req.params.id, userId);
  if (!row) return res.status(404).json({ success: false, message: "Upload not found." });
  // Once per upload: a second call returns what the first found.
  if (row.structure) return res.json({ success: true, data: ingestToApi(row), message: null });
  if (row.state !== "ready") return res.status(409).json({ success: false, code: "not_ready", message: "It isn't read yet." });
  const ids = (row.record_ids || []).slice(0, STRUCTURE_FILES);
  const { data: fetched } = await edu().from("records").select("id, name, kind, mime, file_key, content").eq("user_id", userId).in("id", ids);
  // In the order they were attached: the first file leads the message, its chips and its folder.
  const records = ids.map((id) => (fetched || []).find((r) => r.id === id)).filter(Boolean);
  row = await move(row, "structured");

  const reads = await Promise.all(records.map((record) => readStructure(record, row, userId)));
  const items = [];
  const questions = [];
  let calls = 0, failures = 0;
  for (const r of reads) {
    if (!r) continue;
    calls += 1;
    if (!r.item.ok) failures += 1;
    items.push(r.item);
    questions.push(...r.questions);
  }

  // Every read failed (the model was unavailable): keep no read, say nothing — it can be tried again.
  if (calls && failures === calls) {
    const back = await move(row, "ready");
    // One failed-read step, updated in place; the app's last try (final) says so and offers Read it again on the card.
    const final = req.body?.final === true;
    // The final failure files it once, into Unsorted (the fallback); a later
    // read files it properly. A non-final failure files nothing — a retry is coming.
    let settled = back;
    if (final && !back.folder_id && back.record_ids?.length) settled = await fileUnsorted(userId, back).catch(() => null) || back;
    await addSteps(settled, [
      toolStep(`read:${row.id}:failed`, "material.read", `Reading ${row.names?.length === 1 ? row.names[0] : "your files"}`, { result: final ? "Couldn't read it" : "Couldn't read it just now — trying again", ok: false }),
      ...(final ? [messageStep(`read:${row.id}:failed:say`, "I couldn't read it just now — it's saved in your Library, nothing is lost. Tap **Read it again** on the card in a minute and I'll go through it.")] : []),
    ]);
    return res.status(503).json({ success: false, code: "structure_unavailable", message: "Couldn't read it just now — try again in a moment." });
  }
  const main = items[0] || null;
  const structure = {
    items: items.map(({ dropped, ms, ok, ...it }) => it),
    topics: [...new Map(items.flatMap((it) => it.topics).map((t) => [t.name.toLowerCase(), t])).values()].slice(0, 30),
    questionCount: questions.length,
  };
  if (questions.length) {
    const { error } = await edu().from("material_questions").insert(questions.map((q) => ({
      user_id: userId, ingest_id: row.id, record_id: q.record_id, exam: q.exam, subject: q.subject, year: q.year,
      number: q.number, marks: q.marks, topic: q.topic, page: q.page, text: q.text,
    })));
    if (error) console.warn("[materials] questions not saved:", error.message);
  }
  // Filed ONCE, from the read (Stage 4): the first file's subject and kind
  // lead a mixed batch, as its read always has. No subject → the Unsorted
  // fallback, and the card still asks; two folders fitting → the card decides.
  const found = subjectLabel(main?.subject);
  const kind = main?.kind || row.doc_kind || "other";
  const subject = found || null;
  const guesses = [...new Set((main?.subjectGuesses || []).map(subjectLabel).filter(Boolean))].slice(0, 3);
  // Filed ONCE, from the read (Stage 4 mechanics, shared with the agent's
  // file_upload tool): the first file's subject and kind lead a mixed batch.
  // No chat post any more — the agent narrates the filing in its own turn.
  const { row: filedRow, studyPrep } = await fileIngestFromDecision({ userId, row, subject, kind, guesses, structure, items, questions, records });
  row = filedRow;
  res.json({ success: true, data: { ...ingestToApi(row), ...(studyPrep?.added ? { studyPrep } : {}) }, message: null });
}));

/** Akoro's own material on the upload's topics: published courses and blog posts (D52). */
async function findSimilar(row, userId) {
  const topics = searchTopics(row.structure);
  const { data: qs } = await edu().from("material_questions").select("topic, number").eq("user_id", userId).eq("ingest_id", row.id).limit(200);
  const questionsByTopic = {};
  for (const q of qs || []) (questionsByTopic[q.topic] ||= []).push(q.number);
  const found = [];
  for (const t of topics) {
    const term = t.query.replace(/[,()%\\]/g, " ").trim();
    const [blog, courses] = await Promise.all([
      searchBlogPosts({ query: t.query, limit: SIMILAR_LIMITS.PER_TOPIC }).catch(() => ({ posts: [] })),
      (async () => {
        try {
          const { data } = await db.from("courses").select("id, title, slug, subject").eq("is_published", true)
            .or(`title.ilike.%${term}%,description.ilike.%${term}%`).limit(SIMILAR_LIMITS.PER_TOPIC);
          return data || [];
        } catch { return []; }
      })(),
    ]);
    found.push({ topic: t.name, posts: blog?.posts || [], courses });
  }
  return shapeCandidates(found, { questionsByTopic });
}

router.post("/ingest/:id/similar", asyncHandler(async (req, res) => {
  let row = await loadOwn(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ success: false, message: "Upload not found." });
  if (!row.structure?.topics?.length) return res.status(409).json({ success: false, code: "not_structured", message: "I haven't read its topics yet." });
  const similarStarted = Date.now();
  const candidates = await findSimilar(row, req.user.id);
  if (row.state === "ready") row = await move(row, "offering_more", { structure: { ...row.structure, offered: candidates.map((c) => c.key) } });
  row = await addSteps(row, similarSteps({ ingestId: row.id, candidates, folderName: row.folder_name, ms: Date.now() - similarStarted }));
  res.json({ success: true, data: ingestToApi(row), candidates });
}));

router.post("/ingest/:id/similar/add", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  let row = await loadOwn(req.params.id, userId);
  if (!row) return res.status(404).json({ success: false, message: "Upload not found." });
  if (row.state !== "offering_more") return res.status(409).json({ success: false, code: "not_offering", message: "Ask for similar material first." });
  if (!row.folder_id) return res.status(409).json({ success: false, code: "no_folder", message: "This upload has no folder to add to." });
  // Only what was offered, and only what still exists — re-found, never taken from the request.
  const offered = new Set(row.structure?.offered || []);
  const keys = [...new Set((Array.isArray(req.body?.keys) ? req.body.keys : []).map(String))].filter((k) => offered.has(k)).slice(0, SIMILAR_LIMITS.ADD);
  const chosen = (await findSimilar(row, userId)).filter((c) => keys.includes(c.key));
  if (chosen.length) {
    const { error } = await edu().from("library_folder_items")
      .upsert(chosen.map((c) => ({ folder_id: row.folder_id, user_id: userId, ...folderItemForCandidate(c) })), { onConflict: "folder_id,item_type,item_ref" });
    if (error) throw error;
  }
  row = await move(row, "ready", { structure: { ...row.structure, added: [...new Set([...(row.structure?.added || []), ...chosen.map((c) => c.key)])] } });
  res.json({ success: true, data: ingestToApi(row), added: chosen.map((c) => ({ key: c.key, title: c.title, href: c.href })) });
}));

router.post("/ingest/:id/similar/dismiss", asyncHandler(async (req, res) => {
  let row = await loadOwn(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ success: false, message: "Upload not found." });
  if (row.state === "offering_more") row = await move(row, "ready");
  res.json({ success: true, data: ingestToApi(row) });
}));

/**
 * Undo → Recently deleted for 30 days: the files leave every folder and are
 * hidden everywhere (records.deleted_at), what the upload added comes out of
 * its folder, a folder it made goes if now empty — all noted in filing.trash
 * so Restore puts it back. The purge deletes it for good after 30 days.
 */
router.post("/ingest/:id/undo", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const row = await loadOwn(req.params.id, userId);
  if (!row) return res.status(404).json({ success: false, message: "Upload not found." });
  if (row.state === "undone") return res.json({ success: true, data: ingestToApi(row) });
  assertTransition(ingestWorkflow, row.state, "undone");
  const ids = (row.record_ids || []).map(String);
  const added = (row.structure?.added || []).map(String);
  const cols = "folder_id, item_type, item_ref, title, sub, kind, link";
  const [{ data: fileItems }, { data: addedItems }] = await Promise.all([
    ids.length ? edu().from("library_folder_items").select(cols).eq("user_id", userId).eq("item_type", "record").in("item_ref", ids) : { data: [] },
    row.folder_id && added.length ? edu().from("library_folder_items").select(cols).eq("user_id", userId).eq("folder_id", row.folder_id).eq("item_type", "library").in("item_ref", added) : { data: [] },
  ]);
  if (ids.length) {
    await edu().from("library_folder_items").delete().eq("user_id", userId).eq("item_type", "record").in("item_ref", ids);
    await edu().from("records").update({ deleted_at: now() }).eq("user_id", userId).in("id", ids);
  }
  if (row.folder_id && added.length) {
    await edu().from("library_folder_items").delete().eq("folder_id", row.folder_id).eq("user_id", userId).eq("item_type", "library").in("item_ref", added);
  }
  // The folder goes only if this upload made it and nothing else is in it now.
  let folderRemoved = false;
  if (row.folder_id && row.folder_created) {
    const { count } = await edu().from("library_folder_items").select("id", { count: "exact", head: true }).eq("folder_id", row.folder_id);
    if (!count) {
      await edu().from("library_folders").delete().eq("id", row.folder_id).eq("user_id", userId);
      folderRemoved = true;
    }
  }
  const trash = { items: [...(fileItems || []), ...(addedItems || [])], folderId: row.folder_id || null, folderRemoved: folderRemoved ? row.folder_name : null };
  const done = await move(row, "undone", { ...(folderRemoved ? { folder_id: null } : {}), ...withFiling(row, { deletedAt: now(), trash }) });
  res.json({ success: true, data: { ...ingestToApi(done), folderRemoved } });
}));

/** "Save to SS2 Biology or WAEC Biology?" — the learner's pick, remembered for that subject. */
router.post("/ingest/:id/folder", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  let row = await loadOwn(req.params.id, userId);
  if (!row) return res.status(404).json({ success: false, message: "Upload not found." });
  if (row.state === "undone") return res.status(409).json({ success: false, code: "undone", message: "This upload was undone." });
  const folderId = String(req.body?.folderId || "");
  const { data: folder } = UUID.test(folderId)
    ? await edu().from("library_folders").select("id, name").eq("id", folderId).eq("user_id", userId).maybeSingle()
    : { data: null };
  if (!folder) return res.status(404).json({ success: false, message: "Folder not found." });
  const patch = await refile(userId, row, folder);
  if (row.subject) {
    await edu().from("material_folder_defaults").upsert({ user_id: userId, subject_key: subjectKey(row.subject), kind: row.doc_kind || "", folder_id: folder.id, updated_at: now() }, { onConflict: "user_id,subject_key,kind" });
  }
  const { data } = await edu().from("material_ingests").update({ ...patch, ...withFiling(row, { choices: null }), updated_at: now() }).eq("id", row.id).select("*").single();
  res.json({ success: true, data: ingestToApi(data) });
}));

/** "Which subject is this?" — the learner says (or keeps it unsorted: subject null); it's filed where that subject lives. */
router.post("/ingest/:id/subject", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  let row = await loadOwn(req.params.id, userId);
  if (!row) return res.status(404).json({ success: false, message: "Upload not found." });
  if (row.state === "undone") return res.status(409).json({ success: false, code: "undone", message: "This upload was undone." });
  const subject = subjectLabel(String(req.body?.subject || "").slice(0, 60));
  if (!subject) {
    const { data } = await edu().from("material_ingests").update({ ...withFiling(row, { needsSubject: false }), updated_at: now() }).eq("id", row.id).select("*").single();
    return res.json({ success: true, data: ingestToApi(data) });
  }
  const where = await resolveFolder(userId, { subject, kind: row.doc_kind || "other" }, await folderContext(userId));
  let patch = { subject };
  let filing = { needsSubject: false, subjectOptions: [] };
  if (where.folder_id && where.folder_id !== row.folder_id) {
    patch = { ...patch, ...await refile(userId, row, { id: where.folder_id, name: where.folder_name, created: where.folder_created }) };
    filing = { ...filing, movedFrom: row.folder_name || null, choices: null };
  } else if (where.choices) filing = { ...filing, choices: where.choices };
  await edu().from("material_questions").update({ subject }).eq("user_id", userId).eq("ingest_id", row.id);
  const { data } = await edu().from("material_ingests").update({ ...patch, ...withFiling(row, filing), updated_at: now() }).eq("id", row.id).select("*").single();
  res.json({ success: true, data: ingestToApi(data) });
}));

/** Restore from Recently deleted (30 days): the files, their folder places and what was added with them. */
router.post("/ingest/:id/restore", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const row = await loadOwn(req.params.id, userId);
  if (!row) return res.status(404).json({ success: false, message: "Upload not found." });
  if (row.state !== "undone") return res.json({ success: true, data: ingestToApi(row) });
  const f = row.filing || {};
  const expired = !f.deletedAt || f.purged || Date.now() - new Date(f.deletedAt).getTime() > RESTORE_DAYS * 86_400_000;
  if (expired) return res.status(410).json({ success: false, code: "purged", message: "It's been deleted for good." });
  const ids = (row.record_ids || []).map(String);
  if (ids.length) await edu().from("records").update({ deleted_at: null }).eq("user_id", userId).in("id", ids);
  // A folder that went with the Undo comes back (same name); the items go back where they were.
  let folderId = row.folder_id, folderName = row.folder_name, created = row.folder_created;
  const trash = f.trash || {};
  if (trash.folderRemoved) {
    const again = await folderFor(userId, trash.folderRemoved);
    if (again) { folderId = again.id; folderName = again.name; created = again.created; }
  }
  const items = (trash.items || []).map((it) => ({ ...it, folder_id: it.folder_id === trash.folderId || !it.folder_id ? folderId : it.folder_id, user_id: userId })).filter((it) => it.folder_id);
  if (items.length) {
    const { data: live } = await edu().from("library_folders").select("id").eq("user_id", userId).in("id", [...new Set(items.map((it) => it.folder_id))]);
    const ok = new Set((live || []).map((x) => x.id));
    const back = items.filter((it) => ok.has(it.folder_id));
    if (back.length) await edu().from("library_folder_items").upsert(back, { onConflict: "folder_id,item_type,item_ref" });
  }
  const done = await move(row, "ready", { folder_id: folderId || null, folder_name: folderName, folder_created: !!created, ...withFiling(row, { deletedAt: null, trash: null }) });
  res.json({ success: true, data: ingestToApi(done) });
}));

/** Recently deleted: the learner's undone uploads still within their 30 days, newest first. */
router.get("/deleted", asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - RESTORE_DAYS * 86_400_000).toISOString();
  const { data } = await edu().from("material_ingests").select("*").eq("user_id", req.user.id).eq("state", "undone")
    .gte("updated_at", since).order("updated_at", { ascending: false }).limit(100);
  const items = (data || []).map(ingestToApi).filter((x) => x.restorableUntil)
    .map((x) => ({ ...x, deletedAt: (data.find((r) => r.id === x.id)?.filing || {}).deletedAt || null,
      folderName: (data.find((r) => r.id === x.id)?.filing?.trash?.folderRemoved) || x.folder?.name || null }));
  res.json({ success: true, items });
}));

/** Delete forever now, without waiting the 30 days: the files, their text and questions. */
router.post("/ingest/:id/purge", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const row = await loadOwn(req.params.id, userId);
  if (!row) return res.status(404).json({ success: false, message: "Upload not found." });
  if (row.state !== "undone") return res.status(409).json({ success: false, code: "not_deleted", message: "Undo it first." });
  const ids = (row.record_ids || []).map(String);
  if (ids.length) {
    const { data: recs } = await edu().from("records").select("id, file_key").eq("user_id", userId).in("id", ids).not("deleted_at", "is", null);
    if (recs?.length) {
      await edu().from("records").delete().eq("user_id", userId).in("id", recs.map((r) => r.id));
      for (const r of recs) if (r.file_key) void removeRecordFile(r.file_key);
    }
  }
  await edu().from("material_questions").delete().eq("user_id", userId).eq("ingest_id", row.id);
  const { data } = await edu().from("material_ingests").update({ filing: { ...(row.filing || {}), purged: true, trash: null }, updated_at: now() }).eq("id", row.id).select("*").single();
  res.json({ success: true, data: ingestToApi(data) });
}));

/** "Files in this chat": every upload this chat brought in that isn't deleted, newest last. */
router.get("/chat/:chatId", asyncHandler(async (req, res) => {
  if (!UUID.test(String(req.params.chatId))) return res.status(400).json({ success: false, message: "A chat id is required." });
  const { data } = await edu().from("material_ingests").select("*").eq("user_id", req.user.id).eq("chat_session_id", req.params.chatId)
    .neq("state", "undone").order("created_at", { ascending: true }).limit(40);
  const rows = data || [];
  const ids = [...new Set(rows.flatMap((r) => r.record_ids || []))];
  const { data: recs } = ids.length ? await edu().from("records").select("id, name, mime").eq("user_id", req.user.id).in("id", ids).is("deleted_at", null) : { data: [] };
  const byId = new Map((recs || []).map((r) => [r.id, r]));
  const files = rows.flatMap((r) => (r.record_ids || []).filter((id) => byId.has(id)).map((id) => ({
    recordId: id, name: byId.get(id).name, mime: byId.get(id).mime || null, ingestId: r.id,
    subject: r.subject || null, folder: r.folder_id ? { id: r.folder_id, name: r.folder_name } : null,
  })));
  res.json({ success: true, files });
}));

router.get("/ingest/:id", asyncHandler(async (req, res) => {
  const row = await loadOwn(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ success: false, message: "Upload not found." });
  res.json({ success: true, data: ingestToApi(row) });
}));

router.use((error, _req, res, next) => {
  if (error instanceof TransitionError || error?.code === "invalid_state_transition") return res.status(409).json({ success: false, code: "invalid_state_transition", message: error.message });
  next(error);
});

export default router;
