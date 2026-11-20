/**
 * UpdatePrompt — the service-worker update lifecycle's UI half.
 *
 * A new deploy installs a new SW that WAITS behind the old one (no skipWaiting
 * baked into the SW — see vite.config.js). When the waiting worker is detected
 * (on load, every 60s, and on focus) this banner appears and owns the swap:
 * "Reload now" (or the countdown reaching 0) calls updateSW(true) →
 * postMessage SKIP_WAITING → the new SW activates → controllerchange → the
 * page reloads into the fresh build. Until then the old SW keeps serving the
 * old page its own cached chunks, so nothing 404s mid-session. "Later" keeps
 * the current version until the next check.
 *
 * Two quiet paths keep people off old versions without the banner:
 *  • at LAUNCH — if a new version is already waiting when the app opens (it
 *    downloaded during the last visit), switch straight away while the app
 *    is still booting;
 *  • on CLOSE — when the app is hidden/closed with a version waiting, activate
 *    it, so the next open is already the new version.
 *
 * Registers the SW itself via vite-plugin-pwa's registerSW (prompt mode). In
 * dev, `registerSW` is a no-op, so this renders nothing.
 */
import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { AMBER, INK, FONT } from '../constants.js';

const COUNTDOWN = 10;
// A waiting version found this soon after the page started is applied at once
// (the instructor is still on the splash / first paint).
const LAUNCH_WINDOW_MS = 8000;

// Activate any waiting worker without reloading — used when the app is closing.
function activateWaiting(registration) {
  try { registration?.waiting?.postMessage({ type: 'SKIP_WAITING' }); } catch { /* best-effort */ }
}

export default function UpdatePrompt() {
  const [show, setShow] = useState(false);
  const [secs, setSecs] = useState(COUNTDOWN);
  const updateSW = useRef(null);

  useEffect(() => {
    updateSW.current = registerSW({
      immediate: true,
      onNeedRefresh() {
        const atLaunch = (typeof performance !== 'undefined' ? performance.now() : Infinity) < LAUNCH_WINDOW_MS;
        if (atLaunch) { updateSW.current?.(true); return; }   // swap before anyone starts working
        setSecs(COUNTDOWN); setShow(true);
      },
      // Proactively poll for a new deploy so the banner fires as soon as one
      // ships: shortly after load, every 60 seconds, and whenever the tab
      // refocuses. (registration.update() is a cheap conditional fetch of
      // sw.js — safe to do often.)
      onRegisteredSW(_url, registration) {
        if (!registration) return;
        const check = () => { registration.update().catch(() => {}); };
        setTimeout(check, 5000);
        const id = setInterval(check, 60 * 1000);
        const onVis = () => { if (document.visibilityState === 'visible') check(); };
        document.addEventListener('visibilitychange', onVis);
        window.addEventListener('focus', check);
        // Closing the app with a new version waiting → activate it now, so the
        // next open is the new version (pagehide is the event mobile browsers
        // fire when the app is swiped away; not on a mere tab switch).
        const onLeave = () => activateWaiting(registration);
        window.addEventListener('pagehide', onLeave);
        // (Listeners live for the app's lifetime — the prompt is always mounted.)
        void id;
      },
    });
  }, []);

  useEffect(() => {
    if (!show) return;
    if (secs <= 0) { updateSW.current?.(true); return; }   // activate new SW + reload
    const t = setTimeout(() => setSecs((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [show, secs]);

  if (!show) return null;

  const reloadNow = () => updateSW.current?.(true);
  const postpone  = () => setShow(false);   // keep using the current version for now

  return (
    <div role="status" style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 4000,
      background: INK, color: '#fff', fontFamily: FONT,
      padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 12, flexWrap: 'wrap', boxShadow: '0 2px 14px rgba(0,0,0,.25)',
    }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>
        {`A new version of the Akoro instructor app is available — reloading in ${secs}s`}
      </span>
      <span style={{ display: 'inline-flex', gap: 8 }}>
        <button onClick={reloadNow} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: AMBER, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>Reload now</button>
        <button onClick={postpone} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,.3)', background: 'transparent', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Later</button>
      </span>
    </div>
  );
}
