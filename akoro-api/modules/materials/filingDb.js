/**
 * modules/materials/filingDb.js — the material-ingest filing machinery,
 * shared by the HTTP routes (routes.js) and the agent's upload tools
 * (uploadTools.js): load a learner's upload, move it through the workflow,
 * pick or create its folder, file its records, write its steps, read a
 * record's structure, and file an upload ONCE from a decision — whoever
 * made it (the server's read, or the agent's read_upload → file_upload).
 * Nothing here posts into a chat: narration belongs to the agent.
 */
import db from "../../db.js";
import { openai } from "../../lib/aiModel.js";
import { getExtraction } from "../records/extractLib.js";
import { indexRecord } from "../records/searchLib.js";
import { assertTransition, TransitionError } from "../workflows/definition.js";
import { INGEST_LIMITS, ingestWorkflow, folderItemFor } from "./ingestCore.js";
import { pickFolder } from "./folderMatch.js";
import { cleanStructure, structureMessages, structureSchema, STRUCTURE_LIMITS } from "./structureCore.js";
import { appendSteps, filedSteps, readSteps } from "./stepsCore.js";

const edu = () => db.schema("edu");
const UUID = /^[0-9a-f-]{36}$/i;
const MAX_FOLDERS = 50;

export const now = () => new Date().toISOString();

export async function loadOwn(id, userId) {
  if (!UUID.test(String(id))) return null;
  const { data } = await edu().from("material_ingests").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  return data || null;
}

/** Move the ingest, checked against the definition and pinned to its current state. */
export async function move(row, to, patch = {}) {
  assertTransition(ingestWorkflow, row.state, to);
  const { data, error } = await edu().from("material_ingests").update({ ...patch, state: to, updated_at: now() })
    .eq("id", row.id).eq("state", row.state).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new TransitionError("The upload changed meanwhile — refresh and try again.", { from: row.state, to });
  return data;
}

/** What the learner already has: folders, what earlier uploads filed where, the folders they chose. */
export async function folderContext(userId) {
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
export async function resolveFolder(userId, { subject, kind }, ctx) {
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
export async function refile(userId, row, target) {
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

/**
 * The Stage 4 fallback: an upload whose read won't happen now is filed once,
 * into "From chat — Unsorted", so it waits somewhere findable. → the patched
 * row, or null when there is nowhere to file (folder cap, no Unsorted).
 */
export async function fileUnsorted(userId, row) {
  const where = await resolveFolder(userId, { subject: null, kind: row.doc_kind || "other" }, await folderContext(userId));
  if (!where.folder_id || where.folder_id === row.folder_id) return null;
  const patch = await refile(userId, row, { id: where.folder_id, name: where.folder_name, created: where.folder_created });
  const { data } = await edu().from("material_ingests").update({ ...patch, updated_at: now() }).eq("id", row.id).select("*").single();
  return data || null;
}

const withFiling = (row, patch) => ({ filing: { ...(row.filing || {}), ...patch } });

/** Add steps to an upload (the chat shows them under its message). Best effort: a step never fails the upload. */
export async function addSteps(row, steps) {
  if (!row || !steps.length) return row;
  const { data } = await edu().from("material_ingests").update({ steps: appendSteps(row.steps, steps.map((s) => ({ ...s, at: s.at || now() }))) })
    .eq("id", row.id).select("*").maybeSingle().then((r) => r, () => ({ data: null }));
  return data || row;
}

/** An existing folder with this name (any case), else a new private one. → { id, name, created } | null */
export async function folderFor(userId, name) {
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


/** A record's pages as text: parsed/extracted pages, or a paste split into parts. */
export async function pagesOfRecord(record) {
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
export async function readStructure(record, row, userId) {
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

/**
 * File an upload ONCE from a decision — the folder from the subject/kind
 * (or the learner's own folder for it), the steps written, the read stored,
 * the records indexed and joined to Study Prep. Shared by POST /structure
 * (decision from the server's read) and the agent's file_upload tool
 * (decision from the agent's read). Returns { row, studyPrep }.
 */
export async function fileIngestFromDecision({ userId, row, subject, kind, guesses = [], structure, items = [], questions = [], records = [], folder = null }) {
  let filePatch = {};
  let filing = {};
  // An explicit folder (the agent picked one from list_folders) bypasses the
  // subject/kind pick; the mechanics below are identical either way.
  const where = folder
    ? { folder_id: folder.id, folder_name: folder.name, folder_created: false, choices: null }
    : await resolveFolder(userId, { subject, kind }, await folderContext(userId));
  if (where.folder_id) {
    if (where.folder_id !== row.folder_id) filePatch = await refile(userId, { ...row, doc_kind: kind }, { id: where.folder_id, name: where.folder_name, created: where.folder_created });
    filing = subject ? { filed: true, movedFrom: filePatch.folder_id && row.folder_id ? row.folder_name || null : null, choices: null }
      : { needsSubject: true, subjectOptions: guesses };
  } else if (where.choices) filing = { choices: where.choices };
  else if (!subject) filing = { needsSubject: true, subjectOptions: guesses };
  if (row.state !== "structured") row = await move(row, "structured");
  row = await move(row, "ready", { structure, subject, doc_kind: kind, ...filePatch, ...withFiling(row, filing) });
  // A failed try before this one is gone once it's read; the filing step is written now that it's real.
  const first = !Array.isArray(row.filing?.fileIndexes) || row.filing.fileIndexes.includes(0);
  row = await addSteps({ ...row, steps: (row.steps || []).filter((st) => !String(st.id).startsWith(`read:${row.id}:failed`)) },
    [...(filing.filed || filePatch.folder_id ? filedSteps({ ingestId: row.id, folderName: row.folder_name, first }) : []),
     ...readSteps({ ingestId: row.id, items, moved: filing.movedFrom ? { to: row.folder_name, subject: row.subject } : null })]);
  if (questions.length) {
    const { error } = await edu().from("material_questions").insert(questions.map((q) => ({
      user_id: userId, ingest_id: row.id, record_id: q.record_id, exam: q.exam, subject: q.subject, year: q.year,
      number: q.number, marks: q.marks, topic: q.topic, page: q.page, text: q.text,
    })));
    if (error) console.warn("[materials] questions not saved:", error.message);
  }
  // What was read joins the Library's search index, the way any other upload
  // does (Stage 1). Indexing never fails the ingest — indexRecord swallows
  // its own errors (the sweeper repairs a miss); this guard is the backstop.
  const readIds = new Set(items.map((it) => it.recordId));
  for (const record of records) {
    if (!readIds.has(record.id)) continue;
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
  // §8.8: the files join the learner's open Study Prep session in the
  // decision's subject (best effort).
  const { attachUploadsToStudyPrep } = await import("../adaptive-learning/study-prep/materials-source.js");
  const studyPrep = await attachUploadsToStudyPrep({ learnerId: userId, subject, recordIds: row.record_ids || [] }).catch(() => null);
  return { row, studyPrep };
}
