/**
 * modules/materials/routes.js — the `material_ingest` workflow (Grand Plan
 * §7.17.2, D51–D54): a file the learner drops into Agent Chat is saved to
 * their Library, in a folder the protégé picks or creates.
 *
 *   POST /api/agent/materials/ingest                { names, ask, chatSessionId?, replaces? }
 *        → classify, pick/create the folder → the ingest (state received)
 *   POST /api/agent/materials/ingest/:id/records    { recordIds }
 *        → the uploaded records go into the folder → filed
 *   POST /api/agent/materials/ingest/:id/progress   { state: extracting|ready|failed, pages?, error? }
 *   POST /api/agent/materials/ingest/:id/structure  → reads it: topics (+ a past paper's questions,
 *        private, D53), posts what it found into the chat → ready
 *   POST /api/agent/materials/ingest/:id/similar    → Akoro material on its topics (D52) → offering_more
 *   POST /api/agent/materials/ingest/:id/similar/add { keys } → the chosen ones into the folder → ready
 *   POST /api/agent/materials/ingest/:id/similar/dismiss      → "Not now" → ready
 *   POST /api/agent/materials/ingest/:id/undo       → removes exactly what it made → undone
 *   GET  /api/agent/materials/ingest/:id
 *
 * The bytes go up the way a Library upload does (presign → PUT → POST
 * /api/records) and the uploader's browser runs the same extraction (hanji
 * for scans) — this module only owns the folder, the state and the Undo.
 * Folders made here are private (D53); every move is checked against the
 * workflow definition (an unlisted move answers 409).
 */
import { Router } from "express";
import db from "../../db.js";
import { authenticateToken } from "../auth/routes.js";
import { openai } from "../../lib/aiModel.js";
import { removeRecordFile } from "../records/lib/storage.js";
import { getExtraction } from "../records/extractLib.js";
import { cleanStructure, structureChips, structureMessage, structureMessages, structureSchema, STRUCTURE_LIMITS } from "./structureCore.js";
import { folderItemForCandidate, searchTopics, shapeCandidates, SIMILAR_LIMITS } from "./similarCore.js";
import { searchBlogPosts } from "../adaptive-learning/blogResearch.js";
import { assertTransition, TransitionError } from "../workflows/definition.js";
import {
  INGEST_LIMITS, ingestWorkflow, classifyMessages, classifySchema, folderItemFor, folderNameFor, guessKind, ingestToApi, shapeClassification,
} from "./ingestCore.js";

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

/** Classify from names + the learner's words: a small capped call, the platform's (D46); a guess if it fails. */
async function classify(names, ask, userId) {
  const fallback = guessKind({ names, ask });
  try {
    const res = await openai.chat.completions.create({
      __role: "background", messages: classifyMessages({ names, ask }), temperature: 0, max_tokens: 80,
      response_format: classifySchema(),
      __payer: "platform", __feature: "material_ingest", __userId: userId, __timeoutMs: 8_000, __maxRetries: 0,
    });
    return shapeClassification(res?.choices?.[0]?.message?.content, fallback);
  } catch (error) {
    console.warn("[materials] classify fell back to the guess:", String(error?.message || error).slice(0, 120));
    return fallback;
  }
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
  const kind = await classify(names, ask, userId);
  const folderName = folderNameFor(kind);
  const folder = await folderFor(userId, folderName);
  const { data, error } = await edu().from("material_ingests").insert({
    user_id: userId, chat_session_id: chatSessionId, names, state: "received",
    folder_id: folder?.id || null, folder_name: folder?.name || null, folder_created: !!folder?.created,
    doc_kind: kind.kind, subject: kind.subject,
    ...(replaced?.state === "undone" && replaced.chat_message_id ? { chat_message_id: replaced.chat_message_id, chat_session_id: replaced.chat_session_id } : {}),
  }).select("*").single();
  if (error) throw error;
  if (data.chat_message_id) {
    const { data: msg } = await db.from("chat_messages").select("meta").eq("id", data.chat_message_id).eq("user_id", userId).maybeSingle();
    if (msg) await db.from("chat_messages").update({ meta: { ...(msg.meta || {}), ingest: { id: data.id } } }).eq("id", data.chat_message_id).eq("user_id", userId);
  }
  res.status(201).json({ success: true, data: ingestToApi(data) });
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
  const next = row.state === "received" ? await move(row, "filed", { record_ids: recordIds })
    : (await edu().from("material_ingests").update({ record_ids: recordIds, updated_at: now() }).eq("id", row.id).select("*").single()).data;
  res.json({ success: true, data: ingestToApi(next) });
}));

const PROGRESS = new Set(["extracting", "ready", "failed"]);
router.post("/ingest/:id/progress", asyncHandler(async (req, res) => {
  const row = await loadOwn(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ success: false, message: "Upload not found." });
  const to = String(req.body?.state || "");
  if (!PROGRESS.has(to)) return res.status(400).json({ success: false, message: "state: extracting, ready or failed." });
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

const STRUCTURE_FILES = 3;
router.post("/ingest/:id/structure", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  let row = await loadOwn(req.params.id, userId);
  if (!row) return res.status(404).json({ success: false, message: "Upload not found." });
  // Once per upload: a second call returns what the first found.
  if (row.structure) return res.json({ success: true, data: ingestToApi(row), message: null });
  if (row.state !== "ready") return res.status(409).json({ success: false, code: "not_ready", message: "It isn't read yet." });
  const ids = (row.record_ids || []).slice(0, STRUCTURE_FILES);
  const { data: records } = await edu().from("records").select("id, name, kind, mime, file_key, content").eq("user_id", userId).in("id", ids);
  row = await move(row, "structured");

  const items = [];
  const questions = [];
  let calls = 0, failures = 0;
  for (const record of records || []) {
    const pages = await pagesOfRecord(record);
    if (!pages.length) continue;
    let raw = "{}";
    calls += 1;
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
      failures += 1;
      console.warn("[materials] structure call failed:", String(error?.message || error).slice(0, 160));
    }
    const s = cleanStructure(raw, { pageNumbers: pages.map((p) => p.pageNumber), fallbackKind: row.doc_kind || "other" });
    items.push({ recordId: record.id, name: record.name, pages: pages.length, ...s, questions: undefined, questionCount: s.questions.length });
    for (const q of s.questions) questions.push({ ...q, record_id: record.id, exam: s.exam, subject: s.subject || row.subject, year: s.year });
  }

  // Every read failed (the model was unavailable): keep nothing, say nothing — it can be tried again.
  if (calls && failures === calls) {
    await move(row, "ready");
    return res.status(503).json({ success: false, code: "structure_unavailable", message: "Couldn't read it just now — try again in a moment." });
  }
  const main = items[0] || null;
  const structure = {
    items: items.map(({ dropped, ...it }) => it),
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
  // A folder this upload made under "From chat — …" gets its real name once the subject is known.
  const subject = main?.subject || row.subject;
  const kind = main?.kind || row.doc_kind;
  if (row.folder_id && row.folder_created && /^From chat/.test(row.folder_name || "") && subject) {
    const better = folderNameFor({ subject, kind });
    const { error } = await edu().from("library_folders").update({ name: better, updated_at: now() }).eq("id", row.folder_id).eq("user_id", userId);
    if (!error) row.folder_name = better;
  }
  row = await move(row, "ready", { structure, subject, doc_kind: kind, folder_name: row.folder_name });

  // What it found, said in the chat it came from (written by code from what was kept).
  let message = null;
  if (row.chat_session_id && items.length) {
    const text = items.length === 1
      ? structureMessage({ ...main, questions: questions.filter((q) => q.record_id === main.recordId) }, { pages: main.pages })
      : items.map((it) => `**${it.title || it.name}** — ${structureMessage({ ...it, questions: questions.filter((q) => q.record_id === it.recordId) }, { pages: it.pages }).replace(/^I've read it\.?\s*/, "")}`).join("\n\n");
    const materials = [
      ...(row.folder_id ? [{ kind: "folder", title: row.folder_name, href: `/library?folder=${row.folder_id}` }] : []),
      ...items.map((it) => ({ kind: "record", title: it.title || it.name, href: `/library?record=${it.recordId}` })),
    ].slice(0, 6);
    const meta = { ingest: { id: row.id }, materials, ideas: main ? structureChips({ ...main, questions }) : [] };
    const { data: msg } = await db.from("chat_messages").insert({ session_id: row.chat_session_id, user_id: userId, role: "agent", text, meta }).select("id, text, meta, created_at").single();
    if (msg) {
      message = msg;
      await db.from("chat_sessions").update({ last_message_at: now() }).eq("id", row.chat_session_id).eq("user_id", userId);
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
  const candidates = await findSimilar(row, req.user.id);
  if (row.state === "ready") row = await move(row, "offering_more", { structure: { ...row.structure, offered: candidates.map((c) => c.key) } });
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

router.post("/ingest/:id/undo", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const row = await loadOwn(req.params.id, userId);
  if (!row) return res.status(404).json({ success: false, message: "Upload not found." });
  if (row.state === "undone") return res.json({ success: true, data: ingestToApi(row) });
  assertTransition(ingestWorkflow, row.state, "undone");
  const ids = (row.record_ids || []).map(String);
  if (ids.length) {
    // Out of every folder (a learner may have filed it elsewhere too), then the records and their files.
    await edu().from("library_folder_items").delete().eq("user_id", userId).eq("item_type", "record").in("item_ref", ids);
    const { data: records } = await edu().from("records").select("id, file_key").eq("user_id", userId).in("id", ids);
    await edu().from("records").delete().eq("user_id", userId).in("id", ids);
    for (const r of records || []) void removeRecordFile(r.file_key);
  }
  await edu().from("material_questions").delete().eq("user_id", userId).eq("ingest_id", row.id);
  // …and the similar material it added to the folder.
  const added = (row.structure?.added || []).map(String);
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
  const done = await move(row, "undone", folderRemoved ? { folder_id: null } : {});
  res.json({ success: true, data: { ...ingestToApi(done), folderRemoved } });
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
