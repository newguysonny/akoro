/**
 * usePwaInstall — drives the "Install app" surface of the instructor PWA.
 *
 * Chrome / Edge / Android fire `beforeinstallprompt`; we stash it and fire the
 * native install dialog on demand. Once installed (or when already running
 * standalone) the install surface hides itself.
 *
 * Browsers with NO programmatic prompt (Safari, Firefox, Samsung Internet's
 * first run) still get a working path: `platform` says exactly which
 * browser/device the instructor is on, so the UI can show the right manual
 * steps for THAT browser instead of a dead button.
 */
import { useEffect, useState, useCallback } from 'react';

/* ── Platform detection — which browser is the instructor actually in? ────── */
function detectPlatform() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  // iPadOS 13+ masquerades as desktop Safari — touch points give it away.
  const iPadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
  if (/iPhone|iPod/.test(ua) || /iPad/.test(ua) || iPadOS) return 'ios';
  if (/Android/.test(ua)) {
    if (/SamsungBrowser/.test(ua)) return 'android-samsung';
    if (/Firefox/.test(ua))        return 'android-firefox';
    return 'android-chrome';
  }
  if (/Win|Mac|Linux|CrOS/i.test((navigator.platform || '') + ' ' + ua)) return 'desktop';
  return 'unknown';
}

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true);

export function usePwaInstall() {
  const [deferred,  setDeferred]  = useState(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [platform]                = useState(detectPlatform);

  useEffect(() => {
    setInstalled(isStandalone());
    // preventDefault keeps Chrome's mini-infobar down — we own the prompt UI.
    const onPrompt   = (e) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Fire the native prompt; returns 'accepted' | 'dismissed' | null when unavailable.
  const install = useCallback(async () => {
    if (!deferred) return null;
    await deferred.prompt();
    const choice = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
    setDeferred(null);   // the prompt object can only be used once
    if (choice.outcome === 'accepted') setInstalled(true);
    return choice.outcome;
  }, [deferred]);

  const canInstall = !!deferred && !installed;

  return {
    hidden:     installed,          // installed or already running as a PWA
    canPrompt:  canInstall,         // native one-tap install available
    isIOS:      platform === 'ios', // needs the manual Share-sheet instructions
    promptInstall: install,
    canInstall,
    isInstalled: installed,
    platform,                       // 'ios' | 'android-chrome' | 'android-firefox' | 'android-samsung' | 'desktop' | 'unknown'
    supportsNativePrompt: !!deferred,
    install,
  };
}
