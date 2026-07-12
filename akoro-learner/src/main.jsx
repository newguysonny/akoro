import React from 'react';
import ReactDOM from 'react-dom/client';
import { io } from 'socket.io-client';
import App from './App.jsx';
import { API } from './services/api.js';
import './index.css';

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
const BASE_DOMAIN = (import.meta.env.VITE_SITE_BASE_DOMAIN || 'akoro.name.ng').toLowerCase();
const APP_SUBDOMAINS = new Set(
  (import.meta.env.VITE_APP_SUBDOMAINS || 'www,app,api,admin,instructor,instructors,school,akoro-school,learn,learner')
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

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
