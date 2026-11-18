/**
 * InstallIntent — the app side of the landing page's "Install app" button.
 *
 * The landing is a separate origin with no PWA of its own, so its install
 * button sends the learner here with ?install=1. This host turns that
 * intent into the real install flow on the app's own origin: the native
 * prompt when the browser offers one (it can land a beat after first
 * paint, so there is a short wait), otherwise the shared per-platform
 * instructions sheet — the same dead-end-free path as every other
 * install surface. Runs once, then strips the param so a refresh or a
 * shared link never re-triggers it.
 */
import { useEffect, useRef, useState } from 'react';
import { usePwaInstall } from '../../hooks/usePwaInstall.js';
import InstallInstructionsSheet from './InstallInstructionsSheet.jsx';

const PROMPT_WAIT_MS = 2500;

export default function InstallIntent() {
  const { hidden, canPrompt, platform, promptInstall } = usePwaInstall();
  const [waiting, setWaiting] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const doneRef = useRef(false);
  const timerRef = useRef(null);

  // Arrive with ?install=1 → arm the flow exactly once and clean the URL.
  useEffect(() => {
    let params;
    try { params = new URLSearchParams(window.location.search); } catch { return; }
    if (params.get('install') !== '1') return;
    params.delete('install');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
    if (hidden) { doneRef.current = true; return; }
    setWaiting(true);
    timerRef.current = setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      setWaiting(false);
      setSheetOpen(true);   // no native prompt on this browser — its exact steps
    }, PROMPT_WAIT_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // Mount-only: the intent is read from the arrival URL, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The deferred prompt landed inside the wait window → fire it.
  useEffect(() => {
    if (!waiting || !canPrompt || doneRef.current) return;
    doneRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    setWaiting(false);
    promptInstall();
  }, [waiting, canPrompt, promptInstall]);

  // Installed while waiting (e.g. via the browser menu) → stand down.
  useEffect(() => {
    if (!hidden || !waiting) return;
    doneRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    setWaiting(false);
  }, [hidden, waiting]);

  return (
    <InstallInstructionsSheet open={sheetOpen} onClose={() => setSheetOpen(false)} platform={platform} />
  );
}
