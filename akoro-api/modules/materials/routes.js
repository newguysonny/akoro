/**
 * modules/materials/routes.js — the `material_ingest` workflow (Grand Plan
 * §7.17.2, D51–D54): a file the learner drops into Agent Chat is saved to
 * their Library, in a folder the protégé picks or creates.
 *
 *   POST /api/agent/materials/ingest                { names, ask, chatSessionId?, replaces? }
 *        → each file classified; one ingest per folder (folderMatch.js: the learner's
 *          own folder for the subject first, a new one only when none fits) → { data, ingests, batchId }
 *   POST /api/agent/materials/ingest/:id/records    { recordIds }
 *        → the uploaded records go into the folder → filed
 *   POST /api/agent/materials/ingest/:id/progress   { state: extracting|ready|failed, pages?, error? }
 *   POST /api/agent/materials/ingest/:id/structure  → reads it: topics (+ a past paper's questions,
 *        private, D53), posts what it found into the chat → ready
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
import { searchBlogPosts } from "../adaptive-learning/blogResearch.js";
import { assertTransition, TransitionError } from "../workflows/definition.js";
import {
  INGEST_LIMITS, RESTORE_DAYS, ingestWorkflow, classifyMessages, classifySchema, folderItemFor, guessFile, ingestToApi, shapeClassification,
} from "./ingestCore.js";
import { pickFolder, subjectKey, subjectLabel, UNSORTED_FOLDER } from "./folderMatch.js";
import { filingSentence } from "./structureCore.js";
import { appendSteps, filedSteps, folderSteps, messageStep, readSteps, similarSteps, sortSteps, toolStep } from "./stepsCore.js";

const router = Router();
router.use(authenticateToken);
const edu = () => db.schema("edu");
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const UUID = /^[0-9a-f-]{36}$/i;
const MAX_FOLDERS = 50;
const now = () => new Date().toISOString();

async function loadOwn(id, userId) {
  if (!UUID.test(String(id))) return null;
  const { data } = await edu().from("material_ingests").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  return data || null;
}

/** Move the ingest, checked against the definition and pinned to its current state. */
async function move(row, to, patch = {}) {
  assertTransition(ingestWorkflow, row.state, to);
  const { data, error } = await edu().from("material_ingests").update({ ...patch, state: to, updated_at: now() })
    .eq("id", row.id).eq("state", row.state).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new TransitionError("The upload changed meanwhile — refresh and try again.", { from: row.state, to });
  return data;
}

/** Classify each file from its name + the learner's words: one small capped call, the platform's (D46); guesses if it fails. */
async function classify(names, ask, userId) {
  try {
    const res = await openai.chat.completions.create({
      __role: "background", messages: classifyMessages({ names, ask }), temperature: 0, max_tokens: 60 + 50 * names.length,
      response_format: classifySchema(),
      __payer: "platform", __feature: "material_ingest", __userId: userId, __timeoutMs: 10_000, __maxRetries: 0,
    });
    return shapeClassification(res?.choices?.[0]?.message?.content, names, ask);
  } catch (error) {
    console.warn("[materials] classify fell back to the guess:", String(error?.message || error).slice(0, 120));
    return names.map((n) => guessFile(n, ask));
  }
}

/** What the learner already has: folders, what earlier uploads filed where, the folders they chose. */
async function folderContext(userId) {
  const [{ data: folders }, { data: filed }, { data: defaults }] = await Promise.all([
    edu().from("library_folders").select("id, name").eq("user_id", userId).limit(MAX_FOLDERS + 10),
    edu().from("material_ingests").select("folder_id, subject, doc_kind, record_ids").eq("user_id", userId)
      .neq("state", "undone").not("folder_id", "is", null).not("subject", "is", null).limit(500),
    edu().from("material_folder_defaults").select("subject_key, kind, folder_id").eq("user_id", userId).limit(200),
  ]);
  const stats = (filed || []).map((r) => ({ folder_id: r.folder_id, subject: r.subject, kind: r.doc_kind, count: (r.record_ids || []).length || 1 }));
  return { folders: folders || [], stats, defaults: defaults || [] };
}

/** pickFolder's answer made real: an existing folder, a new one, two to choose from, or none. */
async function resolveFolder(userId, { subject, kind }, ctx) {
  const pick = pickFolder({ subject, kind, ...ctx, atCap: ctx.folders.length >= MAX_FOLDERS });
  if (pick.folder) return { folder_id: pick.folder.id, folder_name: pick.folder.name, folder_created: false, choices: null };
  if (pick.choices) return { folder_id: null, folder_name: null, folder_created: false, choices: pick.choices };
  if (pick.create) {
    const made = await folderFor(userId, pick.create);
    if (made) {
      if (made.created) ctx.folders.push({ id: made.id, name: made.name });
      return { folder_id: made.id, folder_name: made.name, folder_created: made.created, choices: null };
    }
  }
  return { folder_id: null, folder_name: null, folder_created: false, choices: null };
}

/**
 * Move an upload's files to another folder: out of the old one (removed if
 * this upload made it and it is now empty), into the new. → the row's patch.
 */
async function refile(userId, row, target) {
  const ids = (row.record_ids || []).map(String);
  if (row.folder_id && row.folder_id !== target.id && ids.length) {
    await edu().from("library_folder_items").delete().eq("folder_id", row.folder_id).eq("user_id", userId).eq("item_type", "record").in("item_ref", ids);
  }
  if (ids.length) {
    const { data: records } = await edu().from("records").select("id, name, mime").eq("user_id", userId).in("id", ids);
    if (records?.length) {
      const { error } = await edu().from("library_folder_items")
        .upsert(records.map((r) => ({ folder_id: target.id, user_id: userId, ...folderItemFor(r, row.doc_kind) })), { onConflict: "folder_id,item_type,item_ref" });
      if (error) throw error;
    }
  }
  if (row.folder_id && row.folder_id !== target.id && row.folder_created) {
    const { count } = await edu().from("library_folder_items").select("id", { count: "exact", head: true }).eq("folder_id", row.folder_id);
    if (!count) await edu().from("library_folders").delete().eq("id", row.folder_id).eq("user_id", userId);
  }
  return { folder_id: target.id, folder_name: target.name, folder_created: row.folder_id === target.id ? row.folder_created : !!target.created };
}

const withFiling = (row, patch) => ({ filing: { ...(row.filing || {}), ...patch } });

/** Add steps to an upload (the chat shows them under its message). Best effort: a step never fails the upload. */
async function addSteps(row, steps) {
  if (!row || !steps.length) return row;
  const { data } = await edu().from("material_ingests").update({ steps: appendSteps(row.steps, steps.map((s) => ({ ...s, at: s.at || now() }))) })
    .eq("id", row.id).select("*").maybeSingle().then((r) => r, () => ({ data: null }));
  return data || row;
}

/** An existing folder with this name (any case), else a new private one. → { id, name, created } | null */
async function folderFor(userId, name) {
  const { data: mine } = await edu().from("library_folders").select("id, name").eq("user_id", userId).limit(MAX_FOLDERS);
  const same = (mine || []).find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (same) return { id: same.id, name: same.name, created: false };
  if ((mine || []).length >= MAX_FOLDERS) return null;   // at the cap: the files are still saved, just unfiled
  const { data, error } = await edu().from("library_folders")
    .insert({ user_id: userId, name, description: "Saved from Agent Chat", visibility: "private" }).select("id, name").single();
  if (error) {
    // A race on the unique name: the other request made it — use that one.
    const { data: again } = await edu().from("library_folders").select("id, name").eq("user_id", userId).ilike("name", name).maybeSingle();
    return again ? { id: again.id, name: again.name, created: false } : null;
  }
  return { id: data.id, name: data.name, created: true };
}

router.post("/ingest", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const names = (Array.isArray(req.body?.names) ? req.body.names : []).map((n) => String(n || "").trim().slice(0, INGEST_LIMITS.NAME)).filter(Boolean).slice(0, INGEST_LIMITS.FILES);
  if (!names.length) return res.status(400).json({ success: false, message: "names: at least one file name is required." });
  const ask = String(req.body?.ask || "").slice(0, INGEST_LIMITS.ASK);
  let chatSessionId = UUID.test(String(req.body?.chatSessionId || "")) ? req.body.chatSessionId : null;
  if (chatSessionId) {
    const { data: chat } = await db.from("chat_sessions").select("id").eq("id", chatSessionId).eq("user_id", userId).maybeSingle();
    if (!chat) chatSessionId = null;
  }
  // "Save it again" after an Undo: the new upload takes over the old one's chat message.
  const replaced = req.body?.replaces ? await loadOwn(req.body.replaces, userId) : null;
  const sortStarted = Date.now();
  const kinds = await classify(names, ask, userId);
  const sortMs = Date.now() - sortStarted;
  const folderStarted = Date.now();
  const ctx = await folderContext(userId);

  // One upload per folder: files of one subject and kind together, each group
  // filed where the learner keeps that subject; unknown ones held as Unsorted
  // until they're read. ("Save it again" keeps its files together.)
  const groups = new Map();
  for (const [i, k] of kinds.entries()) {
    const subject = subjectLabel(k.subject);
    const key = replaced ? "all" : subject ? `${subjectKey(subject)}|${k.kind}` : "unsorted";
    if (!groups.has(key)) groups.set(key, { subject, kind: k.kind, topic: k.topic, indexes: [] });
    groups.get(key).indexes.push(i);
  }
  const placed = new Map();
  for (const g of groups.values()) {
    const where = await resolveFolder(userId, { subject: g.subject, kind: g.kind }, ctx);
    const sig = where.folder_id || (where.choices ? `choose:${where.choices.map((c) => c.id).join(",")}` : `none:${g.subject}|${g.kind}`);
    if (placed.has(sig)) {
      const p = placed.get(sig);
      p.indexes.push(...g.indexes);
      if (g.kind === "past_paper") p.kind = "past_paper";
    } else placed.set(sig, { ...g, where });
  }

  const batchId = randomUUID();
  const made = [];
  for (const g of placed.values()) {
    const indexes = g.indexes.sort((a, b) => a - b);
    const { data, error } = await edu().from("material_ingests").insert({
      user_id: userId, chat_session_id: chatSessionId, names: indexes.map((i) => names[i]), state: "received",
      folder_id: g.where.folder_id, folder_name: g.where.folder_name, folder_created: g.where.folder_created,
      doc_kind: g.kind, subject: g.subject, batch_id: batchId,
      filing: { fileIndexes: indexes, ...(g.where.choices ? { choices: g.where.choices } : {}) },
      ...(replaced?.state === "undone" && replaced.chat_message_id ? { chat_message_id: replaced.chat_message_id, chat_session_id: replaced.chat_session_id } : {}),
    }).select("*").single();
    if (error) throw error;
    made.push(data);
  }
  // The steps so far, on the message's first upload: the files sorted, and where each group goes.
  if (made[0]) {
    made[0] = await addSteps(made[0], [
      ...sortSteps({ batchId, files: kinds.map((k) => ({ subject: subjectLabel(k.subject), kind: k.kind })), ms: sortMs }),
      ...folderSteps({ batchId, ms: Date.now() - folderStarted, groups: [...placed.values()].map((g) => ({
        subject: g.subject, kind: g.kind, folderName: g.where.folder_name, created: g.where.folder_created, choices: g.where.choices,
        names: g.indexes.map((i) => names[i]) })) }),
    ]);
  }
  if (made[0]?.chat_message_id) {
    const { data: msg } = await db.from("chat_messages").select("meta").eq("id", made[0].chat_message_id).eq("user_id", userId).maybeSingle();
    if (msg) await db.from("chat_messages").update({ meta: { ...(msg.meta || {}), ingest: { id: made[0].id }, ingests: made.map((r) => ({ id: r.id })) } }).eq("id", made[0].chat_message_id).eq("user_id", userId);
  }
  // `data` is the first upload (older apps); `ingests` is the whole batch, each with the files it holds.
  res.status(201).json({ success: true, data: ingestToApi(made[0]), ingests: made.map(ingestToApi), batchId });
}));

router.post("/ingest/:id/records", asyncHandler(async (req, res) => {
  const row = await loadOwn(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ success: false, message: "Upload not found." });
  const ids = [...new Set((Array.isArray(req.body?.recordIds) ? req.body.recordIds : []).map(String))].filter((x) => UUID.test(x)).slice(0, INGEST_LIMITS.FILES);
  if (!ids.length) return res.status(400).json({ success: false, message: "recordIds: at least one record is required." });
  const { data: records } = await edu().from("records").select("id, name, mime").eq("user_id", req.user.id).in("id", ids);
  if ((records || []).length !== ids.length) return res.status(403).json({ success: false, message: "One of those records isn't yours." });
  // "Only you can see this": a chat upload never shows in Discover (D51, D53).
  await edu().from("records").update({ private: true }).eq("user_id", req.user.id).in("id", ids);
  if (row.folder_id) {
    const { error } = await edu().from("library_folder_items")
      .upsert(records.map((r) => ({ folder_id: row.folder_id, user_id: req.user.id, ...folderItemFor(r, row.doc_kind) })), { onConflict: "folder_id,item_type,item_ref" });
    if (error) throw error;
  }
  const recordIds = [...new Set([...(row.record_ids || []), ...ids])];
  let next = row.state === "received" ? await move(row, "filed", { record_ids: recordIds })
    : (await edu().from("material_ingests").update({ record_ids: recordIds, updated_at: now() }).eq("id", row.id).select("*").single()).data;
  if (row.state === "received") {
    const first = !Array.isArray(row.filing?.fileIndexes) || row.filing.fileIndexes.includes(0);
    next = await addSteps(next, filedSteps({ ingestId: row.id, folderName: row.folder_name, first }));
  }
  // §8.8: the files join the learner's open Study Prep session in this subject (best effort).
  const { attachUploadsToStudyPrep } = await import("../adaptive-learning/study-prep/materials-source.js");
  const studyPrep = await attachUploadsToStudyPrep({ learnerId: req.user.id, subject: row.subject, recordIds: ids });
  res.json({ success: true, data: { ...ingestToApi(next), ...(studyPrep?.added ? { studyPrep } : {}) } });
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

/** A record's pages as text: parsed/extracted pages, or a paste split into parts. */
async function pagesOfRecord(record) {
  if (record.kind === "paste") {
    const parts = String(record.content || "").split(/\n{2,}/).reduce((acc, para) => {
      const last = acc[acc.length - 1];
      if (last && last.length + para.length < STRUCTURE_LIMITS.PAGE_CHARS) acc[acc.length - 1] = `${last}\n\n${para}`; else acc.push(para);
      return acc;
    }, []);
    return parts.map((text, i) => ({ pageNumber: i + 1, text }));
  }
  if (!record.file_key) return [];
  const ext = await getExtraction(record.file_key).catch(() => ({ pages: [] }));
  return (ext.pages || []).map((p) => ({ pageNumber: p.pageNumber, text: p.markdown || "" })).filter((p) => p.text.trim());
}

/** One file's read into topics and questions → { item, questions }, or null when it has no text. Never throws. */
async function readStructure(record, row, userId) {
  const pages = await pagesOfRecord(record).catch(() => []);
  if (!pages.length) return null;
  let raw = "{}";
  const readStarted = Date.now();
  let readOk = true;
  try {
    const out = await openai.chat.completions.create({
      __role: "background", messages: structureMessages({ names: [record.name], kindHint: row.doc_kind, pages }),
      temperature: 0, max_tokens: STRUCTURE_LIMITS.MAX_TOKENS, response_format: structureSchema(),
      __payer: "platform", __feature: "material_structure", __userId: userId,
      // Under the breaker's 60 s backstop: a slow read must not count as the provider failing for every chat.
      __timeoutMs: 50_000, __maxRetries: 0,
    });
    raw = out?.choices?.[0]?.message?.content || "{}";
  } catch (error) {
    readOk = false;
    console.warn("[materials] structure call failed:", String(error?.message || error).slice(0, 160));
  }
  const s = cleanStructure(raw, { pageNumbers: pages.map((p) => p.pageNumber), fallbackKind: row.doc_kind || "other" });
  return {
    item: { recordId: record.id, name: record.name, pages: pages.length, ...s, questions: undefined, questionCount: s.questions.length, ms: Date.now() - readStarted, ok: readOk },
    questions: s.questions.map((q) => ({ ...q, record_id: record.id, exam: s.exam, subject: s.subject || row.subject, year: s.year })),
  };
}

// Every file an upload can hold is read (2026-10-25: a 4-file upload read only 3), and all
// at once — one after another, 3–5 reads of up to 50 s outran the app's 120 s wait, so the
// "here's what I found" message never reached the open chat.
const STRUCTURE_FILES = INGEST_LIMITS.FILES;
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

  // Every read failed (the model was unavailable): keep nothing, say nothing — it can be tried again.
  if (calls && failures === calls) {
    const back = await move(row, "ready");
    // One failed-read step, updated in place; the app's last try (final) says so and offers Read it again on the card.
    const final = req.body?.final === true;
    await addSteps(back, [
      toolStep(`read:${row.id}:failed`, "material.read", `Reading ${row.names?.length === 1 ? row.names[0] : "your files"}`, { result: final ? "Couldn't read it" : "Couldn't read it just now — trying again", ok: false }),
      ...(final ? [messageStep(`read:${row.id}:failed:say`, "I couldn't read it just now — it's saved in your folder, nothing is lost. Tap **Read it again** on the card in a minute and I'll go through it.")] : []),
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
  // Filed by its name; now it's read. A different subject (or one found for an
  // Unsorted file) moves it to where that subject lives; still none → ask.
  const found = subjectLabel(main?.subject);
  const kind = main?.kind || row.doc_kind;
  const subject = found || row.subject;
  let filePatch = {};
  let filing = {};
  if (found && subjectKey(found) !== subjectKey(row.subject)) {
    const where = await resolveFolder(userId, { subject: found, kind }, await folderContext(userId));
    if (where.folder_id && where.folder_id !== row.folder_id) {
      filePatch = await refile(userId, { ...row, doc_kind: kind }, { id: where.folder_id, name: where.folder_name, created: where.folder_created });
      filing = { movedFrom: row.folder_name || null, choices: null };
    } else if (where.choices) filing = { choices: where.choices };
  } else if (!subject) {
    filing = { needsSubject: true, subjectOptions: [...new Set((main?.subjectGuesses || []).map(subjectLabel).filter(Boolean))].slice(0, 3) };
  }
  row = await move(row, "ready", { structure, subject, doc_kind: kind, ...filePatch, ...withFiling(row, filing) });
  // A failed try before this one is gone once it's read.
  row = await addSteps({ ...row, steps: (row.steps || []).filter((st) => !String(st.id).startsWith(`read:${row.id}:failed`)) },
    readSteps({ ingestId: row.id, items, moved: filing.movedFrom ? { to: row.folder_name, subject: row.subject } : null }));

  // What it found, said in the chat it came from (written by code from what was kept).
  let message = null;
  if (row.chat_session_id && items.length) {
    const found = items.length === 1
      ? structureMessage({ ...main, questions: questions.filter((q) => q.record_id === main.recordId) }, { pages: main.pages })
      : items.map((it) => `**${it.title || it.name}** — ${structureMessage({ ...it, questions: questions.filter((q) => q.record_id === it.recordId) }, { pages: it.pages }).replace(/^I've read it\.?\s*/, "")}`).join("\n\n");
    const filed = filingSentence({ names: row.names, title: main?.title, subject: row.subject, folder: row.folder_name, filing: row.filing, summary: main?.summary });
    const text = filed ? `${filed}\n\n${found}` : found;
    const materials = [
      ...(row.folder_id ? [{ kind: "folder", title: row.folder_name, href: `/library?folder=${row.folder_id}` }] : []),
      ...items.map((it) => ({ kind: "record", title: it.title || it.name, href: `/library?record=${it.recordId}` })),
    ].slice(0, 6);
    // The chips from every file read: the most tested topic across them all, a paper's study step if any is a paper.
    const allFiles = { ...main, kind: items.some((it) => it.kind === "past_paper") ? "past_paper" : main?.kind, topics: items.flatMap((it) => it.topics || []), questions };
    const meta = { ingest: { id: row.id }, materials, ideas: main ? structureChips(allFiles) : [] };
    const { data: msg } = await db.from("chat_messages").insert({ session_id: row.chat_session_id, user_id: userId, role: "agent", text, meta }).select("id, text, meta, created_at").single();
    if (msg) {
      message = msg;
      await db.from("chat_sessions").update({ last_message_at: now() }).eq("id", row.chat_session_id).eq("user_id", userId);
    }
  }
  // What was read joins the Library's search index, the way any other upload
  // does (Stage 1): findable by name and by content, and visible to the study
  // tools' resolver. Indexing never fails the ingest — indexRecord swallows
  // its own errors (the sweeper repairs a miss); this guard is the backstop.
  for (let i = 0; i < records.length; i++) {
    if (!reads[i]) continue;
    const record = records[i];
    try {
      if (record.kind === "paste") {
        await indexRecord({ userId, recordId: record.id, name: record.name, pasteText: record.content || "" });
      } else if (record.file_key) {
        const pages = await pagesOfRecord(record).catch(() => []);
        await indexRecord({ userId, recordId: record.id, name: record.name, contentKey: record.file_key,
          pages: pages.map((p) => ({ pageNumber: p.pageNumber, markdown: p.text })) });
      } else {
        await indexRecord({ userId, recordId: record.id, name: record.name });
      }
    } catch (e) {
      console.warn("[materials] indexing failed:", record.id, String(e?.message || e).slice(0, 160));
    }
  }
  res.json({ success: true, data: ingestToApi(row), message });
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
