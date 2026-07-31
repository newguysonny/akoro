/**
 * api.js — HTTP client for the agent app. Portal 'agent' gets its own
 * HttpOnly session cookie (akoro_access_agent), fully separate from every
 * other Akoro portal.
 */
export const API = import.meta.env.VITE_API_URL || 'https://akoro.app';

// Vite inlines VITE_API_URL at BUILD time. If the Vercel project is missing it
// (or was changed without a redeploy) every call silently targets the fallback
// domain and dies as an opaque "Failed to fetch" — so say so, loudly, once.
if (!import.meta.env.VITE_API_URL) {
  console.error(`[akoro-agent] VITE_API_URL is not set — falling back to ${API}. Set it in the Vercel project and REDEPLOY.`);
}

const BASE_OPTS = {
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'agent' },
};

// fetch() rejects (rather than returning a response) only on network-level
// failures: DNS, TLS, connection refused, or a CORS preflight rejection. The
// browser deliberately hides which — so name the URL we were trying to reach.
async function request(path, opts) {
  try {
    return await fetch(`${API}${path}`, opts);
  } catch (e) {
    const err = new Error(`Cannot reach the API at ${API} — check VITE_API_URL and that ${window.location.origin} is in the backend's CORS_ORIGIN.`);
    err.cause = e;
    err.network = true;
    throw err;
  }
}

async function handle(r, label) {
  if (!r.ok) {
    let msg = label;
    try { const j = await r.json(); msg = j.error || j.message || msg; } catch { /* ignore */ }
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

export async function apiGet(path) {
  const r = await request(path, { ...BASE_OPTS, method: 'GET' });
  return handle(r, `GET ${path} failed`);
}
export async function apiPost(path, body) {
  const r = await request(path, { ...BASE_OPTS, method: 'POST', body: JSON.stringify(body ?? {}) });
  return handle(r, `POST ${path} failed`);
}
export async function apiPatch(path, body) {
  const r = await request(path, { ...BASE_OPTS, method: 'PATCH', body: JSON.stringify(body ?? {}) });
  return handle(r, `PATCH ${path} failed`);
}
export async function apiDelete(path) {
  const r = await request(path, { ...BASE_OPTS, method: 'DELETE' });
  return handle(r, `DELETE ${path} failed`);
}
