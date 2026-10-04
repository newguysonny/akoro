import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5181,
    // Dev previews run behind a sandbox proxy host — allow it so the dev
    // server answers (production builds are unaffected).
    allowedHosts: ['.e2b.app'],
  },
});
