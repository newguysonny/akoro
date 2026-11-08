/**
 * ssr-entry.jsx — built by `vite build --ssr` (scripts/seo-pages.mjs runs it) to render a marketing page to HTML at build time.
 * The app still mounts with createRoot, so this is what crawlers and link previews read, and what shows before JavaScript loads.
 */
import { Writable } from 'node:stream';
import { renderToPipeableStream } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { AppRoutes } from '../App.jsx';
import { AuthProvider } from '../contexts/AuthContext.jsx';
import { ThemeProvider } from '../contexts/ThemeContext.jsx';
import { LanguageProvider } from '../contexts/LanguageContext.jsx';
import { CartProvider } from '../contexts/CartContext.jsx';

export function renderRoute(url) {
  return new Promise((resolve, reject) => {
    let html = '';
    const sink = new Writable({ write(chunk, _enc, cb) { html += chunk.toString(); cb(); } });
    const { pipe, abort } = renderToPipeableStream(
      <ThemeProvider><LanguageProvider><AuthProvider><CartProvider>
        <StaticRouter location={url}><AppRoutes /></StaticRouter>
      </CartProvider></AuthProvider></LanguageProvider></ThemeProvider>,
      {
        onAllReady() { sink.on('finish', () => resolve(html)); pipe(sink); },
        onShellError: reject,
        onError: (e) => { reject(e); },
      },
    );
    setTimeout(() => { abort(); reject(new Error('render timed out')); }, 20000);
  });
}
