/**
 * chatUploads.js — a file dropped into Agent Chat is saved to the Library
 * (Grand Plan §7.17, D51), the same way the Library's own upload does it:
 * presign → PUT the bytes → register the record → read it here in the
 * browser (hanji for scans). The API's material_ingest workflow owns the
 * folder, the state and the Undo.
 *
 *   startIngest({ files, ask, chatSessionId, replaces })   → [ingest…] — one per folder the files sort into
 *   filesOf(ingest, files)                                  the files one of them holds
 *   uploadChatFile(file, { onProgress, signal })            attach time: one picked file → its Library record
 *   readChatRecord(record, { onProgress })                  attach time: read that record in the browser
 *   attachIngestRecords(ingest, records)                    send time: point the ingest at the saved records
 *   readIngestRecords(ingest, items, onUpdate)              send time: the read, scored onto the ingest
 *   fileIngest(ingest, files, onUpdate)                     uploads, files, reads — onUpdate(ingest) on each step
 *   structureIngest(id)                                     reads it into topics (+ a past paper's questions) → { data, message }
 *   chooseFolder(id, folderId) · chooseSubject(id, subject|null)   the card's questions answered
 *   undoIngest(id) (→ Recently deleted, 30 days) · restoreIngest(id) · getIngest(id)
 *   chatFiles(chatId)                                       "Files in this chat"
 *   listDeleted() · purgeIngest(id)                         Recently deleted · Delete forever
 */
import { apiGet, apiPost } from '../services/api.js';
import { createRecord, extractStoredRecordText, getRecordExtraction, uploadRecordFile } from '../services/recordsApi.js';
import { extractUpload } from '../components/library/extractPages.js';

const BASE = '/api/agent/materials/ingest';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** The files the Library can keep (the same list as its own upload sheet). */
export const isLibraryFile = (f) => !!f && (/^(image|audio|video)\//.test(f.type) || f.type === 'application/pdf' || f.type === DOCX || f.type === PPTX
  || /\.(pdf|docx|pptx|txt|md|csv|mp3|m4a|aac|wav|ogg|flac|mp4|m4v|mov|webm|mkv)$/i.test(f.name || ''));

export async function startIngest({ files, ask, chatSessionId, replaces = null }) {
  const names = files.map((f) => f.name).slice(0, 5);
  const d = await apiPost(BASE, { names, ask, chatSessionId, ...(replaces ? { replaces } : {}) }, { timeout: 15000 });
  if (Array.isArray(d?.ingests) && d.ingests.length) return d.ingests;
  return d?.data ? [d.data] : [];
}

/** The files one upload of the batch holds (by their place in the message). */
export const filesOf = (ingest, files) => (Array.isArray(ingest?.fileIndexes) ? ingest.fileIndexes.map((i) => files[i]).filter(Boolean) : files);

const progress = (id, state, extra = {}) => apiPost(`${BASE}/${id}/progress`, { state, ...extra }).then((d) => d?.data ?? null);

/** How many pages the server now holds for a record (text read at registration, or parsed). */
async function pagesOf(record) {
  const saved = await getRecordExtraction(record.id).catch(() => ({ pages: [] }));
  if (saved?.pages?.length) return saved.pages.length;
  const read = await extractStoredRecordText({ recordId: record.id }).catch(() => null);
  return read?.pages?.length || 0;
}

/** Attach-time step 1 (composer): save ONE picked file to the Library —
 *  presign → PUT (progress + AbortSignal) → register the record. Runs the
 *  moment the file is picked, while the learner composes. */
export async function uploadChatFile(file, { onProgress, signal } = {}) {
  // One automatic retry on a transient failure (a dropped connection, a
  // slow presign, a 5xx): an attach that dies on a network blip shouldn't
  // be the learner's problem to notice and retry by hand. A rejection the
  // server actually decided (4xx) is final, and an abort is the learner's.
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return await uploadChatFileOnce(file, { onProgress, signal }); }
    catch (e) {
      lastErr = e;
      if (signal?.aborted || e?.name === 'AbortError') throw e;
      const status = e?.status;
      if (!(status == null || status >= 500 || status === 424)) throw e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

async function uploadChatFileOnce(file, { onProgress, signal } = {}) {

  if (!up?.uploadUrl) throw new Error('The Library is not taking uploads right now.');
  const up = await uploadRecordFile(file, onProgress, { signal });
  const created = await createRecord({ kind: 'upload', fileKey: up.fileKey, name: file.name, mime: file.type || '', size: file.size });
  const record = created?.record || created;
  if (!record?.id) throw new Error('Nothing could be saved.');
  return record;
}

/** Attach-time step 2 (composer): read ONE saved record here in the browser
 *  (hanji for scans; the server's own text read for the rest). Resolves
 *  { pages, failed, error } — a partial read still counts its pages, exactly
 *  as the post-send pipeline always scored it. Never throws. */
export async function readChatRecord(record, { onProgress } = {}) {
  const res = await extractUpload(record, { onProgress }).catch((e) => ({ status: 'error', error: e?.message }));
  if (res.status === 'done') return { pages: res.total || 0, failed: false, error: null };
  const pages = await pagesOf(record).catch(() => 0);
  if (res.status === 'error') return { pages, failed: !pages, error: pages ? null : (res.error || "Couldn't read it.") };
  return { pages, failed: false, error: null };   // skipped — text layer / text file / A/V: the server's lane
}

/** Post-send step 1: point an ingest at records that already exist (uploaded
 *  at attach time). Awaited before the chat turn is posted, so the turn and
 *  the read both find the files on the ingest. */
export async function attachIngestRecords(ingest, records) {
  if (!records?.length) return null;
  const d = await apiPost(`${BASE}/${ingest.id}/records`, { recordIds: records.map((r) => r.id) });
  return d?.data ?? null;
}

/** Post-send step 2: the read, scored onto the ingest. items are
 *  { record, read } — `read` is the attach-time read's promise when the
 *  composer already started (or finished) it, so a file is never read
 *  twice; without one the read runs here, as it always did. */
export async function readIngestRecords(ingest, items, onUpdate = () => {}) {
  let current = ingest;
  const set = (next) => { if (next) { current = next; onUpdate(next); } return current; };
  try {
    const records = (items || []).map((i) => i?.record).filter(Boolean);
    if (!records.length) throw new Error('Nothing could be saved.');
    set(await progress(ingest.id, 'extracting'));
    let pages = 0;
    let failed = null;
    for (const item of items) {
      if (!item?.record) continue;
      const res = item.read
        ? await item.read.catch(() => null) || await readChatRecord(item.record, { onProgress: (done, total) => onUpdate({ ...current, reading: { done: pages + done, total: pages + total } }) })
        : await readChatRecord(item.record, { onProgress: (done, total) => onUpdate({ ...current, reading: { done: pages + done, total: pages + total } }) });
      if (res.failed) failed = res.error || "Couldn't read it.";
      pages += res.pages || 0;
    }
    if (failed && !pages) return set(await progress(ingest.id, 'failed', { error: failed }));
    return set(await progress(ingest.id, 'ready', { pages }));
  } catch (e) {
    return set(await progress(ingest.id, 'failed', { error: e?.message || 'Saving failed.' }).catch(() => ({ ...current, state: 'failed', error: e?.message })));
  }
}

export async function fileIngest(ingest, files, onUpdate = () => {}) {
  let current = ingest;
  const set = (next) => { if (next) { current = next; onUpdate(next); } return current; };
  try {
    const records = [];
    for (const file of files.slice(0, 5)) records.push(await uploadChatFile(file));
    if (!records.length) throw new Error('Nothing could be saved.');
    set(await attachIngestRecords(ingest, records));
    return await readIngestRecords(current, records.map((record) => ({ record })), onUpdate);
  } catch (e) {
    return set(await progress(ingest.id, 'failed', { error: e?.message || 'Saving failed.' }).catch(() => ({ ...current, state: 'failed', error: e?.message })));
  }
}

/** Once read: what it covers, posted back into the chat by the API. Slow (one model pass over the pages). */
export async function structureIngest(id, { final = false } = {}) {
  // final: the last try — a failure then is said in the chat, with Read it again on the card.
  const d = await apiPost(`${BASE}/${id}/structure`, final ? { final: true } : {}, { timeout: 120000 });
  return { data: d?.data ?? null, message: d?.message ?? null };
}

/** "Find similar material" (D52): Akoro courses and posts on its topics; add the chosen ones, or not now. */
export const similarFor = (id) => apiPost(`${BASE}/${id}/similar`, {}, { timeout: 30000 }).then((d) => ({ data: d?.data ?? null, candidates: d?.candidates || [] }));
export const addSimilar = (id, keys) => apiPost(`${BASE}/${id}/similar/add`, { keys }, { timeout: 30000 }).then((d) => ({ data: d?.data ?? null, added: d?.added || [] }));
export const dismissSimilar = (id) => apiPost(`${BASE}/${id}/similar/dismiss`, {}).then((d) => d?.data ?? null);

export const undoIngest = (id) => apiPost(`${BASE}/${id}/undo`, {}).then((d) => d?.data ?? null);
export const restoreIngest = (id) => apiPost(`${BASE}/${id}/restore`, {}).then((d) => d?.data ?? null);
export const chooseFolder = (id, folderId) => apiPost(`${BASE}/${id}/folder`, { folderId }).then((d) => d?.data ?? null);
export const chooseSubject = (id, subject) => apiPost(`${BASE}/${id}/subject`, { subject }).then((d) => d?.data ?? null);
export const chatFiles = (chatId) => apiGet(`/api/agent/materials/chat/${chatId}`).then((d) => d?.files || []);
/** Recently deleted (30 days): the learner's undone uploads; Delete forever doesn't wait. */
export const listDeleted = () => apiGet('/api/agent/materials/deleted').then((d) => d?.items || []);
export const purgeIngest = (id) => apiPost(`${BASE}/${id}/purge`, {}).then((d) => d?.data ?? null);
export const getIngest = (id) => apiGet(`${BASE}/${id}`).then((d) => d?.data ?? null);
