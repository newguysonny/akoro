import React from 'react';
import ReactDOM from 'react-dom/client';
import { io } from 'socket.io-client';
import App from './App.jsx';
import { API, initOfflineSync } from './services/api.js';
import { isChunkError, recoverFromStaleChunk } from './utils/chunkRetry.js';
import './index.css';

// Global net for stale-chunk failures after a deploy — covers dynamic imports
// that don't go through a React lazy boundary (Vite fires vite:preloadError;
// unhandled rejections catch the rest). Recovery is guarded to reload once.
window.addEventListener('vite:preloadError', (e) => { e.preventDefault(); recoverFromStaleChunk(); });
window.addEventListener('unhandledrejection', (e) => { if (isChunkError(e?.reason)) recoverFromStaleChunk(); });

/**
 * Multi-tenant guard — the Vercel wildcard (*.akoro.name.ng) can land here.
 *
 * A wildcard subdomain of the base domain (e.g. baptist-high.akoro.name.ng)
 * is a SCHOOL SITE, not the learner app: fetch the server-rendered tenant
 * page for this hostname and replace the document with it. Hosts that
 * resolve to no school get the API's branded 404 page — never the main app.
 * The apex domain, www, and the dedicated app subdomains (admin,
 * instructors, akoro-school, …) boot the learner app as normal.
 */
// Registrable base domain — not hardcoded. Reuses the URLs we already
// configure: the learner site URL, else the API URL (leading www./api.
// stripped). Override with VITE_SITE_BASE_DOMAIN if ever needed.
const hostOf = (url) => String(url || '').trim().toLowerCase()
  .replace(/^[a-z]+:\/\//, '').split('/')[0].split(':')[0].replace(/^(www|api)\./, '');
const BASE_DOMAIN = (
  import.meta.env.VITE_SITE_BASE_DOMAIN ||
  hostOf(import.meta.env.VITE_LEARNER_URL) ||
  hostOf(import.meta.env.VITE_API_URL) ||
  'akoro.name.ng'
).toLowerCase();
// App subdomains that must never be treated as tenant sites. The dedicated
// apps (admin/instructor/school) should be routed to their own deployments by
// the DNS/host provider, but if the wildcard ever catches one, list it here so
// it doesn't 404 as an unknown school.
const APP_SUBDOMAINS = new Set(
  (import.meta.env.VITE_APP_SUBDOMAINS || 'www,app,api,admin,instructor,instructors,school,akoro-school,akoro-instructor,akoro-admin,learn,learner')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
);

const host = window.location.hostname.toLowerCase();
const sub = host.endsWith(`.${BASE_DOMAIN}`) ? host.slice(0, -(BASE_DOMAIN.length + 1)) : null;
const isTenantHost = !!sub && !sub.includes('.') && !APP_SUBDOMAINS.has(sub);

if (isTenantHost) {
  if (/^\/(apply|pay|results)(\/|$)/.test(window.location.pathname)) {
    // Public portal pages served by the API on the tenant's own domain.
    const q = new URLSearchParams(window.location.search);
    q.set('host', host);
    window.location.replace(`${API}/api/school/public${window.location.pathname}?${q}`);
  } else {
    fetch(`${API}/api/school/site/by-host?host=${encodeURIComponent(host)}&path=${encodeURIComponent(window.location.pathname)}`)
      .then(async (r) => {
        const html = await r.text();
        document.open();
        document.write(html);
        document.close();
      })
      .catch(() => {
        document.getElementById('root').innerHTML =
          '<div style="font-family:system-ui;padding:60px 24px;text-align:center;color:#6B6B80">' +
          '<h2 style="color:#1A1A2E">This school site is temporarily unavailable.</h2>' +
          '<p>Please try again in a moment.</p></div>';
      });
  }
} else {
  // The teaching/decay sessions and live cognitive state connect through a
  // global `window.io` (the socket.io client). Expose it once here so every
  // component that calls `window.io(API, …)` has a real client available.
  if (typeof window !== 'undefined') window.io = io;

  // Replay any writes queued while offline (on boot + whenever we reconnect).
  initOfflineSync();

  // Level-switch splash: Settings staged `akoro_level_reload` and reloaded
  // the page; index.html is showing the branded boot screen. Fade it out
  // once the app has painted and had a beat to restore the session, then
  // clear the flag. Hard cap so a slow boot can never stick on the splash.
  const stagedReload = (() => { try { return !!localStorage.getItem('akoro_level_reload'); } catch { return false; } })();
  const dismissLevelSplash = () => {
    const s = document.getElementById('akoro-splash');
    if (!s || s.dataset.closing === '1') return;
    s.dataset.closing = '1';
    s.style.transition = 'opacity .3s ease';
    s.style.opacity = '0';
    setTimeout(() => {
      s.remove();
      try { localStorage.removeItem('akoro_level_reload'); } catch { /* noop */ }
    }, 320);
  };
  if (stagedReload) {
    setTimeout(dismissLevelSplash, 800);
    setTimeout(dismissLevelSplash, 4000);   // safety net
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
