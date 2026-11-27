import React from 'react';
import ReactDOM from 'react-dom/client';
import { API } from './services/api.js';
import { classifyHost, siteHostConfig, PUBLIC_PORTAL_PATH } from './utils/siteHost.js';

/**
 * This deployment serves BOTH the school portal (admin app) AND the schools' public websites.
 *
 * Public sites are the wildcard <slug>.akoro.name.ng and the schools' verified custom domains. A request for any host
 * that isn't the portal's own asks the API to render that school's site (by host) and writes it into the page; the
 * portal-only /apply, /pay and /results pages are forwarded to the API on the school's own domain. If no school owns
 * the host (404) the portal boots instead, so a mis-listed portal host can never lock admins out.
 */
const host = window.location.hostname.toLowerCase();
const cfg = siteHostConfig(import.meta.env);

// The portal's code is loaded only when the portal is what's being shown — a school's visitors never download it.
async function bootPortal() {
  const [appMod, errMod, confirmMod, bannerMod, themeMod, varsMod] = await Promise.all([
    import('./App.jsx'), import('./components/ErrorBoundary.jsx'), import('./components/ConfirmHost.jsx'), import('./components/ConnectionBanner.jsx'),
    import('./ui/theme.jsx'), import('./theme/schoolVars.js'),
    import('@tabler/icons-webfont/dist/tabler-icons.min.css'), import('./ui/base.css'),
  ]);
  const App = appMod.default;
  const ErrorBoundary = errMod.default;
  const ConfirmHost = confirmMod.default;
  const ConnectionBanner = bannerMod.default;
  const { ThemeProvider, learnerVars, applyTheme, readMode } = themeMod;
  // The learner app's look: its theme (light + dark) and Nunito. The shared
  // kit's base styles apply under <html data-ui="next">. Portal only — the
  // public-website path below must not see any of this.
  document.documentElement.setAttribute('data-ui', 'next');
  const themeVars = (isDark) => ({ ...learnerVars(isDark), ...varsMod.SCHOOL_VARS });
  const font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap';
  document.head.appendChild(font);
  applyTheme(readMode(), { vars: themeVars, dark: true });
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ThemeProvider vars={themeVars} dark>
      <ErrorBoundary>
        <App />
        {/* One host for every confirmDialog() call in the app. */}
        <ConfirmHost />
        {/* Explains an outage that pages would otherwise render as "nothing here". */}
        <ConnectionBanner />
      </ErrorBoundary>
      </ThemeProvider>
    </React.StrictMode>
  );
}

if (classifyHost(host, cfg) === 'portal') {
  bootPortal();
} else if (PUBLIC_PORTAL_PATH.test(window.location.pathname)) {
  // Public admission / payment / results pages, served by the API on the school's own domain.
  const q = new URLSearchParams(window.location.search);
  q.set('host', host);
  window.location.replace(`${API}/api/school/public${window.location.pathname}?${q}`);
} else {
  fetch(`${API}/api/school/site/by-host?host=${encodeURIComponent(host)}&path=${encodeURIComponent(window.location.pathname)}`)
    .then(async (r) => {
      if (r.status === 404) { bootPortal(); return; }   // not a school's host after all → the portal
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
