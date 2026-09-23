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

/** Mark a record opened (server-side last_opened_at, no progress change). */
export async function touchRecordOpened(id) {
  await apiPatch(`/api/records/${id}`, { lastOpened: true });
}

export async function deleteRecord(id) {
  await apiDelete(`/api/records/${id}`);
  return true;
}

/** Stable "save a copy" link — cookies auth it, R2 serves the bytes. */
export const recordDownloadUrl = (id) => `${API}/api/records/${id}/file`;
