import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Replay-safe, fire-and-forget write endpoints that may be queued offline and
// replayed via the Background Sync API (even if the app is closed). MUST stay in
// sync with the calls that pass { queueOffline: true } in the app code.
const QUEUEABLE_POST = ['/api/notifications/mark-read', '/api/profiles/me/teacher-request', '/api/adaptive/marketplace/set-default'];
const QUEUEABLE_PATCH = ['/api/profiles/me', '/api/profiles/me/notifications'];

export default defineConfig({
  // @excalidraw/excalidraw 0.17.x reads process.env.IS_PREACT at import time;
  // Vite doesn't polyfill process in the browser, so define it (false = React).
  define: {
    'process.env.IS_PREACT': JSON.stringify('false'),
  },
  plugins: [
    react(),
    VitePWA({
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
        importScripts: ['/push-sw.js'],
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
            const manifest = entries.filter((e) => (e.size ?? 0) <= MAX);
            return { manifest, warnings: [] };
          },
        ],
        // NOTE: no `navigateFallback` — we deliberately do NOT serve the HTML
        // shell cache-first from the precache. That was the root cause of the
        // post-deploy blank screen: a returning visitor got the OLD cached
        // index.html pointing at deleted chunks. Instead the navigation runtime
        // rule below serves the document NETWORK-FIRST, so online visitors
        // always get a fresh, self-consistent shell; offline falls back to the
        // last good copy. The Vercel SPA rewrite handles deep links.
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // Activate a newly-deployed SW immediately instead of leaving it stuck
        // in "waiting" behind the old one. Without this, a tab opened before a
        // deploy keeps being served the OLD cached index.html (which points at
        // deleted chunks) forever → the blank white screen that only cleared on
        // the raw *.vercel.app origin. With skipWaiting + clientsClaim the fresh
        // shell takes over on the next navigation, so reloads recover on their
        // own. (No forced reload — the running page keeps its JS; pair with the
        // chunkRetry escape hatch for anything loaded mid-swap.)
        skipWaiting: true,
        runtimeCaching: [
          {
            // HTML documents (SPA navigations) → NetworkFirst so a returning
            // visitor always gets the freshly-deployed shell that references the
            // current chunk hashes. Falls back to the last cached copy only when
            // offline / the network genuinely stalls.
            //
            // TIMEOUT: 3s was far too aggressive for our actual users. On a
            // 3-5 KB/s mobile connection (normal in Nigeria) the document fetch
            // ALWAYS exceeded 3s, so the SW served the stale cached shell on
            // every navigation — pinning people to an old build permanently, no
            // matter how many times we redeployed. 12s only costs a slow user
            // extra wait in the rare case the network is truly dead, and that
            // path still falls back to cache.
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
              cacheableResponse: { statuses: [0, 200] },
            },
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
