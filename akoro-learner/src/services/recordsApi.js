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
 *   1. presignRecordUpload()  → POST /api/records/upload-url → {uploadUrl, fileKey}
 *   2. putFileTo()            → PUT the raw file to uploadUrl (XHR so we get progress)
 *   3. createRecord()         → POST /api/records with the fileKey
 *
 * Reads: listRecords() returns each upload with a 6h presigned fileUrl —
 * <audio>/<video>/pdf.js stream it straight from Cloudflare with range
 * support, no auth headers needed.
 */

import { API, apiGet, apiPost, apiPatch, apiDelete } from './api.js';

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

/** The cached extraction for a record — { pages:[{pageNumber,markdown}], markdown } (empty when none). */
export async function getRecordExtraction(recordId) {
  try {
    const d = await apiGet(`/api/records/extract/${recordId}`);
    return d?.data ?? { pages: [], markdown: '' };
  } catch { return { pages: [], markdown: '' }; }   // unconfigured / offline → no extraction, reader still works
}

/** Send rendered pages ({pageNumber, imageBase64}) — one batch of ≤8. */
export async function extractRecordPages({ recordId, pages }) {
  const d = await apiPost('/api/records/extract', { recordId, pages });
  return d?.data ?? { pages: [] };
}

/* ── A/V transcription (ffmpeg → Deepgram, via the API) ───────────────────
   The reader offers it for audio/video records; segments ground the
   session and drive click-to-seek in the player. */

/** Cached transcript — { segments:[{kind,startMs,endMs,speaker,text}], text } (empty when none). */
export async function getRecordTranscript(recordId) {
  try {
    const d = await apiGet(`/api/records/transcribe/${recordId}`);
    return d?.data?.transcript ?? { segments: [], text: '' };
  } catch { return { segments: [], text: '' }; }
}

/** Start the transcription job (409 while another runs). */
export async function startRecordTranscription(recordId) {
  const d = await apiPost('/api/records/transcribe', { recordId });
  return d?.data ?? {};
}

/** Job status + transcript in one poll — { job, transcript }. */
export async function getRecordTranscriptionStatus(recordId) {
  const d = await apiGet(`/api/records/transcribe/${recordId}`);
  return d?.data ?? { job: null, transcript: { segments: [], text: '' } };
}

/** Stable "save a copy" link — cookies auth it, R2 serves the bytes. */
export const recordDownloadUrl = (id) => `${API}/api/records/${id}/file`;
