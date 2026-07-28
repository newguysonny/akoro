/**
 * api.js — HTTP client
 *
 * Auth tokens are stored in HttpOnly cookies by the backend.
 * credentials:'include' ensures the browser sends them on every request.
 * No Authorization header — tokens never touch JS memory.
 */

export const API = import.meta.env.VITE_API_URL || "https://akoro.app";

// This build serves BOTH the school admin app AND the public student-facing
// site AI chat (/ai-chat, /ai-guest). They must NOT share a session cookie —
// a student signing into the site chat would otherwise clobber the admin's
// akoro_access_school cookie. So the site chat uses its own portal ('site' →
// akoro_access_site). Decided once at load from the entry path.
function detectPortal() {
  try {
    const p = window.location.pathname || '';
    if (p.startsWith('/ai-chat') || p.startsWith('/ai-guest')) return 'site';
  } catch { /* ignore */ }
  return 'school';
}
const PORTAL = detectPortal();
export const getPortal = () => PORTAL;

const BASE_OPTS = {
  credentials: 'include',                 // send HttpOnly auth cookies
  headers:     { 'Content-Type': 'application/json', 'X-Akoro-Portal': PORTAL },
};

export async function apiGet(path) {
  const r = await fetch(`${API}${path}`, { ...BASE_OPTS, method: 'GET' });
  if (!r.ok) {
    let msg = `GET ${path} -> ${r.status}`;
    try { const j = await r.json(); msg = j.error || j.message || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export async function apiPost(path, body) {
  const r = await fetch(`${API}${path}`, {
    ...BASE_OPTS,
    method: 'POST',
    body:   JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = `POST ${path} -> ${r.status}`;
    try { const j = await r.json(); msg = j.error || j.message || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export async function apiPut(path, body) {
  const r = await fetch(`${API}${path}`, {
    ...BASE_OPTS,
    method: 'PUT',
    body:   JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = `PUT ${path} -> ${r.status}`;
    try { const j = await r.json(); msg = j.error || j.message || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export async function apiPatch(path, body) {
  const r = await fetch(`${API}${path}`, {
    ...BASE_OPTS,
    method: 'PATCH',
    body:   JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = `PATCH ${path} -> ${r.status}`;
    try { const j = await r.json(); msg = j.error || j.message || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export async function apiDelete(path) {
  const r = await fetch(`${API}${path}`, { ...BASE_OPTS, method: 'DELETE' });
  if (!r.ok) {
    let msg = `DELETE ${path} -> ${r.status}`;
    try { const j = await r.json(); msg = j.error || j.message || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}
