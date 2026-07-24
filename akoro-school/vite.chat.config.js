import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/**
 * Dedicated build for the standalone AI chat served under a school's own
 * custom domain at https://<school-domain>/ai-chat.
 *
 *   base: '/ai-chat/'  → all assets are requested under /ai-chat/assets/* so
 *                        they never collide with the learner tenant app's
 *                        own /assets/* on the same host.
 *   input: chat.html   → single entry (chat-main.jsx → AiChatPage only).
 *   outDir: dist-chat  → separate output; the tenant deployment proxies
 *                        /ai-chat/* to these files.
 */
export default defineConfig({
  plugins: [react()],
  base: '/ai-chat/',
  build: {
    outDir: 'dist-chat',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'chat.html'),
    },
  },
  server: { port: 3002, host: true },
});
