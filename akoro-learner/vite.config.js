import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Replay-safe, fire-and-forget write endpoints that may be queued offline and
// replayed via the Background Sync API (even if the app is closed). MUST stay in
// sync with the calls that pass { queueOffline: true } in the app code.
const QUEUEABLE_POST = ['/api/notifications/mark-read', '/api/profiles/me/teacher-request', '/api/adaptive/marketplace/set-default'];
const QUEUEABLE_PATCH = ['/api/profiles/me', '/api/profiles/me/notifications'];

// VITE_TARGET: 'landing' (marketing site, no PWA), 'app' (the learner product) or unset/'full' (both) — see src/config/target.js
const LANDING = process.env.VITE_TARGET === 'landing';

export default defineConfig({
  // @excalidraw/excalidraw 0.17.x reads process.env.IS_PREACT at import time;
  // Vite doesn't polyfill process in the browser, so define it (false = React).
  define: {
    'process.env.IS_PREACT': JSON.stringify('false'),
  },
  plugins: [
    react(),
    VitePWA({
      // The marketing site is a plain website: no service worker, nothing installable.
      disable: LANDING,
      // Prompt mode: when a new build ships the SW waits, and the app shows a
      // "new version available" banner (auto-reloads after a countdown). We
      // register the SW ourselves (see UpdatePrompt) to receive onNeedRefresh.
      registerType: 'prompt',
      injectRegister: false,
      // Keep the hand-written public/manifest.json as the source of truth.
      manifest: false,
      // Don't run the SW during `vite dev` — avoids stale-cache confusion locally.
      devOptions: { enabled: false },
      workbox: {
        // Pull our Web Push handlers (push / notificationclick) into the
        // generated service worker. Lives in public/ so it ships as /push-sw.js.
        importScripts: ['/push-sw.js', '/sw-repair.js'],
        // Precache the built app shell so the app opens with no connection.
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,ico,woff2}'],
        // Keep the shell lean for low-bandwidth users: the heavy TensorFlow
        // (face-detection) + hls video chunks are lazy-loaded, online-only
        // features (proctored assessment / video). They're cached on demand by
        // the asset runtime rule below instead of bloating the first-load precache.
        globIgnores: [
          // Heavy, online-only feature chunks (face-detection + video).
          '**/blazeface*.js', '**/graph_model*.js', '**/hls*.js',
          // Rarely-needed-offline marketing / legal / info pages — code-split into
          // their own chunks and runtime-cached on first visit instead of bloating
          // the first-install precache. Core learner flows stay precached.
          '**/InstructorInfoPage-*.js', '**/SchoolInfoPage-*.js', '**/StudentInfoPage-*.js',
          '**/AboutPage-*.js', '**/ContactPage-*.js', '**/CareersPage-*.js',
          '**/BlogPage-*.js', '**/BlogPostPage-*.js', '**/PartnersPage-*.js',
          '**/PrivacyPolicyPage-*.js', '**/TermsOfServicePage-*.js', '**/FDEAdminPage-*.js',
        ],
        // Belt-and-braces: drop any heavy lazy chunk (>400 KB) from the
        // first-install precache regardless of its hashed name — e.g. the AI
        // drawing page's Excalidraw + Mermaid bundles. They're code-split and
        // runtime-cached on first use instead, keeping the PWA install lean.
        manifestTransforms: [
          (entries) => {
            const MAX = 400 * 1024;
            // NEVER drop the app entry (index-*.js/.css, which index.html loads
            // directly). It is >400 KB, so this filter used to drop it: the
            // precached shell then pointed at an entry that lived only in the
            // evictable runtime cache, and after a deploy the old file was gone
            // from the server → blank screen until the user cleared site data.
            // The shell and its entry must always be precached TOGETHER.
            const isEntry = (url) => /^assets\/index-[^/]+\.(?:js|css)$/.test(String(url).replace(/^\//, ''));
            const manifest = entries.filter((e) => isEntry(e.url) || (e.size ?? 0) <= MAX);
            return { manifest, warnings: [] };
          },
        ],
        // App-shell navigation. IMPORTANT: vite-plugin-pwa ADDS
        // `navigateFallback: 'index.html'` when the option is left out, so the
        // old "no navigateFallback" comment here was never true — every launch
        // was served the precached shell and the network-first HTML rule below
        // never ran. We now set it on purpose: the shell comes from the
        // precache (instant boot, works offline, never waits on a 3–5 KB/s
        // network) and it is always self-consistent with the precached chunks
        // of the SAME service worker. Freshness comes from the update flow
        // (UpdatePrompt applies a waiting version at launch and when the app is
        // closed), not from fetching HTML on every open. What broke the old
        // setup was a missing lazy chunk being answered with index.html by the
        // Vercel SPA rewrite and then CACHED as JavaScript — fixed by the
        // vercel.json /assets exclusion and the content-type guard below.
        navigateFallback: 'index.html',
        // Never hand the learner shell to API calls, the separately built AI
        // chat app, or anything that looks like a file.
        navigateFallbackDenylist: [/^\/api\//, /^\/ai-chat(\/|$)/, /\/[^/?]+\.[a-z0-9]+$/i],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // NOTE: deliberately NO `skipWaiting` baked into the SW — a new build
        // INSTALLS AND WAITS behind the old one, and UpdatePrompt owns the
        // swap (Reload now / countdown → updateSW(true) → postMessage
        // SKIP_WAITING → controllerchange → reload). Baking skipWaiting in
        // activated the new SW mid-session: cleanupOutdatedCaches deleted the
        // old precache under the still-running OLD page, whose next lazy chunk
        // 404'd → the "hangs a bit, then refreshes" users saw after every
        // deploy (chunkRetry caught it, but late, and the banner never showed
        // because the waiting phase it detects lasted ~0ms). With the waiting
        // flow the old SW keeps serving the old page its own cached chunks —
        // nothing 404s — until the banner's accept swaps versions atomically.
        // The nets stay for edge cases: chunkRetry + preloadError, and the
        // boot watchdog in index.html (repairs a shell that never starts).
        runtimeCaching: [
          {
            // Navigations the app-shell fallback skips (the denylist above:
            // /ai-chat, file-like URLs) → NetworkFirst, last copy when offline.
            // 12s, not 3s: on a 3–5 KB/s connection 3s always timed out.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'akoro-html',
              networkTimeoutSeconds: 12,
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 2 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Lazy-loaded JS/CSS chunks (incl. the excluded heavy ones) → cache
            // after first fetch so previously-used features work offline too.
            urlPattern: ({ url, request }) => url.origin === self.location.origin && /\.(?:js|css)$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'akoro-assets',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
              // Only ever store real JS/CSS. A missing chunk used to come back
              // as index.html (200, text/html) and was cached under the .js
              // URL — that feature then failed on every open until the user
              // cleared site data.
              plugins: [{
                cacheWillUpdate: async ({ response }) => {
                  const type = (response && response.headers.get('content-type')) || '';
                  return response && response.status === 200 && /javascript|css/i.test(type) ? response : null;
                },
              }],
            },
          },
          {
            // The signed-in learner's profile controls the active UI tier.
            // It must never be served from the catalog cache immediately after
            // a confirmed settings save: a reload needs the current server
            // value, not a stale pre-change schoolType/studyLevel. apiGet still
            // has its own last-known-good offline fallback for a real outage.
            // This rule intentionally comes before the broad public-profiles
            // catalog rule below; Workbox uses the first matching runtime rule.
            urlPattern: ({ url, request }) => request.method === 'GET' &&
              url.pathname.startsWith('/api/profiles/me'),
            handler: 'NetworkOnly',
          },
          {
            // Stable CATALOG reads (course/agent listings, rankings, public
            // profiles) → StaleWhileRevalidate: instant render + offline browsing.
            // Staleness here is harmless and refreshes in the background.
            urlPattern: ({ url, request }) => request.method === 'GET' &&
              /^\/api\/(courses|discover|ranking|profiles|adaptive\/marketplace\/listings|adaptive\/marketplace\/search)/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'akoro-catalog',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // PERSONAL / mutable reads (cart, notifications, enrolments, orders,
            // payments, live sessions, purchases…) → NetworkFirst: always prefer
            // fresh data when online so a change shows without a manual refresh;
            // fall back to the last cached copy only when offline or the network
            // is slow (3s). This is what keeps the UI live after add-to-cart etc.
            urlPattern: ({ url, request }) => request.method === 'GET' &&
              url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'akoro-api',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Google Fonts stylesheet + files → cache-first so type renders offline.
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'akoro-fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Queueable POST writes → try network; if it fails offline, Workbox's
            // Background Sync queue holds the request and replays it when
            // connectivity returns, even if the tab/app is closed.
            urlPattern: ({ url }) => QUEUEABLE_POST.includes(url.pathname),
            handler: 'NetworkOnly',
            method: 'POST',
            options: {
              backgroundSync: { name: 'akoro-writes-post', options: { maxRetentionTime: 60 * 24 } }, // 24h
            },
          },
          {
            // Queueable PATCH writes → same Background Sync treatment.
            urlPattern: ({ url }) => QUEUEABLE_PATCH.includes(url.pathname),
            handler: 'NetworkOnly',
            method: 'PATCH',
            options: {
              backgroundSync: { name: 'akoro-writes-patch', options: { maxRetentionTime: 60 * 24 } },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 3000,
    host: true,
    // Arena's live-preview proxies the dev server under *.e2b.app — without
    // this, Vite 5 rejects that Host header with 403. Dev-only; harmless.
    allowedHosts: true,
  },
});
