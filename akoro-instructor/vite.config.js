import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Installable / offline-capable instructor PWA (same shape as the learner
    // app): precache the built shell, prompt on a new build (UpdatePrompt owns
    // the swap), and keep the hand-written public/manifest.json as the source
    // of truth.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      devOptions: { enabled: false },
      workbox: {
        // The built shell (entry JS/CSS + index.html) and static assets.
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,ico,woff2}'],
        // Serve the precached shell for app navigations so it opens offline.
        navigateFallback: 'index.html',
        // Never hand the shell to API calls or file-like URLs.
        navigateFallbackDenylist: [/^\/api\//, /\/[^/?]+\.[a-z0-9]+$/i],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server:  { port: 3001, host: true },
});
