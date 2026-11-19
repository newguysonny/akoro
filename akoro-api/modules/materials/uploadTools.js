/**
 * modules/materials/uploadTools.js — the agent's upload tools (Matt,
 * 2026-11-16): the chat-upload pipeline as tools the agent calls itself.
 *
 * Upload + extraction still happen in the composer (attach time, the
 * browser's lanes); everything after that is the agent's:
 *   read_upload       — the extraction state, then the extracted content
 *                       from the database (waits a while for a read still
 *                       running; says failed plainly so the agent can retry)
 *   retry_extraction  — re-run a failed extraction (server lane inline;
 *                       scans are re-read by the app, flagged in the result)
 *   list_folders      — the learner's Library folders, for the sort decision
 *   file_upload       — file it from the agent's decision (title, subject,
 *                       kind, topics, or an explicit folder): the filing
 *                       mechanics are filingDb's, shared with /structure.
 * The server never posts into the chat — the agent narrates its own work.
 */
import db from "../../db.js";
import { loadOwn, move, pagesOfRecord, readStructure, fileIngestFromDecision } from "./filingDb.js";
import { DOC_KINDS } from "./ingestCore.js";
import { subjectLabel } from "./folderMatch.js";
import { storedTextKindOf, extractStoredText } from "../records/index.js";
import { createPresignedDownload } from "../records/index.js";

const edu = () => db.schema("edu");
const TEXT_CAP = 12_000;             // the same cap the old context injection used
const WAIT_MS = 45_000;              // read_upload waits this long for a running extraction
const POLL_MS = 3_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One record's extraction state from the database: pages = extracted. */
export async function extractionStateOf(row, record) {
  if (record.kind === "paste") return String(record.content || "").trim() ? "ready" : "failed";
  if (!record.file_key) return "failed";
  const pages = await pagesOfRecord(record).catch(() => []);
  if (pages.some((p) => String(p.text || "").trim())) return "ready";
  return row.state === "failed" ? "failed" : "extracting";
}

async function loadRecords(userId, row) {
  const ids = (row.record_ids || []).map(String);
  if (!ids.length) return [];
  const { data } = await edu().from("records").select("id, name, kind, mime, file_key, content").eq("user_id", userId).in("id", ids);
  return ids.map((id) => (data || []).find((r) => r.id === id)).filter(Boolean);
}

async function statesOf(userId, row) {
  const records = await loadRecords(userId, row);
  const states = new Map();
  for (const record of records) states.set(record.id, await extractionStateOf(row, record));
  return { records, states };
}

export async function readUploadTool({ userId, ingestId }) {
  const row = await loadOwn(ingestId, userId);
  if (!row) return { error: "That upload isn't yours or doesn't exist.", code: "not_found" };
  if (row.state === "undone") return { state: "undone", note: "The learner removed this upload (it's in Recently deleted). Don't work on it." };
  let { records, states } = await statesOf(userId, row);
  // A read still running gets a bounded wait — most extractions land in seconds.
  const deadline = Date.now() + WAIT_MS;
  while ([...states.values()].includes("extracting") && Date.now() < deadline) {
    await sleep(POLL_MS);
    ({ records, states } = await statesOf(userId, row));
  }
  const byState = (st) => records.filter((r) => states.get(r.id) === st);
  const extracting = byState("extracting");
  if (extracting.length) {
    return { state: "extracting", ingestId: row.id, files: extracting.map((r) => r.name),
      note: "Still being read in the background. Tell the learner it's still being read and you'll work on it as soon as it's ready — don't invent anything about its content. They can nudge you again in a moment; the upload stays listed for the next turn." };
  }
  const failed = byState("failed");
  const ready = byState("ready");
  if (!ready.length && failed.length) {
    return { state: "failed", ingestId: row.id, files: failed.map((r) => r.name),
      next: "Call retry_extraction for this upload, then call read_upload again. If it fails a second time, tell the learner plainly and carry on with the rest of their message." };
  }
  // Ready: the extracted content itself, from the database.
  let budget = TEXT_CAP;
  const parts = [];
  const files = [];
  for (const record of ready) {
    const pages = await pagesOfRecord(record).catch(() => []);
    const text = pages.map((p) => p.text).join("\n\n").slice(0, Math.max(0, budget));
    budget -= text.length;
    files.push({ recordId: record.id, name: record.name, kind: record.kind, pages: pages.length || 1 });
    parts.push(`## ${record.name}\n${text}`);
  }
  const filed = !!(row.structure && row.folder_id);
  return {
    state: "ready", ingestId: row.id, files,
    ...(failed.length ? { failedFiles: failed.map((r) => r.name) } : {}),
    ...(filed ? { alreadyFiled: true, folder: row.folder_name, subject: row.subject } : {}),
    content: parts.join("\n\n"),
    next: filed
      ? "This upload is already filed (see folder). Work from the content above; don't file it again."
      : "Decide from the content AND the conversation: a short descriptive title, the subject, the kind (past_paper, notes, textbook, syllabus, slides or other) and up to 6 topic names. Call list_folders if an existing folder might fit, then file_upload with your decision. Then tell the learner briefly what it is and where you filed it, and carry on with what they asked.",
  };
}

export async function retryExtractionTool({ userId, ingestId }) {
  const row = await loadOwn(ingestId, userId);
  if (!row) return { error: "That upload isn't yours or doesn't exist.", code: "not_found" };
  const { records, states } = await statesOf(userId, row);
  const failed = records.filter((r) => states.get(r.id) === "failed");
  if (!failed.length) return { state: "nothing_to_retry", next: "Call read_upload — nothing is marked failed." };
  const retried = [];
  let clientReread = false;
  for (const record of failed) {
    if (record.file_key && storedTextKindOf(record.mime, record.name)) {
      try {
        const fileUrl = await createPresignedDownload(record.file_key, { downloadName: record.name });
        await extractStoredText({ userId, contentKey: record.file_key, name: record.name, mime: record.mime, fileUrl });
        retried.push(record.name);
      } catch { clientReread = true; }
    } else {
      // Scans and photos are read by the app's own lane; the client re-runs
      // its read when it sees this tool in the turn (like its task refetches).
      clientReread = true;
    }
  }
  if (row.state === "failed") await move(row, "extracting").catch(() => null);
  return {
    state: "retrying", ingestId: row.id,
    ...(retried.length ? { retried } : {}),
    ...(clientReread ? { clientReread: true } : {}),
    next: "Call read_upload again — it waits for the new read to land.",
  };
}

export async function listFoldersTool({ userId }) {
  const [{ data: folders }, { data: items }] = await Promise.all([
    edu().from("library_folders").select("id, name").eq("user_id", userId).order("name").limit(50),
    edu().from("library_folder_items").select("folder_id").eq("user_id", userId).limit(2000),
  ]);
  const counts = new Map();
  for (const it of items || []) counts.set(it.folder_id, (counts.get(it.folder_id) || 0) + 1);
  return { folders: (folders || []).map((f) => ({ folderId: f.id, name: f.name, items: counts.get(f.id) || 0 })) };
}

export async function fileUploadTool({ userId, ingestId, title = null, subject = null, kind = null, folderId = null, topics = [] }) {
  const row0 = await loadOwn(ingestId, userId);
  if (!row0) return { error: "That upload isn't yours or doesn't exist.", code: "not_found" };
  if (row0.state === "undone") return { error: "That upload was removed.", code: "undone" };
  if (row0.structure && row0.folder_id) {
    return { state: "already_filed", folder: row0.folder_name, subject: row0.subject, note: "Already filed — don't file it again." };
  }
  const { records, states } = await statesOf(userId, row0);
  if (!records.length) return { error: "That upload has no files.", code: "empty" };
  if ([...states.values()].some((st) => st !== "ready")) {
    return { state: "not_read", next: "Call read_upload first — file only what you have read." };
  }
  const docKind = DOC_KINDS.includes(String(kind || "")) ? String(kind) : (row0.doc_kind || "other");
  const subj = subject ? subjectLabel(subject) : null;
  // An explicit folder must be the learner's own.
  let folder = null;
  if (folderId) {
    const { data } = await edu().from("library_folders").select("id, name").eq("id", String(folderId)).eq("user_id", userId).maybeSingle();
    if (!data) return { error: "That folder isn't the learner's.", code: "bad_folder" };
    folder = { id: data.id, name: data.name };
  }
  // Past papers keep their question harvest: the server's structured read
  // extracts the questions by topic (best effort — the agent's own items
  // stand when it can't).
  let items = null;
  let questions = [];
  if (docKind === "past_paper") {
    const reads = await Promise.all(records.map((r) => readStructure(r, row0, userId).catch(() => null)));
    const built = reads.filter(Boolean);
    if (built.length) {
      items = built.map((b) => b.item);
      questions = built.flatMap((b) => b.questions);
    }
  }
  const topicObjs = [...new Set((Array.isArray(topics) ? topics : []).map((t) => String(t || "").trim()).filter(Boolean))].slice(0, 6)
    .map((name) => ({ name, weight: 1 }));
  if (!items) {
    items = records.map((record, i) => ({
      recordId: record.id, name: record.name, title: i === 0 && title ? String(title).slice(0, 120) : record.name,
      subject: subj, kind: docKind, topics: topicObjs, pages: 1, questionCount: 0,
    }));
  }
  const structure = {
    items: items.map(({ dropped, ms, ok, ...it }) => it),
    topics: [...new Map(items.flatMap((it) => it.topics || []).map((t) => [String(t.name).toLowerCase(), t])).values()].slice(0, 30),
    questionCount: questions.length,
  };
  // The agent's title becomes the lead file's name in the Library.
  if (title && records[0] && records[0].name !== title) {
    await edu().from("records").update({ name: String(title).slice(0, 120) }).eq("id", records[0].id).eq("user_id", userId);
  }
  const { row } = await fileIngestFromDecision({ userId, row: row0, subject: subj, kind: docKind, structure, items, questions, records, folder });
  const filing = row.filing || {};
  return {
    state: "filed", ingestId: row.id,
    folder: row.folder_name || null, subject: row.subject || null, kind: docKind,
    ...(filing.needsSubject ? { needsSubject: true, next: "It's filed in From chat — Unsorted for now. Ask the learner which subject it is, in one line." } : {}),
    ...(filing.choices ? { folderChoices: (filing.choices || []).map((c) => c.name || c), next: "Two folders fit — the card asks the learner to pick; mention both names briefly." } : {}),
    ...(!filing.needsSubject && !filing.choices ? { next: "Tell the learner briefly what the file is and the folder you filed it in, then carry on with what they asked." } : {}),
  };
}
