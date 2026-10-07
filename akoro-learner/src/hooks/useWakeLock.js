/**
 * useWakeLock — keeps the screen on while a study session runs.
 *
 * Teaching a lesson, watching a course video, a revision session — the
 * learner is often just listening or watching, and a screen that sleeps
 * mid-session is a small insult. The Screen Wake Lock API holds the screen
 * awake for the component's lifetime:
 *
 *   · the lock is released by the browser whenever the tab is hidden —
 *     re-acquired automatically on visibilitychange (the web.dev pattern)
 *   · unsupported browsers (iOS Safari, older Androids) no-op silently —
 *     the session just behaves exactly as before
 *   · released on unmount, so the screen sleeps normally after the session
 */
import { useEffect, useRef } from 'react';

const wakeLockSupported = () =>
  typeof navigator !== 'undefined' && 'wakeLock' in navigator;

export function useWakeLock(active = true) {
  const lockRef = useRef(null);

  useEffect(() => {
    if (!active || !wakeLockSupported()) return undefined;

    let cancelled = false;   // unmount raced a pending request

    const request = async () => {
      if (lockRef.current || document.visibilityState !== 'visible') return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) { lock.release().catch(() => {}); return; }
        lockRef.current = lock;
        // The browser releases the lock when the tab is hidden; notice it so
        // the visibilitychange handler knows a fresh request is needed.
        lock.addEventListener('release', () => { if (lockRef.current === lock) lockRef.current = null; });
      } catch { /* denied (battery saver, iframe, …) — study continues, screen just sleeps */ }
    };
    void request();

    const onVisibility = () => { if (document.visibilityState === 'visible') void request(); };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
    };
  }, [active]);
}
