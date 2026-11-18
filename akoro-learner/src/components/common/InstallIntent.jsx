/**
 * InstallIntent — the app side of the landing page's "Install app" button.
 *
 * The landing is a separate origin with no PWA of its own, so its install
 * button sends the learner here with ?install=1. This host turns that
 * intent into the real install flow on the app's own origin: the native
 * prompt when the browser offers one (it can land a beat after first
 * paint, so there is a short wait), otherwise the shared per-platform
 * instructions sheet — the same dead-end-free path as every other
 * install surface.
 *
 * The intent is carried in sessionStorage (stashed by main.jsx before
 * React mounts, and re-stashed here whenever the param is seen): on the
 * app build a signed-out arrival is routed straight to /signin, and that
 * navigation can rewrite the URL before this host's effect reads it —
 * a URL-only check loses the intent right there, which is exactly the
 * "landing button just opens the app" bug. The flag is cleared the
 * moment the flow completes, so it fires once and never nags.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { usePwaInstall } from '../../hooks/usePwaInstall.js';
import InstallInstructionsSheet from './InstallInstructionsSheet.jsx';

const PROMPT_WAIT_MS = 2500;
const INTENT_KEY = 'akoro_install_intent';

const urlHasIntent = () => {
  try { return new URLSearchParams(window.location.search).get('install') === '1'; } catch { return false; }
};
const storedIntent = () => {
  try { return sessionStorage.getItem(INTENT_KEY) === '1'; } catch { return false; }
};
const storeIntent = () => { try { sessionStorage.setItem(INTENT_KEY, '1'); } catch { /* private mode */ } };
const clearIntent = () => { try { sessionStorage.removeItem(INTENT_KEY); } catch { /* private mode */ } };

export default function InstallIntent() {
  const { hidden, canPrompt, platform, promptInstall } = usePwaInstall();
  const location = useLocation();
  const [waiting, setWaiting] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const armedRef = useRef(false);
  const doneRef = useRef(false);
  const timerRef = useRef(null);

  // Arm the flow when an intent shows up — in the URL or in sessionStorage.
  // Runs on mount and on route changes until the flow is armed; arming is
  // latched so the / → /signin hop mid-wait doesn't restart the clock.
  useEffect(() => {
    if (doneRef.current || armedRef.current) return;
    if (!urlHasIntent() && !storedIntent()) return;
    storeIntent();
    if (urlHasIntent()) {
      // Strip the param so refreshes / shares don't re-trigger the flow.
      const params = new URLSearchParams(window.location.search);
      params.delete('install');
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
    }
    if (hidden) { doneRef.current = true; clearIntent(); return; }
    armedRef.current = true;
    setWaiting(true);
    timerRef.current = setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      clearIntent();
      setWaiting(false);
      setSheetOpen(true);   // no native prompt on this browser — its exact steps
    }, PROMPT_WAIT_MS);
  }, [location.pathname, location.search, hidden]);

  // The deferred prompt landed inside the wait window → fire it.
  useEffect(() => {
    if (!waiting || !canPrompt || doneRef.current) return;
    doneRef.current = true;
    clearIntent();
    if (timerRef.current) clearTimeout(timerRef.current);
    setWaiting(false);
    promptInstall();
  }, [waiting, canPrompt, promptInstall]);

  // Installed while waiting (e.g. via the browser menu) → stand down.
  useEffect(() => {
    if (!hidden || !waiting) return;
    doneRef.current = true;
    clearIntent();
    if (timerRef.current) clearTimeout(timerRef.current);
    setWaiting(false);
  }, [hidden, waiting]);

  // Never leave a timer behind on unmount.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <InstallInstructionsSheet open={sheetOpen} onClose={() => setSheetOpen(false)} platform={platform} />
  );
}
