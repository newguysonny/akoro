/**
 * uploadApi.js — real file uploads to Cloudflare R2 via presigned URLs,
 * plus OCR text extraction (Claude Vision) for images/PDFs.
 *
 * Flow:
 *   1. POST /api/tasks/upload-url   → { uploadUrl, fileKey, publicUrl }
 *   2. PUT  <uploadUrl> (raw file)  → stores object in R2
 *   3. POST /api/tasks/files/confirm → persists row + kicks off background OCR
 *   4. GET  /api/tasks/files/:id     → poll until ocrReady, returns ocrText
 */

import { API } from './api.js';

const POST = (path, body) =>
  fetch(`${API}${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async r => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.message || `POST ${path} -> ${r.status}`);
    return j;
  });

/**
 * Upload a File object to storage. Returns { id, fileUrl, fileKey, fileName }.
 * `onProgress(pct)` is called 0..100 during the PUT.
 */
export async function uploadFile(file, onProgress) {
  const { uploadUrl, fileKey, publicUrl } = await POST('/api/tasks/upload-url', {
    fileName: file.name, fileType: file.type || 'application/octet-stream', sizeBytes: file.size,
  });

  await putWithProgress(uploadUrl, file, onProgress);

  const { file: confirmed } = await POST('/api/tasks/files/confirm', {
    fileKey, fileName: file.name, fileType: file.type, sizeBytes: file.size, publicUrl,
  });

  return { id: confirmed.id, fileUrl: publicUrl, fileKey, fileName: file.name };
}

function putWithProgress(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    if (file.type) xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload  = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(file);
  });
}

/**
 * Poll a file's OCR result until ready (or timeout). Returns extracted text.
 */
export async function pollOcr(fileId, { tries = 20, intervalMs = 1500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`${API}/api/tasks/files/${fileId}`, { credentials: 'include' });
    if (r.ok) {
      const j = await r.json();
      if (j.ocrReady && j.ocrText) return j.ocrText;
    }
    await new Promise(res => setTimeout(res, intervalMs));
  }
  throw new Error('OCR timed out — try again or enter text manually');
}

/** Upload an image and return its extracted text in one call. */
export async function uploadAndOcr(file, onProgress) {
  const { id } = await uploadFile(file, onProgress);
  return pollOcr(id);
}
