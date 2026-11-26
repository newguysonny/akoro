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

/** One page of my shelf (scroll-to-fetch-more): { records, total, nextCursor }. */
export async function listRecordsPage({ limit = 12, cursor } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  const d = await apiGet(`/api/records?${params}`);
  return d?.data ?? { records: [], total: 0, nextCursor: null };
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

/** One page of the Discover feed: { items, total, nextCursor }. */
export async function discoverRecordsPage({ q, limit = 12, cursor } = {}) {
  const params = new URLSearchParams({ paged: '1', limit: String(limit) });
  if (q && String(q).trim()) params.set('q', String(q).trim());
  if (cursor) params.set('cursor', cursor);
  const d = await apiGet(`/api/records/discover?${params}`);
  return d?.data ?? { items: [], total: 0, nextCursor: null };
}

/** Open one discovered record — presigns its file (with download name),
 *  or returns the paste's full text. One call per open. */
export async function discoverRecordOpen(id) {
  const d = await apiGet(`/api/records/discover/${id}/open`);
  return d?.data ?? null;
}

/** Step 1 of an upload — ask the server for a PUT URL. */
export async function presignRecordUpload({ name, mime, size, purpose }) {
  const d = await apiPost('/api/records/upload-url', { name, mime, size, ...(purpose ? { purpose } : {}) });
  return d?.data ?? null;
}

/** POST the bytes to the API instead of the store. Used when the direct
 *  presigned PUT cannot work — an R2 bucket without CORS rejects it as a
 *  network error — so uploads still succeed wherever the app can reach the
 *  API. Same XHR progress/abort contract as putFileTo. */
export function putFileToServer(file, onProgress, { signal, purpose } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Upload cancelled.')); return; }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/api/records/upload`, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Akoro-Portal', 'student');
    if (xhr.upload && onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }
    xhr.addEventListener('load', () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let msg = `Upload failed (${xhr.status})`;
        try { msg = JSON.parse(xhr.responseText)?.error || msg; } catch { /* keep default */ }
        reject(new Error(msg)); return;
      }
      try { resolve(JSON.parse(xhr.responseText)?.data ?? {}); }
      catch { reject(new Error('Upload failed — unexpected reply.')); }
    });
    xhr.addEventListener('error', () => reject(new Error('Upload failed — check your connection.')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled.')));
    if (signal) signal.addEventListener('abort', () => { try { xhr.abort(); } catch { /* settled */ } }, { once: true });
    const form = new FormData();
    form.append('file', file);
    form.append('name', file.name || 'file');
    form.append('mime', file.type || '');
    if (purpose) form.append('purpose', purpose);
    xhr.send(form);
  });
}

/** Upload one file for a record: the store's presigned PUT first, then the
 *  API fallback. Returns { fileKey, store }. Cancellation is never retried. */
export async function uploadRecordFile(file, onProgress, { signal, purpose } = {}) {
  try {
    const up = await presignRecordUpload({ name: file.name, mime: file.type || '', size: file.size, purpose });
    await putFileTo(up.uploadUrl, file, onProgress, { signal });
    return { fileKey: up.fileKey, store: up.store };
  } catch (err) {
    if (/cancel/i.test(String(err?.message || '')) || signal?.aborted) throw err;
    onProgress?.(0);
    const out = await putFileToServer(file, onProgress, { signal, purpose });
    return { fileKey: out.fileKey, store: out.store };
  }
}

/** The stored page-1 image for a record (the card's thumbnail). */
export const recordPreviewUrl = (id) => `${API}/api/records/${id}/preview`;

/** Ask the API to render page 1 from the stored file (server-side, owner only). */
export async function generateRecordPreview(id) {
  try {
    const res = await fetch(`${API}/api/records/${id}/preview/generate`, {
      method: 'POST', credentials: 'include', headers: { 'X-Akoro-Portal': 'student' },
    });
    return res.ok;
  } catch { return false; }
}

/** Send the page image the reader rendered. Silently best-effort: a preview
 *  is a nicety, never a reason for the document to fail. */
export async function uploadRecordPreview(id, blob) {
  const form = new FormData();
  form.append('file', blob, 'preview.jpg');
  const res = await fetch(`${API}/api/records/${id}/preview`, {
    method: 'POST', credentials: 'include', headers: { 'X-Akoro-Portal': 'student' }, body: form,
  });
  return res.ok;
}

/** Step 2 — PUT the raw bytes to the presigned URL. XHR (not fetch) so the
 *  sheet can show real upload progress; big files take a while on mobile.
 *  An AbortSignal (the chat composer's tile ✕) cancels the PUT mid-flight. */
export function putFileTo(uploadUrl, file, onProgress, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Upload cancelled.')); return; }
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
    if (signal) signal.addEventListener('abort', () => { try { xhr.abort(); } catch { /* already settled */ } }, { once: true });
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

/** One page of my folders: { folders, total, nextCursor }. */
export async function listFoldersPage({ limit = 20, cursor } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  const d = await apiGet(`/api/records/folders?${params}`);
  return d?.data ?? { folders: [], total: 0, nextCursor: null };
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

/** One page of a folder's items: { items, total, nextCursor }. */
export async function listFolderItemsPage(folderId, { limit = 20, cursor } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  const d = await apiGet(`/api/records/folders/${folderId}/items?${params}`);
  return d?.data ?? { items: [], total: 0, nextCursor: null };
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

/** Rename a library file (the record's display name). */
export async function renameRecord(id, { name }) {
  const d = await apiPatch(`/api/records/${id}`, { name });
  return d?.data ?? d ?? true;
}

/** Share (or unshare) a record in Discover — a Premium subscriber's choice.
 * Returns the updated record (its `discoverable` is the server's truth). */
export async function setRecordDiscoverable(id, value) {
  const d = await apiPatch(`/api/records/${id}`, { discoverable: value === true });
  return d?.data ?? null;
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

/** Which parser the server runs: runpod | model | ocr. The OCR lane reads the
    whole stored document in one call, so the client skips rasterization. */
export async function getExtractionEngine() {
  const d = await apiGet('/api/records/extract/engine');
  return d?.data?.engine || 'runpod';
}

/** One poll of the submitted batch → { done, pages (saved this poll), pending, failed }. */
export async function getExtractionStatus({ recordId, contentKey }) {
  const q = contentKey ? `contentKey=${encodeURIComponent(contentKey)}` : `recordId=${encodeURIComponent(recordId)}`;
  const d = await apiGet(`/api/records/extract/status?${q}`);
  return d?.data ?? { done: true, pages: [], pending: [], failed: [] };
}

/** Have the server read a file's text into pages from the stored file — a
    PDF's text layer, a text file, Word / PowerPoint (normally already done
    at upload or by the backfill). → the extraction ({ pages, done: true }),
    or { running: true } while another run holds it. Throws with the
    server's message when the file can't be read (err.status 422 for a scan). */
export async function extractStoredRecordText({ recordId, contentKey }) {
  const d = await apiPost('/api/records/extract/text', contentKey ? { contentKey } : { recordId });
  return d?.data ?? { pages: [], running: false };
}

/* ── Ask: questions about ONE document, answered with citations ───────────── */

const askTarget = ({ recordId, contentKey, folderId }) => (folderId ? { folderId } : contentKey ? { contentKey } : { recordId });
const targetQuery = ({ recordId, contentKey, folderId }) => (folderId ? `folderId=${encodeURIComponent(folderId)}` : contentKey ? `contentKey=${encodeURIComponent(contentKey)}` : `recordId=${encodeURIComponent(recordId)}`);

/** The learner's Ask thread for this document (or folder). */
export async function getAskHistory({ recordId, contentKey, folderId }) {
  const d = await apiGet(`/api/records/ask/history?${targetQuery({ recordId, contentKey, folderId })}`);
  return d?.data?.messages ?? [];
}

/** Ask a question; the answer streams to onDelta. Resolves { answer, citations, messageId }. */
export async function askRecord({ recordId, contentKey, folderId, question, selection = null, onDelta, onStatus, signal }) {
  let result = null;
  const full = await streamPost('/api/records/ask?stream=1', { ...askTarget({ recordId, contentKey, folderId }), question, ...(selection ? { selection } : {}) }, {
    onDelta, onStatus, signal,
    onDone: (d) => { result = d; },
  });
  return result || { answer: full, citations: [] };
}

/* ── Learning with Guide: the guide teacher, grounded in the document ─────── */

/** The learner's guide thread for this document. */
export async function getGuideHistory({ recordId, contentKey }) {
  const q = contentKey ? `contentKey=${encodeURIComponent(contentKey)}` : `recordId=${encodeURIComponent(recordId)}`;
  const d = await apiGet(`/api/records/guide/history?${q}`);
  return d?.data?.messages ?? [];
}

/** The guide's reply, streamed to onDelta → { answer, citations, messageId }.
    With a document (recordId | contentKey) it teaches from it and the turn is
    saved; without one it teaches the topic from the history sent. */
export async function guideReply({ recordId, contentKey, message, selection = null, guideName, topic, subject, history, onDelta, onStatus, signal }) {
  let result = null;
  const target = recordId || contentKey ? askTarget({ recordId, contentKey }) : {};
  const full = await streamPost('/api/records/guide?stream=1', {
    ...target, message, ...(selection ? { selection } : {}),
    ...(guideName ? { guideName } : {}), ...(topic ? { topic } : {}), ...(subject ? { subject } : {}),
    ...(!recordId && !contentKey && Array.isArray(history) ? { history } : {}),
  }, { onDelta, onStatus, signal, onDone: (d) => { result = d; } });
  return result || { answer: full, citations: [] };
}

/** Generate a study tool (summary | quiz | flashcards) from the document — grounded, cited. */
export async function generateRecordTool({ recordId, contentKey, folderId, tool, scope = 'page', pageNumber = null, pageNumbers = null, pageText = '', pageTexts = null, contextRecordIds = null, contextFolderIds = null, values = {} }) {
  // Grounded generation runs the model over the page: measured ~40 s on a
  // real page. The 30 s default aborted it and the sheet said "timed out"
  // while the server was still writing a perfectly good quiz.
  const d = await apiPost(`/api/records/tools/${encodeURIComponent(tool)}`, {
    ...(folderId ? { folderId } : contentKey ? { contentKey } : { recordId }),
    scope, ...(Number.isInteger(pageNumber) ? { pageNumber } : {}),
    ...(Array.isArray(pageNumbers) && pageNumbers.length ? { pageNumbers } : {}),
    ...(Array.isArray(pageTexts) && pageTexts.length ? { pageTexts: pageTexts.map((t) => ({ pageNumber: t.pageNumber, text: String(t.text || '').slice(0, 8000) })) } : {}),
    ...(pageText ? { pageText: String(pageText).slice(0, 8000) } : {}),
    ...(Array.isArray(contextRecordIds) && contextRecordIds.length ? { contextRecordIds } : {}),
    ...(Array.isArray(contextFolderIds) && contextFolderIds.length ? { contextFolderIds } : {}),
    values,
  }, { timeout: 90_000 });
  return d?.data ?? {};
}

/** Start a podcast episode → its saved item ({ id, content: { podcast: { status: 'making' } } }).
    The server writes, narrates and stores it; poll getRecordPodcast(id). */
export async function startRecordPodcast({ recordId, contentKey, folderId, scope = 'page', pageNumber = null, pageNumbers = null, pageText = '', pageTexts = null, contextRecordIds = null, contextFolderIds = null, values = {} }) {
  const d = await apiPost('/api/records/podcast', {
    ...(folderId ? { folderId } : contentKey ? { contentKey } : { recordId }),
    scope, ...(Number.isInteger(pageNumber) ? { pageNumber } : {}),
    ...(Array.isArray(pageNumbers) && pageNumbers.length ? { pageNumbers } : {}),
    ...(Array.isArray(pageTexts) && pageTexts.length ? { pageTexts: pageTexts.map((t) => ({ pageNumber: t.pageNumber, text: String(t.text || '').slice(0, 8000) })) } : {}),
    ...(pageText ? { pageText: String(pageText).slice(0, 8000) } : {}),
    ...(Array.isArray(contextRecordIds) && contextRecordIds.length ? { contextRecordIds } : {}),
    ...(Array.isArray(contextFolderIds) && contextFolderIds.length ? { contextFolderIds } : {}),
    values,
  });
  return d?.data?.artifact ?? null;
}

/** One podcast item — status making | ready (with audioUrl) | failed. */
export async function getRecordPodcast(id) {
  const d = await apiGet(`/api/records/podcast/${encodeURIComponent(id)}`);
  return d?.data?.artifact ?? null;
}

/* ── Saved reader items (generated tabs, notes, annotations) ─────────────── */

export async function listRecordArtifacts(target) {
  const d = await apiGet(`/api/records/artifacts?${targetQuery(target)}`);
  return d?.data?.artifacts ?? [];
}
export async function saveRecordArtifact(target, body) {
  const d = await apiPost('/api/records/artifacts', { ...(target.folderId ? { folderId: target.folderId } : target.contentKey ? { contentKey: target.contentKey } : { recordId: target.recordId }), ...body });
  return d?.data?.artifact ?? null;
}
export async function updateRecordArtifact(id, patch) {
  const d = await apiPatch(`/api/records/artifacts/${encodeURIComponent(id)}`, patch);
  return d?.data?.artifact ?? null;
}
export async function deleteRecordArtifact(id) {
  await apiDelete(`/api/records/artifacts/${encodeURIComponent(id)}`);
  return true;
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

/** The reader's same-API URL for an upload's bytes — streamed by the API so the
    browser never fetches the storage URL directly (R2 presigned URLs send no
    CORS headers, which blocked library PDFs/images). Fetch with credentials. */
export const recordFileSrc = (id) => `${API}/api/records/${id}/file?inline=1`;
