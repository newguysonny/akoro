/**
 * nowGrading.js — "Now grading" store (the instructor's twin of the learner app's nowStudying).
 *
 * The submission being graded is parked the way a music app parks the current track: a small
 * per-user payload in localStorage plus a custom event, so every mounted listener (the bar in
 * the shell) updates in the same tick. Closing the grading workspace MINIMIZES it — the item
 * stays, the bar offers Resume from any page, and the marks themselves are already safe in
 * gradingDrafts.js (local autosave until Publish).
 *
 * Payload: { item: { assignmentId, studentId, studentName, title, subject, progress,
 *                    queue: [{ studentId, name, graded }], updatedAt }, dismissed }
 */
import { useCallback, useEffect, useState } from 'react';

const EVENT = 'akoro_now_grading';
const keyOf = (uid) => `akoro_nowgrading_${uid || 'me'}`;

export function getNowGrading(uid) {
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

/** Park (or refresh) the submission on screen. Un-dismisses when it is a different submission. */
export function setNowGrading(uid, item) {
  if (!uid || !item) return;
  const cur = getNowGrading(uid);
  const same = cur.item && cur.item.assignmentId === item.assignmentId && cur.item.studentId === item.studentId;
  write(uid, { item: { ...item, updatedAt: Date.now() }, dismissed: same ? cur.dismissed : false });
}

export function clearNowGrading(uid) {
  if (!uid) return;
  write(uid, { item: null, dismissed: false });
}

export function dismissNowGrading(uid) {
  if (!uid) return;
  const cur = getNowGrading(uid);
  if (!cur.item) return;
  write(uid, { ...cur, dismissed: true });
}

export function subscribeNowGrading(uid, fn) {
  const notify = () => fn(getNowGrading(uid));
  const onStorage = (e) => { if (e.key === keyOf(uid)) notify(); };
  try { window.addEventListener(EVENT, notify); window.addEventListener('storage', onStorage); } catch { /* ssr */ }
  return () => {
    try { window.removeEventListener(EVENT, notify); window.removeEventListener('storage', onStorage); } catch { /* noop */ }
  };
}

/** React binding: [state, actions]. */
export function useNowGrading(uid) {
  const [state, setState] = useState(() => getNowGrading(uid));
  useEffect(() => { setState(getNowGrading(uid)); return subscribeNowGrading(uid, setState); }, [uid]);
  const setCurrent = useCallback((item) => setNowGrading(uid, item), [uid]);
  const clear = useCallback(() => clearNowGrading(uid), [uid]);
  const dismiss = useCallback(() => dismissNowGrading(uid), [uid]);
  return [state, { setCurrent, clear, dismiss }];
}

/* Progress → colour stage, the same story as the learner's bar. */
export function progressStage(p) {
  const v = Math.max(0, Math.min(100, Number(p) || 0));
  if (v <= 0)  return { color: 'var(--ak-border3)', label: 'not started' };
  if (v < 34)  return { color: '#EF4444', label: 'just started' };
  if (v < 67)  return { color: '#F59E0B', label: 'in progress' };
  if (v < 100) return { color: '#10B981', label: 'almost done' };
  return { color: '#6C3BFF', label: 'complete' };
}
