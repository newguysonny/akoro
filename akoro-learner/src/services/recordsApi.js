/**
 * recordsApi.js — the learner's Library record shelf.
 *
 * Records used to be device-local (details only, no bytes, nothing
 * openable). They now live on the server: uploaded file BYTES go straight
 * to Cloudflare R2 via a presigned PUT (the API never proxies the bytes —
 * a 500 MB lesson recording shouldn't), and the row is registered after.
 * Links and pastes are plain JSON.
 *
 * Flow for an upload:
 *   1. presignRecordUpload()  → POST /api/records/upload-url → {uploadUrl, fileKey, store}
 *   2. putFileTo()            → PUT the raw file to uploadUrl (XHR so we get progress)
 *   3. createRecord()         → POST /api/records with the fileKey
 *
 * Reads: listRecords() returns each upload with a 6h presigned fileUrl —
 * <audio>/<video>/pdf.js stream it straight from Cloudflare with range
 * support, no auth headers needed.
 */

import { API, apiGet, apiPost, apiPatch, apiDelete, streamPost } from './api.js';

/** My shelf, newest first. Uploads carry fileUrl (presigned, 6h). */
export async function listRecords() {
  const d = await apiGet('/api/records');
  return d?.data ?? [];
}

/** The Contents/Materials discovery feed — everyone's uploads and pasted
 *  notes (Premium subscribers' stay private). Metadata only: no fileUrl
 *  rides the list; call discoverRecordOpen() when a card is tapped. */
/* The Contents/Materials discovery feed — the community's shared records,
   newest first. `q` (optional) searches the DATABASE (name + paste text);
   `limit` raises the fetch cap for search passes. */
export async function discoverRecords({ q, limit } = {}) {
  const params = new URLSearchParams();
  if (q && String(q).trim()) params.set('q', String(q).trim());
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  const d = await apiGet(`/api/records/discover${qs ? `?${qs}` : ''}`);
  return d?.data ?? [];
}

/** Open one discovered record — presigns its file (with download name),
 *  or returns the paste's full text. One call per open. */
export async function discoverRecordOpen(id) {
  const d = await apiGet(`/api/records/discover/${id}/open`);
  return d?.data ?? null;
}

/** Step 1 of an upload — ask the server for a PUT URL. */
export async function presignRecordUpload({ name, mime, size }) {
  const d = await apiPost('/api/records/upload-url', { name, mime, size });
  return d?.data ?? null;
}

/** Step 2 — PUT the raw bytes to the presigned URL. XHR (not fetch) so the
 *  sheet can show real upload progress; big files take a while on mobile. */
export function putFileTo(uploadUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    if (xhr.upload && onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }
    xhr.addEventListener('load', () =>
      (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.addEventListener('error', () => reject(new Error('Upload failed — check your connection.')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled.')));
    xhr.send(file);
  });
}

/** Step 3 — register what was uploaded (or a link, or a paste). */
export async function createRecord(payload) {
  const d = await apiPost('/api/records', payload);
  return d?.data ?? null;
}

/** Self-reported progress: 10 on first open, 100 on mark-done. */
export async function setRecordProgress(id, progress) {
  const d = await apiPatch(`/api/records/${id}`, { progress });
  return d?.data ?? null;
}

/* ── Folders — the shelf's organization layer ──────────────────────────────
   Created from the "Add to library" sheet. A cover rides the same
   presigned-PUT pipeline as record files (purpose 'folder-cover' makes
   the route enforce image-only + 5 MB). */

/** My folders, newest first. Each carries a presigned coverUrl (or null). */
export async function listFolders() {
  const d = await apiGet('/api/records/folders');
  return d?.data ?? [];
}

/** Step 1 of a cover upload — same endpoint, folder-cover purpose. */
export async function presignFolderCoverUpload({ name, mime, size }) {
  const d = await apiPost('/api/records/upload-url', { name, mime, size, purpose: 'folder-cover' });
  return d?.data ?? null;
}

/** Create the folder (coverKey comes from the presigned PUT, step 2). */
export async function createFolder({ name, description, visibility, coverKey }) {
  const d = await apiPost('/api/records/folders', { name, description, visibility, coverKey });
  return d?.data ?? null;
}

/** Rename a folder (any of name/description/visibility). */
export async function renameFolder(id, { name, description, visibility }) {
  const d = await apiPatch(`/api/records/folders/${id}`, { name, description, visibility });
  return d?.data ?? null;
}

/** Delete a folder (the cover object goes best-effort server-side). */
export async function deleteFolder(id) {
  await apiDelete(`/api/records/folders/${id}`);
  return true;
}

/** A folder's contents — snapshots stored at add time, newest first. */
export async function listFolderItems(folderId) {
  const d = await apiGet(`/api/records/folders/${folderId}/items`);
  return d?.data ?? [];
}

/** Add one thing to N folders (the Add-to-folder page multi-selects).
 * item = { itemType, itemRef, title, sub, kind, link }. Idempotent. */
export async function addFolderItem({ folderIds, itemType, itemRef, title, sub, kind, link }) {
  const d = await apiPost('/api/records/folders/items', { folderIds, itemType, itemRef, title, sub, kind, link });
  return d?.data ?? null;
}

/** Mark a record opened (server-side last_opened_at, no progress change). */
export async function touchRecordOpened(id) {
  await apiPatch(`/api/records/${id}`, { lastOpened: true });
}

export async function deleteRecord(id) {
  await apiDelete(`/api/records/${id}`);
  return true;
}

/* ── AI text extraction (hanji-parse-4b on RunPod) ────────────────────────
   The reader rasterizes a record's pages; the API runs each page through
   the parse worker and caches the result. Scanned PDFs and images come
   back with real, selectable, groundable text. */

/** The cached extraction for one of YOUR records (empty when none). */
export async function getRecordExtraction(recordId) {
  try {
    const d = await apiGet(`/api/records/extract/${recordId}`);
    return d?.data ?? { pages: [], markdown: '' };
  } catch { return { pages: [], markdown: '' }; }   // unconfigured / offline → no extraction, reader still works
}

/** The cached extraction for a SHARED file (its storage key) — parsed once for everyone. */
export async function getSharedExtraction(contentKey) {
  try {
    const d = await apiGet(`/api/records/extract/content/${encodeURIComponent(contentKey)}`);
    return d?.data ?? { pages: [], markdown: '' };
  } catch { return { pages: [], markdown: '' }; }
}

/** SUBMIT rendered pages ({pageNumber, imageBase64}) — one batch of ≤8.
    Returns at once ({ pending, failed? }); collect with getExtractionStatus.
    Throws with err.status 409 when another opener's batch is running. */
export async function extractRecordPages({ recordId, contentKey, pages }) {
  const d = await apiPost('/api/records/extract', contentKey ? { contentKey, pages } : { recordId, pages });
  return d?.data ?? { pending: [] };
}

/** One poll of the submitted batch → { done, pages (saved this poll), pending, failed }. */
export async function getExtractionStatus({ recordId, contentKey }) {
  const q = contentKey ? `contentKey=${encodeURIComponent(contentKey)}` : `recordId=${encodeURIComponent(recordId)}`;
  const d = await apiGet(`/api/records/extract/status?${q}`);
  return d?.data ?? { done: true, pages: [], pending: [], failed: [] };
}

/* ── Ask: questions about ONE document, answered with citations ───────────── */

const askTarget = ({ recordId, contentKey }) => (contentKey ? { contentKey } : { recordId });

/** The learner's Ask thread for this document. */
export async function getAskHistory({ recordId, contentKey }) {
  const q = contentKey ? `contentKey=${encodeURIComponent(contentKey)}` : `recordId=${encodeURIComponent(recordId)}`;
  const d = await apiGet(`/api/records/ask/history?${q}`);
  return d?.data?.messages ?? [];
}

/** Ask a question; the answer streams to onDelta. Resolves { answer, citations, messageId }. */
export async function askRecord({ recordId, contentKey, question, selection = null, onDelta, onStatus, signal }) {
  let result = null;
  const full = await streamPost('/api/records/ask?stream=1', { ...askTarget({ recordId, contentKey }), question, ...(selection ? { selection } : {}) }, {
    onDelta, onStatus, signal,
    onDone: (d) => { result = d; },
  });
  return result || { answer: full, citations: [] };
}

/** Generate a study tool (summary | quiz | flashcards) from the document — grounded, cited. */
export async function generateRecordTool({ recordId, contentKey, tool, scope = 'page', pageNumber = null, pageText = '', values = {} }) {
  const d = await apiPost(`/api/records/tools/${encodeURIComponent(tool)}`, {
    ...(contentKey ? { contentKey } : { recordId }),
    scope, ...(Number.isInteger(pageNumber) ? { pageNumber } : {}),
    ...(pageText ? { pageText: String(pageText).slice(0, 8000) } : {}),
    values,
  });
  return d?.data ?? {};
}

/** Semantic library search — hybrid (vector + keyword) over YOUR records'
    content: what a paste SAYS, what a scanned PDF contains, what a recording
    was about. [] when offline/unconfigured — the shelf stays browsable. */
export async function searchRecords(q, limit = 12) {
  try {
    const d = await apiGet(`/api/records/search?q=${encodeURIComponent(q)}&limit=${limit}`);
    return d?.data?.results ?? [];
  } catch { return []; }
}

/* ── A/V transcription (ffmpeg → Deepgram, via the API) ───────────────────
   The reader offers it for audio/video records; segments ground the
   session and drive click-to-seek in the player. */

/** The cached transcript for one of YOUR records (empty when none). */
export async function getRecordTranscript(recordId) {
  try {
    const d = await apiGet(`/api/records/transcribe/${recordId}`);
    return d?.data?.transcript ?? { segments: [], text: '' };
  } catch { return { segments: [], text: '' }; }
}

/** The cached transcript for a SHARED recording — transcribed once for everyone. */
export async function getSharedTranscript(contentKey) {
  try {
    const d = await apiGet(`/api/records/transcribe/content/${encodeURIComponent(contentKey)}`);
    return d?.data?.transcript ?? { segments: [], text: '' };
  } catch { return { segments: [], text: '' }; }
}

/** Start the transcription job (409 while someone else's runs — the shared
    transcript lands for everyone when it finishes). */
export async function startRecordTranscription({ recordId, contentKey }) {
  const d = await apiPost('/api/records/transcribe', contentKey ? { contentKey } : { recordId });
  return d?.data ?? {};
}

/** Start a COURSE lesson's transcription (shared cache keyed by the lesson —
    transcribed once for everyone; 409 just means someone's job is running). */
export async function startLessonTranscription(lessonId) {
  const d = await apiPost('/api/records/transcribe', { lessonId });
  return d?.data ?? {};
}

/** Course lesson job + transcript in one poll — { job, transcript }. */
export async function getLessonTranscriptionStatus(lessonId) {
  try {
    const d = await apiGet(`/api/records/transcribe/lesson/${lessonId}`);
    return d?.data ?? { job: null, transcript: { segments: [], text: '' } };
  } catch { return { job: null, transcript: { segments: [], text: '' } }; }
}

/** Job status + transcript in one poll — { job, transcript }. */
export async function getRecordTranscriptionStatus({ recordId, contentKey }) {
  const d = contentKey
    ? await apiGet(`/api/records/transcribe/content/${encodeURIComponent(contentKey)}`)
    : await apiGet(`/api/records/transcribe/${recordId}`);
  return d?.data ?? { job: null, transcript: { segments: [], text: '' } };
}

/** Stable "save a copy" link — cookies auth it, R2 serves the bytes. */
export const recordDownloadUrl = (id) => `${API}/api/records/${id}/file`;
