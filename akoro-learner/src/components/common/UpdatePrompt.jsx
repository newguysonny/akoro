/**
 * UpdatePrompt — shows a "new version available" banner when the service worker
 * has a newer build waiting, then auto-reloads after a short countdown (users
 * can reload immediately, or postpone — lazyWithRetry still catches any stale
 * chunk they hit in the meantime).
 *
 * Registers the SW itself so it receives onNeedRefresh (vite-plugin-pwa is in
 * `prompt` mode). In dev, `registerSW` is a no-op, so this renders nothing.
 */
import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { isBusy, subscribeActivity } from '../../utils/activityLock.js';

const COUNTDOWN = 10;

export default function UpdatePrompt() {
  const [show, setShow] = useState(false);
  const [secs, setSecs] = useState(COUNTDOWN);
  const [busy, setBusy] = useState(false);   // in a live session / assessment
  const updateSW = useRef(null);

  useEffect(() => {
    updateSW.current = registerSW({
      immediate: true,
      onNeedRefresh() { setSecs(COUNTDOWN); setShow(true); },
      // Proactively poll for a new deploy so the banner fires BEFORE the user
      // navigates into a stale (deleted) route chunk and white-screens. Checks
      // shortly after load, every few minutes, and whenever the tab refocuses.
      onRegisteredSW(_url, registration) {
        if (!registration) return;
        const check = () => { registration.update().catch(() => {}); };
        setTimeout(check, 5000);
        const id = setInterval(check, 5 * 60 * 1000);
        const onVis = () => { if (document.visibilityState === 'visible') check(); };
        document.addEventListener('visibilitychange', onVis);
        window.addEventListener('focus', check);
        // (Listeners live for the app's lifetime — the prompt is always mounted.)
        void id;
      },
    });
  }, []);

  // Pause the countdown while the learner is in a protected flow.
  useEffect(() => {
    setBusy(isBusy());
    return subscribeActivity(setBusy);
  }, []);

  useEffect(() => {
    if (!show || busy) return;   // paused while an activity holds the lock
    if (secs <= 0) { updateSW.current?.(true); return; }   // activate new SW + reload
    const t = setTimeout(() => setSecs((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [show, secs, busy]);

  if (!show) return null;

  const reloadNow = () => updateSW.current?.(true);
  const postpone  = () => setShow(false);   // keep using the current version for now

  return (
    <div role="status" style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 4000,
      background: '#1A1A2E', color: '#fff', fontFamily: "'Nunito', system-ui, sans-serif",
      padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 12, flexWrap: 'wrap', boxShadow: '0 2px 14px rgba(0,0,0,.25)',
    }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>
        {busy
          ? 'A new version of Akoro is available — it’ll reload when you finish.'
          : `A new version of Akoro is available — reloading in ${secs}s`}
      </span>
      <span style={{ display: 'inline-flex', gap: 8 }}>
        <button onClick={reloadNow} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: '#6C3BFF', color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>Reload now</button>
        <button onClick={postpone} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,.3)', background: 'transparent', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Later</button>
      </span>
    </div>
  );
}
