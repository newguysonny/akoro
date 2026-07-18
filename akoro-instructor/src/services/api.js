/**
 * api.js — HTTP client
 *
 * Auth tokens are stored in HttpOnly cookies by the backend.
 * credentials:'include' ensures the browser sends them on every request.
 * No Authorization header — tokens never touch JS memory.
 */

export const API = import.meta.env.VITE_API_URL || "https://akoro.app";

const BASE_OPTS = {
  credentials: 'include',                 // send HttpOnly auth cookies
  headers:     { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'instructor' },
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
