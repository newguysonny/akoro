/**
 * api.js — HTTP client
 *
 * Auth tokens are stored in HttpOnly cookies by the backend.
 * credentials:'include' ensures the browser sends them on every request.
 * No Authorization header — tokens never touch JS memory.
 */

import { cacheGet, cacheSet } from './offlineCache.js';

export const API = import.meta.env.VITE_API_URL || "https://akoro.app";

const BASE_OPTS = {
  credentials: 'include',                 // send HttpOnly auth cookies
  headers:     { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'student' },
};

// A thrown fetch (no HTTP response) or a browser marked offline = network error,
// as opposed to the server responding with a 4xx/5xx.
const isNetworkError = (err) => (typeof navigator !== 'undefined' && navigator.onLine === false) || err?.name === 'TypeError';

// Tag a payload served from the offline cache so callers can show a "saved"
// hint if they want; non-enumerable so it never changes the data's shape.
function markOffline(data) {
  try { if (data && typeof data === 'object') Object.defineProperty(data, '_offline', { value: true, enumerable: false }); } catch { /* frozen/primitive */ }
  return data;
}

export async function apiGet(path, { cache = true } = {}) {
  try {
    const r = await fetch(`${API}${path}`, { ...BASE_OPTS, method: 'GET' });
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
    const json = await r.json();
    if (cache) cacheSet(path, json);            // fire-and-forget snapshot
    return json;
  } catch (err) {
    // Offline / network failure → serve the last-known-good copy if we have one.
    if (cache && isNetworkError(err)) {
      const hit = await cacheGet(path);
      if (hit) return markOffline(hit.data);
    }
    throw err;
  }
}

export async function apiPost(path, body) {
  const r = await fetch(`${API}${path}`, {
    ...BASE_OPTS,
    method: 'POST',
    body:   JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status}`);
  return r.json();
}

export async function apiPatch(path, body) {
  const r = await fetch(`${API}${path}`, {
    ...BASE_OPTS,
    method: 'PATCH',
    body:   JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status}`);
  return r.json();
}

export async function apiDelete(path) {
  const r = await fetch(`${API}${path}`, { ...BASE_OPTS, method: 'DELETE' });
  if (!r.ok) throw new Error(`DELETE ${path} -> ${r.status}`);
  return r.json();
}

/**
 * POST a request and consume a Server-Sent Events stream.
 *   onDelta(textChunk) — called for each incremental token
 *   onDone(payload)    — called once with the final { reply, metadata }
 * Returns the accumulated reply text. Throws on network/stream errors so the
 * caller can fall back to a non-streaming request.
 */
export async function streamPost(path, body, { onDelta, onDone } = {}) {
  const r = await fetch(`${API}${path}`, {
    ...BASE_OPTS,
    method:  'POST',
    headers: { ...BASE_OPTS.headers, Accept: 'text/event-stream' },
    body:    JSON.stringify(body),
  });
  if (!r.ok || !r.body) throw new Error(`STREAM ${path} -> ${r.status}`);

  const reader  = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full   = '';

  const handleEvent = (raw) => {
    let event = 'message', data = '';
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;
    let parsed; try { parsed = JSON.parse(data); } catch { return; }
    if (event === 'delta' && parsed.text != null) { full += parsed.text; onDelta?.(parsed.text); }
    else if (event === 'done')  { if (parsed.reply != null) full = parsed.reply; onDone?.(parsed); }
    else if (event === 'error') { throw new Error(parsed.error || 'stream error'); }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      handleEvent(raw);
    }
  }
  if (buffer.trim()) handleEvent(buffer);
  return full;
}
