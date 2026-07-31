/**
 * api.js — HTTP client for the agent app. Portal 'agent' gets its own
 * HttpOnly session cookie (akoro_access_agent), fully separate from every
 * other Akoro portal.
 */
export const API = import.meta.env.VITE_API_URL || 'https://akoro.app';

const BASE_OPTS = {
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'agent' },
};

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
  const r = await fetch(`${API}${path}`, { ...BASE_OPTS, method: 'GET' });
  return handle(r, `GET ${path} failed`);
}
export async function apiPost(path, body) {
  const r = await fetch(`${API}${path}`, { ...BASE_OPTS, method: 'POST', body: JSON.stringify(body ?? {}) });
  return handle(r, `POST ${path} failed`);
}
export async function apiPatch(path, body) {
  const r = await fetch(`${API}${path}`, { ...BASE_OPTS, method: 'PATCH', body: JSON.stringify(body ?? {}) });
  return handle(r, `PATCH ${path} failed`);
}
export async function apiDelete(path) {
  const r = await fetch(`${API}${path}`, { ...BASE_OPTS, method: 'DELETE' });
  return handle(r, `DELETE ${path} failed`);
}
