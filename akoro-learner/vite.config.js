import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Replay-safe, fire-and-forget write endpoints that may be queued offline and
// replayed via the Background Sync API (even if the app is closed). MUST stay in
// sync with the calls that pass { queueOffline: true } in the app code.
const QUEUEABLE_POST = ['/api/notifications/mark-read', '/api/profiles/me/teacher-request', '/api/adaptive/marketplace/set-default'];
const QUEUEABLE_PATCH = ['/api/profiles/me', '/api/profiles/me/notifications'];

export default defineConfig({
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
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
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
        // SPA: offline navigations fall back to the cached shell (except API paths).
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        runtimeCaching: [
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
            // Read API (GET /api/*, any origin) → serve cache instantly, refresh
            // in the background. Lets last-seen content render offline.
            urlPattern: ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'akoro-api',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 }, // 7 days
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
  server: { port: 3000, host: true },
});
