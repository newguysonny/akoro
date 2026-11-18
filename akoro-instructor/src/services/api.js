import { API } from '../config/urls.js';
import { createApiCore } from '../client/apiCore';

/**
 * api.js — HTTP client
 *
 * Auth tokens are stored in HttpOnly cookies by the backend; credentials:
 * 'include' sends them on every request, and no token ever touches JS memory.
 *
 * The session rules themselves live in the shared core
 * (design-system/client/apiCore.ts → src/client): one deduped refresh per tab,
 * refresh-before-the-herd when the expiry is known, a 401 replay, the single
 * error shape and connection state. This file names the instructor portal and
 * keeps the instructor-only file helpers below.
 */

const core = createApiCore({ apiBase: API, portalId: 'instructor' });

export { API };

export const {
  rememberExpiry,
  refreshSession,
  onConnectionChange,
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
} = core;

/** A file from the API as a Blob. Auth rides the session cookie (refreshed
 *  like every other call), so a plain <a href> cannot carry it cross-origin. */
export async function apiBlob(path) {
  const r = await core.authedFetch(`${API}${path}`, { credentials: 'include', headers: { 'X-Akoro-Portal': 'instructor' } });
  if (!r.ok) throw await core.errorFor(r, 'GET', path);
  return r.blob();
}

/** One learner's whole submission as a PDF (built by the API at submit). */
export const fetchSubmissionPdf = (targetId) => apiBlob(`/api/self-study/targets/${targetId}/submission.pdf`);

/** Open a submission file in a new tab (PDFs and photos view in the browser).
 *  The tab is opened first, inside the click, so popup blockers allow it. */
export async function openActivityFile(fileId) {
  const tab = window.open('', '_blank');
  try {
    const url = URL.createObjectURL(await apiBlob(`/api/self-study/files/${fileId}`));
    if (tab) tab.location.href = url; else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** Download a submission file (fetch the blob, then save it as an object URL). */
export async function downloadActivityFile(fileId, name) {
  const blob = await apiBlob(`/api/self-study/files/${fileId}?download=1`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'file';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
