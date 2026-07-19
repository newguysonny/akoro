import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Auto-update the service worker when a new build ships; no user prompt.
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Keep the hand-written public/manifest.json as the source of truth.
      manifest: false,
      // Don't run the SW during `vite dev` — avoids stale-cache confusion locally.
      devOptions: { enabled: false },
      workbox: {
        // Precache the built app shell so the app opens with no connection.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Keep the shell lean for low-bandwidth users: the heavy TensorFlow
        // (face-detection) + hls video chunks are lazy-loaded, online-only
        // features (proctored assessment / video). They're cached on demand by
        // the asset runtime rule below instead of bloating the first-load precache.
        globIgnores: ['**/blazeface*.js', '**/graph_model*.js', '**/hls*.js'],
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
        ],
      },
    }),
  ],
  server: { port: 3000, host: true },
});
