/**
 * The app as the frontend gate runs it in LOCAL mode: its normal Vite config
 * (UI_GATE_BASE_CONFIG — the learner app's, or the instructor app's), built into UI_GATE_DIST and served by `vite preview` on
 * localhost, with /api and /socket.io passed through to the live API
 * (UI_GATE_API). The app and its API share one origin, so
 * cookies and CORS behave like production without the deployed site.
 */
import { defineConfig } from 'vite';
const base = (await import(process.env.UI_GATE_BASE_CONFIG || '../vite.config.js')).default;

const target = process.env.UI_GATE_API || 'https://api.akoro.name.ng';
const port = Number(process.env.UI_GATE_PORT || 4321);
// Behind an outbound proxy (a cloud sandbox), the pass-through goes through it too.
const outbound = process.env.HTTPS_PROXY
  ? new (await import('https-proxy-agent')).HttpsProxyAgent(process.env.HTTPS_PROXY)
  : undefined;
// The API accepts the learner app's own origin (and its sockets accept only
// portal origins), so the pass-through presents the deployed app's origin.
const appOrigin = process.env.UI_GATE_ORIGIN || 'https://akoro.name.ng';
// UI_GATE_EDGE_HEADER="Name: value": what the edge in front of the API
// (a Cloudflare skip rule) lets through.
const edgeRaw = String(process.env.UI_GATE_EDGE_HEADER || '');
const edge = edgeRaw.indexOf(':') > 0 ? { [edgeRaw.slice(0, edgeRaw.indexOf(':')).trim()]: edgeRaw.slice(edgeRaw.indexOf(':') + 1).trim() } : {};
const passThrough = (_proxy, options) => {
  if (outbound) options.agent = outbound;
  options.headers = { ...(options.headers || {}), ...edge, origin: appOrigin };
};

const proxy = {
  '/api': { target, changeOrigin: true, secure: true, configure: passThrough },
  '/socket.io': { target, changeOrigin: true, secure: true, ws: true, configure: passThrough },
};

export default defineConfig(async (env) => {
  const b = typeof base === 'function' ? await base(env) : base;
  return {
    ...b,
    build: { ...(b.build || {}), outDir: process.env.UI_GATE_DIST || 'dist-ui-gate', emptyOutDir: true },
    preview: { host: '127.0.0.1', port, strictPort: true, proxy },
  };
});
