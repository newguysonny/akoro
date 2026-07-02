import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { API } from './services/api.js';

/**
 * Multi-tenant bootstrap — one codebase serves every school.
 *
 * The hostname decides what this deployment renders:
 *   • Portal hosts (VITE_PORTAL_HOSTS, localhost, *.vercel.app previews)
 *     → the school ADMIN portal (the React app).
 *   • Any other hostname — a wildcard subdomain like
 *     baptist-high-school.akoro.app or a verified custom domain like
 *     www.baptist-high-school.com — → that tenant's PUBLIC website,
 *     rendered by the API from the Host header mapping.
 */
const PORTAL_HOSTS = (import.meta.env.VITE_PORTAL_HOSTS || 'school.akoro.app')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

const host = window.location.hostname.toLowerCase();
const isPortalHost =
  PORTAL_HOSTS.includes(host) ||
  host === 'localhost' || host === '127.0.0.1' ||
  host.endsWith('.vercel.app');

if (isPortalHost) {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else if (/^\/(apply|pay|results)(\/|$)/.test(window.location.pathname)) {
  // Public portal pages (non-Vercel fallback — the Edge Middleware normally
  // rewrites these before the SPA loads). Redirect to the API-served page.
  const q = new URLSearchParams(window.location.search);
  q.set('host', host);
  window.location.replace(`${API}/api/school/public${window.location.pathname}?${q}`);
} else {
  // Tenant public site: fetch the server-rendered page for this hostname and
  // replace the document with it (styles/scripts in the payload included).
  fetch(`${API}/api/school/site/by-host?host=${encodeURIComponent(host)}`)
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
