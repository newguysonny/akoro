‎1.installation

import { useState, useEffect } from 'react';
‎
‎// beforeinstallprompt is not in the standard TS lib — extend Window here
‎interface BeforeInstallPromptEvent extends Event {
‎  prompt: () => Promise<void>;
‎  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
‎}
‎
‎declare global {
‎  interface WindowEventMap {
‎    beforeinstallprompt: BeforeInstallPromptEvent;
‎  }
‎}
‎
‎export type InstallOutcome = 'accepted' | 'dismissed' | null;
‎
‎export type Platform = 'ios' | 'android-chrome' | 'android-firefox' | 'android-samsung' | 'desktop' | 'unknown';
‎
‎interface UseInstallPromptReturn {
‎  /** True when beforeinstallprompt fired and app is not yet installed */
‎  canInstall: boolean;
‎  /** True when running in standalone / installed mode */
‎  isInstalled: boolean;
‎  /** The detected platform — used to show manual instructions on unsupported browsers */
‎  platform: Platform;
‎  /** Whether the current browser fires beforeinstallprompt */
‎  supportsNativePrompt: boolean;
‎  /** Trigger the native install dialog. Returns the user's choice, or null if unavailable. */
‎  install: () => Promise<InstallOutcome>;
‎}
‎
‎function detectPlatform(): Platform {
‎  const ua = navigator.userAgent;
‎
‎  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
‎  if (/Android/.test(ua)) {
‎    if (/SamsungBrowser/.test(ua)) return 'android-samsung';
‎    if (/Firefox/.test(ua)) return 'android-firefox';
‎    return 'android-chrome';
‎  }
‎  if (/Win|Mac|Linux/.test(navigator.platform ?? '')) return 'desktop';
‎
‎  return 'unknown';
‎}
‎
‎function checkIsInstalled(): boolean {
‎  // Standalone display mode (Chrome, Edge, Firefox Android)
‎  if (window.matchMedia('(display-mode: standalone)').matches) return true;
‎  // Safari iOS standalone
‎  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
‎  return false;
‎}
‎
‎export function useInstallPrompt(): UseInstallPromptReturn {
‎  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
‎  const [isInstalled, setIsInstalled] = useState<boolean>(false);
‎  const [platform] = useState<Platform>(detectPlatform);
‎
‎  useEffect(() => {
‎    // Detect if already running as installed PWA
‎    setIsInstalled(checkIsInstalled());
‎
‎    const handleBeforeInstallPrompt = (e: BeforeInstallPromptEvent) => {
‎      // Prevent the default mini-infobar on mobile Chrome
‎      e.preventDefault();
‎      setDeferredPrompt(e);
‎    };
‎
‎    const handleAppInstalled = () => {
‎      setIsInstalled(true);
‎      setDeferredPrompt(null);
‎    };
‎
‎    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
‎    window.addEventListener('appinstalled', handleAppInstalled);
‎
‎    return () => {
‎      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
‎      window.removeEventListener('appinstalled', handleAppInstalled);
‎    };
‎  }, []);
‎
‎  const install = async (): Promise<InstallOutcome> => {
‎    if (!deferredPrompt) return null;
‎
‎    await deferredPrompt.prompt();
‎    const { outcome } = await deferredPrompt.userChoice;
‎
‎    // The prompt can only be used once — clear it
‎    setDeferredPrompt(null);
‎
‎    return outcome;
‎  };
‎
‎  return {
‎    canInstall: !!deferredPrompt && !isInstalled,
‎    isInstalled,
‎    platform,
‎    supportsNativePrompt: !!deferredPrompt,
‎    install,
‎  };
‎}
‎
‎import React, { useState } from 'react';
‎import { useInstallPrompt } from './useInstallPrompt';
‎import type { Platform } from './useInstallPrompt';
‎
‎// ─── Manual install instructions per platform ─────────────────────────────────
‎
‎const INSTALL_INSTRUCTIONS: Record<Platform, { steps: string[]; note?: string }> = {
‎  ios: {
‎    steps: [
‎      'Tap the Share button at the bottom of the screen',
‎      'Scroll down and tap "Add to Home Screen"',
‎      'Tap "Add" to confirm',
‎    ],
‎    note: 'Works in Safari only. Chrome and Firefox on iOS cannot install PWAs.',
‎  },
‎  'android-chrome': {
‎    steps: [
‎      'Tap the menu (⋮) in the top-right corner of Chrome',
‎      'Tap "Add to Home Screen" or "Install App"',
‎      'Tap "Add" to confirm',
‎    ],
‎  },
‎  'android-firefox': {
‎    steps: [
‎      'Tap the menu in the top- or bottom-right corner',
‎      'Swipe up and tap "Install", or tap "More" → "Add app to Home Screen"',
‎    ],
‎  },
‎  'android-samsung': {
‎    steps: [
‎      'Tap the menu (☰) in Samsung Internet',
‎      'Tap "Add page to" → "Home screen"',
‎      'Tap "Add" to confirm',
‎    ],
‎    note: 'You may see a Google Play Protect warning — tap "Install anyway" to proceed.',
‎  },
‎  desktop: {
‎    steps: [
‎      'Click the install icon (⊕) in your browser\'s address bar',
‎      'Click "Install" in the dialog that appears',
‎    ],
‎    note: 'Available in Chrome, Edge, and Opera. Not supported in Firefox or Safari on macOS.',
‎  },
‎  unknown: {
‎    steps: [
‎      'Open your browser menu',
‎      'Look for "Add to Home Screen" or "Install App"',
‎      'Follow the on-screen prompts',
‎    ],
‎  },
‎};
‎
‎// ─── Platform display labels ───────────────────────────────────────────────────
‎
‎const PLATFORM_LABELS: Record<Platform, string> = {
‎  ios: 'iPhone / iPad',
‎  'android-chrome': 'Android (Chrome)',
‎  'android-firefox': 'Android (Firefox)',
‎  'android-samsung': 'Android (Samsung Internet)',
‎  desktop: 'Desktop',
‎  unknown: 'Your device',
‎};
‎
‎// ─── Component ────────────────────────────────────────────────────────────────
‎
‎interface InstallButtonProps {
‎  /** Button label. Defaults to "Install App" */
‎  label?: string;
‎  /** Called after the user accepts or dismisses the native prompt */
‎  onInstall?: (outcome: 'accepted' | 'dismissed' | null) => void;
‎  /** Extra className for the trigger button */
‎  className?: string;
‎}
‎
‎export function InstallButton({
‎  label = 'Install App',
‎  onInstall,
‎  className = '',
‎}: InstallButtonProps) {
‎  const { canInstall, isInstalled, platform, supportsNativePrompt, install } =
‎    useInstallPrompt();
‎
‎  const [showInstructions, setShowInstructions] = useState(false);
‎
‎  // Already running as a PWA — nothing to show
‎  if (isInstalled) return null;
‎
‎  const handleClick = async () => {
‎    if (canInstall) {
‎      const outcome = await install();
‎      onInstall?.(outcome);
‎    } else {
‎      // Unsupported browser (Safari, Firefox desktop, etc.) — show manual steps
‎      setShowInstructions(true);
‎    }
‎  };
‎
‎  const instructions = INSTALL_INSTRUCTIONS[platform];
‎
‎  return (
‎    <>
‎      {/* ── Trigger button ───────────────────────────────────────────────── */}
‎      <button
‎        onClick={handleClick}
‎        className={`install-button ${className}`.trim()}
‎        aria-label={label}
‎      >
‎        {label}
‎      </button>
‎
‎      {/* ── Manual instructions bottom sheet ─────────────────────────────── */}
‎      {showInstructions && (
‎        <div
‎          className="install-sheet-overlay"
‎          role="dialog"
‎          aria-modal="true"
‎          aria-label="Install instructions"
‎          onClick={(e) => {
‎            // Close when clicking the backdrop
‎            if (e.target === e.currentTarget) setShowInstructions(false);
‎          }}
‎        >
‎          <div className="install-sheet">
‎            <div className="install-sheet-header">
‎              <h3 className="install-sheet-title">
‎                Install on {PLATFORM_LABELS[platform]}
‎              </h3>
‎              <button
‎                className="install-sheet-close"
‎                onClick={() => setShowInstructions(false)}
‎                aria-label="Close"
‎              >
‎                ✕
‎              </button>
‎            </div>
‎
‎            <ol className="install-sheet-steps">
‎              {instructions.steps.map((step, i) => (
‎                <li key={i} className="install-sheet-step">
‎                  {step}
‎                </li>
‎              ))}
‎            </ol>
‎
‎            {instructions.note && (
‎              <p className="install-sheet-note">{instructions.note}</p>
‎            )}
‎          </div>
‎        </div>
‎      )}
‎    </>
‎  );
‎}
‎
‎/**
‎ * USAGE
‎ * ─────────────────────────────────────────────────────────────────────────────
‎ *
‎ * 1. Basic:
‎ *    <InstallButton />
‎ *
‎ * 2. Custom label + callback:
‎ *    <InstallButton
‎ *      label="Add to Home Screen"
‎ *      onInstall={(outcome) => {
‎ *        if (outcome === 'accepted') trackEvent('pwa_installed');
‎ *      }}
‎ *    />
‎ *
‎ * 3. Hook only (build your own UI):
‎ *    const { canInstall, isInstalled, install, platform } = useInstallPrompt();
‎ *
‎ * ─────────────────────────────────────────────────────────────────────────────
‎ * HOW IT HANDLES EACH BROWSER
‎ *
‎ * Chrome / Edge / Opera (all platforms)
‎ *   → Fires beforeinstallprompt → native dialog shown via install()
‎ *
‎ * Samsung Internet (Android)
‎ *   → Same as above, but warns about the Play Protect dialog in the note
‎ *
‎ * Safari (iOS / macOS)
‎ *   → No beforeinstallprompt → shows manual step-by-step bottom sheet
‎ *
‎ * Firefox (Android)
‎ *   → No event → shows manual instructions with Firefox-specific steps
‎ *
‎ * Firefox (Desktop)
‎ *   → No PWA install support at all → shows instructions + note
‎ *
‎ * ─────────────────────────────────────────────────────────────────────────────
‎ * SUGGESTED CSS  (add to your global stylesheet or a CSS module)
‎ *
‎ * .install-button { ... your existing button styles ... }
‎ *
‎ * .install-sheet-overlay {
‎ *   position: fixed; inset: 0;
‎ *   background: rgba(0,0,0,0.5);
‎ *   display: flex; align-items: flex-end; justify-content: center;
‎ *   z-index: 1000;
‎ * }
‎ * .install-sheet {
‎ *   background: #fff; border-radius: 16px 16px 0 0;
‎ *   padding: 24px; width: 100%; max-width: 480px;
‎ * }
‎ * .install-sheet-header {
‎ *   display: flex; align-items: center; justify-content: space-between;
‎ *   margin-bottom: 16px;
‎ * }
‎ * .install-sheet-title { font-size: 1.1rem; font-weight: 600; }
‎ * .install-sheet-close {
‎ *   background: none; border: none; font-size: 1.2rem;
‎ *   cursor: pointer; color: #666;
‎ * }
‎ * .install-sheet-steps {
‎ *   padding-left: 20px; display: flex; flex-direction: column; gap: 12px;
‎ * }
‎ * .install-sheet-step { line-height: 1.5; }
‎ * .install-sheet-note {
‎ *   margin-top: 16px; font-size: 0.85rem;
‎ *   color: #888; font-style: italic;
‎ * }
‎ */
‎
‎{
‎  "name": "Your App Name",
‎  "short_name": "App",
‎  "description": "A short description of what your app does.",
‎  "id": "your-app-id",
‎  "start_url": "/?source=pwa",
‎  "display": "standalone",
‎  "background_color": "#ffffff",
‎  "theme_color": "#000000",
‎  "orientation": "portrait-primary",
‎  "icons": [
‎    {
‎      "src": "/icons/icon-192.png",
‎      "sizes": "192x192",
‎      "type": "image/png",
‎      "purpose": "any"
‎    },
‎    {
‎      "src": "/icons/icon-512.maskable.png",
‎      "sizes": "512x512",
‎      "type": "image/png",
‎      "purpose": "maskable"
‎    }
‎  ],
‎  "screenshots": [
‎    {
‎      "src": "/screenshots/mobile-1.png",
‎      "sizes": "390x844",
‎      "type": "image/png",
‎      "form_factor": "narrow",
‎      "label": "Home screen on mobile"
‎    },
‎    {
‎      "src": "/screenshots/desktop-1.png",
‎      "sizes": "1280x800",
‎      "type": "image/png",
‎      "form_factor": "wide",
‎      "label": "Home screen on desktop"
‎    }
‎  ]
‎}
‎
‎/**
‎ * REQUIREMENTS CHECKLIST
‎ * ─────────────────────────────────────────────────────
‎ * ✅ "name" or "short_name"        → required
‎ * ✅ "icons"                        → at least one icon required
‎ * ✅ "start_url"                    → required
‎ * ✅ "display"                      → must be "standalone" | "fullscreen" | "minimal-ui"
‎ * ✅ Served over HTTPS              → required (on the server side)
‎ * ✅ Linked from every HTML page    → <link rel="manifest" href="/manifest.json">
‎ *
‎ * SCREENSHOT RULES
‎ * ─────────────────────────────────────────────────────
‎ * • Width and height: min 320px, max 3840px
‎ * • Max dimension cannot exceed 2.3× the min dimension
‎ * • All screenshots with the same form_factor must share the same aspect ratio
‎ * • Formats: JPEG or PNG only
‎ * • Max 8 screenshots shown (browser ignores extras)
‎ * • "narrow" = mobile devices, "wide" = desktop devices
‎ *
‎ * ICON TIPS
‎ * ─────────────────────────────────────────────────────
‎ * • Always provide both 192×192 and 512×512
‎ * • Use "maskable" purpose for the 512 so Android clips it correctly
‎ * • Generate maskable icons at: https://maskable.app
‎ */
‎
2.Notifications:
‎
‎const registration = await navigator.serviceWorker.getRegistration();
‎
‎const base64UrlToUint8Array = base64UrlData => {
‎  const padding = '='.repeat((4 - base64UrlData.length % 4) % 4);
‎  const base64 = (base64UrlData + padding)
‎  .replace(/\-/g, '+')
‎  .replace(/_/g, '/');
‎
‎  const rawData = atob(base64);
‎  const buffer = new Uint8Array(rawData.length);
‎
‎  for(let i = 0; i < rawData.length; ++i) {
‎    buffer[i] = rawData.charCodeAt(i);
‎  }
‎
‎  return buffer;
‎};
‎
‎const subscribeToPushMessages = (registration, publicKey) => registration.pushManager.subscribe({
‎  userVisibleOnly: true,
‎  applicationServerKey: base64UrlToUint8Array(publicKey)
‎});
‎
‎const unsubscribeFromPushMessages = subscription => subscription.unsubscribe();
‎
‎const getPushSubscription = () => registration.pushManager.getSubscription();
‎
‎const apiUrl = '...';
‎const sendPushMessage = async ({title, message, delay, interaction}) => {
‎  const pushSubscription = await getPushSubscription();
‎  const delayTime = !Number.isInteger(parseInt(delay, 10)) ? 0 :
‎    delay > 5 ? 5 : delay;
‎
‎  fetch(apiUrl, {
‎    method: 'POST',
‎    headers: {
‎      'Content-Type': 'application/json'
‎    },
‎    body: JSON.stringify({
‎      pushSubscription,
‎      title,
‎      message,
‎      delay: delayTime * 1000,
‎      interaction
‎    })
‎  });
‎};
‎
‎// in service worker
‎self.addEventListener('push', async e => {
‎  const data = e.data.json();
‎  const {title, message, interaction} = data;
‎
‎  const options = {
‎    body: message,
‎    icon: '/src/img/icons/icon-512x512.png',
‎    vibrate: [100, 50, 100],
‎    data: {
‎      dateOfArrival: Date.now()
‎    },
‎    actions: [
‎      {
‎        action: 'confirm',
‎        title: 'OK'
‎      },
‎      {
‎        action: 'close',
‎        title: 'Close notification'
‎      },
‎    ],
‎    requireInteraction: interaction
‎  };
‎
‎  e.waitUntil(
‎    self.registration.showNotification(title, options)
‎    .then(hasActiveClients)
‎    .then((activeClients) => {
‎      if(!activeClients) {
‎        self.numBadges += 1;
‎        navigator.setAppBadge(self.numBadges);
‎      }
‎    })
‎    .catch(err => sendMessage(err))
‎  )
‎});
‎    
‎https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification
‎https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API
‎https://caniuse.com/#feat=notifications
