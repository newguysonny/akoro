/**
 * chatUploads.js — a file dropped into Agent Chat is saved to the Library
 * (Grand Plan §7.17, D51), the same way the Library's own upload does it:
 * presign → PUT the bytes → register the record → read it here in the
 * browser (hanji for scans). The API's material_ingest workflow owns the
 * folder, the state and the Undo.
 *
 *   startIngest({ files, ask, chatSessionId, replaces })   → the ingest (folder picked)
 *   fileIngest(ingest, files, onUpdate)                     uploads, files, reads — onUpdate(ingest) on each step
 *   structureIngest(id)                                     reads it into topics (+ a past paper's questions) → { data, message }
 *   undoIngest(id) · getIngest(id)
 */
import { apiGet, apiPost } from '../services/api.js';
import { createRecord, extractStoredRecordText, getRecordExtraction, presignRecordUpload, putFileTo } from '../services/recordsApi.js';
import { extractUpload } from '../components/library/extractPages.js';

const BASE = '/api/agent/materials/ingest';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** The files the Library can keep (the same list as its own upload sheet). */
export const isLibraryFile = (f) => !!f && (/^(image|audio|video)\//.test(f.type) || f.type === 'application/pdf' || f.type === DOCX || f.type === PPTX
  || /\.(pdf|docx|pptx|txt|md|csv|mp3|m4a|aac|wav|ogg|flac|mp4|m4v|mov|webm|mkv)$/i.test(f.name || ''));

export async function startIngest({ files, ask, chatSessionId, replaces = null }) {
  const names = files.map((f) => f.name).slice(0, 5);
  const d = await apiPost(BASE, { names, ask, chatSessionId, ...(replaces ? { replaces } : {}) }, { timeout: 12000 });
  return d?.data ?? null;
}

const progress = (id, state, extra = {}) => apiPost(`${BASE}/${id}/progress`, { state, ...extra }).then((d) => d?.data ?? null);

/** How many pages the server now holds for a record (text read at registration, or parsed). */
async function pagesOf(record) {
  const saved = await getRecordExtraction(record.id).catch(() => ({ pages: [] }));
  if (saved?.pages?.length) return saved.pages.length;
  const read = await extractStoredRecordText({ recordId: record.id }).catch(() => null);
  return read?.pages?.length || 0;
}

export async function fileIngest(ingest, files, onUpdate = () => {}) {
  let current = ingest;
  const set = (next) => { if (next) { current = next; onUpdate(next); } return current; };
  try {
    const records = [];
    for (const file of files.slice(0, 5)) {
      const up = await presignRecordUpload({ name: file.name, mime: file.type || '', size: file.size });
      if (!up?.uploadUrl) throw new Error('The Library is not taking uploads right now.');
      await putFileTo(up.uploadUrl, file);
      const created = await createRecord({ kind: 'upload', fileKey: up.fileKey, name: file.name, mime: file.type || '', size: file.size });
      const record = created?.record || created;
      if (record?.id) records.push(record);
    }
    if (!records.length) throw new Error('Nothing could be saved.');
    set((await apiPost(`${BASE}/${ingest.id}/records`, { recordIds: records.map((r) => r.id) }))?.data);
    set(await progress(ingest.id, 'extracting'));
    let pages = 0;
    let failed = null;
    for (const record of records) {
      const res = await extractUpload(record, {
        onProgress: (done, total) => onUpdate({ ...current, reading: { done: pages + done, total: pages + total } }),
      }).catch((e) => ({ status: 'error', error: e?.message }));
      if (res.status === 'error') failed = res.error || "Couldn't read it.";
      pages += res.status === 'done' ? res.total : await pagesOf(record);
    }
    if (failed && !pages) return set(await progress(ingest.id, 'failed', { error: failed }));
    return set(await progress(ingest.id, 'ready', { pages }));
  } catch (e) {
    return set(await progress(ingest.id, 'failed', { error: e?.message || 'Saving failed.' }).catch(() => ({ ...current, state: 'failed', error: e?.message })));
  }
}

/** Once read: what it covers, posted back into the chat by the API. Slow (one model pass over the pages). */
export async function structureIngest(id) {
  const d = await apiPost(`${BASE}/${id}/structure`, {}, { timeout: 120000 });
  return { data: d?.data ?? null, message: d?.message ?? null };
}

/** "Find similar material" (D52): Akoro courses and posts on its topics; add the chosen ones, or not now. */
export const similarFor = (id) => apiPost(`${BASE}/${id}/similar`, {}, { timeout: 30000 }).then((d) => ({ data: d?.data ?? null, candidates: d?.candidates || [] }));
export const addSimilar = (id, keys) => apiPost(`${BASE}/${id}/similar/add`, { keys }, { timeout: 30000 }).then((d) => ({ data: d?.data ?? null, added: d?.added || [] }));
export const dismissSimilar = (id) => apiPost(`${BASE}/${id}/similar/dismiss`, {}).then((d) => d?.data ?? null);

export const undoIngest = (id) => apiPost(`${BASE}/${id}/undo`, {}).then((d) => d?.data ?? null);
export const getIngest = (id) => apiGet(`${BASE}/${id}`).then((d) => d?.data ?? null);
