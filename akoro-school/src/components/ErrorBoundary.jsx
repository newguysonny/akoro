/**
 * ErrorBoundary — the difference between "something broke" and a white screen.
 *
 * Without one, a single render error anywhere unmounts the whole tree and the
 * user is left staring at a blank page with no way back and nothing to report.
 * This catches it, says so plainly, and offers the two things that actually
 * help: reload, or go home.
 *
 * It also handles the most common "crash" that isn't one. After a deploy the
 * old page still holds hashed chunk URLs that no longer exist, so the next lazy
 * import throws. That is a stale tab, not a bug — reload onto the new build
 * instead of accusing the user's work of failing.
 */
import { Component } from 'react';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const CHUNK_RE = /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;
const RELOADED_KEY = 'akoro_chunk_reloaded_at';

function isChunkError(err) {
  return CHUNK_RE.test(err?.message || '') || CHUNK_RE.test(err?.name || '');
}

/** Reload once per minute at most, so a genuinely broken build can't loop. */
function recoverFromStaleChunk() {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_KEY) || 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
  } catch { /* private mode — reload anyway, the guard is best-effort */ }
  window.location.reload();
  return true;
}

export default class ErrorBoundary extends Component {
  state = { hasError: false, error: null, recovering: false };

  static getDerivedStateFromError(error) {
    return { hasError: true, error, recovering: isChunkError(error) };
  }

  componentDidCatch(error, info) {
    if (isChunkError(error) && recoverFromStaleChunk()) return;
    // Keep the real stack in the console — the user gets prose, we get detail.
    console.error('[Akoro ErrorBoundary]', error, info?.componentStack);
    this.setState({ recovering: false });
  }

  render() {
    const { hasError, error, recovering } = this.state;
    if (!hasError) return this.props.children;

    if (recovering) {
      return (
        <div style={wrap}>
          <div style={{ ...spinner, animation: 'ak-eb-spin .7s linear infinite' }} />
          <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Updating to the latest version…</div>
          <style>{'@keyframes ak-eb-spin{to{transform:rotate(360deg)}}'}</style>
        </div>
      );
    }

    return (
      <div style={wrap}>
        <div><Ico ti="ti-mood-sad" size={44} color={C.muted2} /></div>
        <h1 style={{ fontSize: 19, fontWeight: 800, color: C.ink, margin: '4px 0 0' }}>
          This page ran into a problem
        </h1>
        <p style={{ fontSize: 13.5, color: C.muted, margin: 0, maxWidth: 420, textAlign: 'center', lineHeight: 1.6 }}>
          Nothing you had saved is affected. Reloading usually clears it — if it keeps
          happening, tell us what you were doing and we'll fix it.
        </p>

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button onClick={() => window.location.reload()} style={primaryBtn}>Reload the page</button>
          <button onClick={() => { window.location.href = '/'; }} style={secondaryBtn}>Go to Home</button>
        </div>

        {/* Collapsed by default: useful when someone is reporting it, noise otherwise. */}
        <details style={{ marginTop: 10, maxWidth: 560, width: '100%' }}>
          <summary style={{ fontSize: 11.5, color: C.muted, cursor: 'pointer', fontFamily: C.font }}>
            Technical details
          </summary>
          <pre style={pre}>{String(error?.stack || error?.message || error)}</pre>
        </details>
      </div>
    );
  }
}

const wrap = {
  minHeight: '100vh', display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', gap: 12,
  padding: '32px 24px', background: C.bg, fontFamily: C.font, boxSizing: 'border-box',
};
const spinner = {
  width: 34, height: 34, borderRadius: '50%',
  border: `3px solid ${tint(25)}`, borderTopColor: C.brand,
};
const primaryBtn = {
  padding: '10px 18px', borderRadius: 11, border: 'none',
  background: `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: '#fff',
  fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font,
};
const secondaryBtn = {
  padding: '10px 18px', borderRadius: 11, border: `1.5px solid ${C.border}`,
  background: C.surface, color: C.ink, fontSize: 13.5, fontWeight: 700,
  cursor: 'pointer', fontFamily: C.font,
};
const pre = {
  marginTop: 8, padding: 12, borderRadius: 10, background: C.surface,
  border: `1px solid ${C.border}`, fontSize: 11, color: C.muted,
  overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220,
};
