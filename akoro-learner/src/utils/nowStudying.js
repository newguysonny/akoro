/**
 * nowStudying.js — "Now studying" store (Spotify-mini-player for study).
 *
 * Tracks the material or session the learner has open, the way a music app
 * tracks the current track: a small per-user payload in localStorage plus a
 * custom event so every mounted listener updates in the same tick.
 *
 * Payload shape:
 *   { item: { type:'session'|'record', id, title, sub, emoji, progress,
 *             snapshot? },        // snapshot = session fields for reopen
 *     dismissed: bool, updatedAt }
 *
 * FRONTEND-ONLY for now (like records). When a backend lands, get/set are
 * the two seams to swap.
 */
import { useCallback, useEffect, useState } from 'react';

const EVENT = 'akoro_now_studying';
const keyOf = (uid) => `akoro_nowstudying_${uid || 'me'}`;

export function getNowStudying(uid) {
  try {
    const raw = JSON.parse(localStorage.getItem(keyOf(uid)) || 'null');
    if (!raw) return { item: null, dismissed: false };
    return { item: raw.item || null, dismissed: !!raw.dismissed };
  } catch { return { item: null, dismissed: false }; }
}

function write(uid, payload) {
  try { localStorage.setItem(keyOf(uid), JSON.stringify(payload)); } catch { /* private mode */ }
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { uid } })); } catch { /* ssr */ }
}

export function setNowStudying(uid, item) {
  if (!uid || !item) return;
  write(uid, { item: { ...item, updatedAt: Date.now() }, dismissed: false });
}

export function updateNowProgress(uid, id, progress) {
  if (!uid || !id) return;
  const cur = getNowStudying(uid);
  if (cur.item?.id !== id) return;
  write(uid, { item: { ...cur.item, progress, updatedAt: Date.now() }, dismissed: cur.dismissed });
}

export function dismissNowStudying(uid) {
  if (!uid) return;
  const cur = getNowStudying(uid);
  if (!cur.item) return;
  write(uid, { ...cur, dismissed: true });
}

/** Subscribe to changes (same-tab custom event + cross-tab storage event). */
export function subscribeNowStudying(uid, fn) {
  const notify = () => fn(getNowStudying(uid));
  try { window.addEventListener(EVENT, notify); } catch { /* ssr */ }
  try { window.addEventListener('storage', (e) => { if (e.key === keyOf(uid)) notify(); }); } catch { /* ssr */ }
  return () => {
    try { window.removeEventListener(EVENT, notify); } catch { /* noop */ }
  };
}

/** React binding: [state, actions]. */
export function useNowStudying(uid) {
  const [state, setState] = useState(() => getNowStudying(uid));
  useEffect(() => { setState(getNowStudying(uid)); return subscribeNowStudying(uid, setState); }, [uid]);
  const setCurrent = useCallback((item) => setNowStudying(uid, item), [uid]);
  const setProgress = useCallback((id, progress) => updateNowProgress(uid, id, progress), [uid]);
  const dismiss = useCallback(() => dismissNowStudying(uid), [uid]);
  return [state, { setCurrent, setProgress, dismiss }];
}

/* Progress → colour stage. Colour reads the stage at a glance the way the
   mini-player's scrubber reads time: red = just started, amber = midway,
   green = nearly there, brand = complete, grey = untouched. */
export function progressStage(p) {
  const v = Math.max(0, Math.min(100, Number(p) || 0));
  if (v <= 0)   return { color: 'var(--ak-border3)', label: 'not started' };
  if (v < 34)   return { color: '#EF4444', label: 'just started' };
  if (v < 67)   return { color: '#F59E0B', label: 'in progress' };
  if (v < 100)  return { color: '#10B981', label: 'almost done' };
  return { color: '#6C3BFF', label: 'complete' };
}
