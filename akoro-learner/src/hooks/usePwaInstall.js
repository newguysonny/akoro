/**
 * usePwaInstall — drives an in-app "Install app" button for the PWA.
 *
 * Chrome/Edge/Android fire `beforeinstallprompt`; we stash it and fire the
 * native install dialog on demand. iOS/Safari has no programmatic prompt, so we
 * surface a "Share → Add to Home Screen" hint instead. Once installed (or when
 * already running standalone) the button hides itself.
 */
import { useEffect, useState, useCallback } from 'react';

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true);

const isIOS = () =>
  typeof navigator !== 'undefined' &&
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !window.MSStream;

export function usePwaInstall() {
  const [deferred, setDeferred]   = useState(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Fire the native prompt; returns 'accepted' | 'dismissed' | 'unavailable'.
  const promptInstall = useCallback(async () => {
    if (!deferred) return 'unavailable';
    deferred.prompt();
    const choice = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
    setDeferred(null);
    if (choice.outcome === 'accepted') setInstalled(true);
    return choice.outcome;
  }, [deferred]);

  return {
    // Hide entirely once installed / already running as an installed app.
    hidden:     installed || isStandalone(),
    canPrompt:  !!deferred,   // native one-tap install available
    isIOS:      isIOS(),      // needs the manual Share-sheet hint
    promptInstall,
  };
}
