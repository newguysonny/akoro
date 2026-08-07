/**
 * ConnectionBanner — the safety net under every swallowed request.
 *
 * Most .catch(() => {}) in this app guards a secondary read: a badge count, a
 * dropdown, a side panel. Individually each is a reasonable choice — a failed
 * badge count shouldn't interrupt anyone. Collectively they mean that during an
 * outage the app quietly renders as though everything is simply EMPTY, with no
 * clue that anything failed.
 *
 * Rather than give ~170 call sites their own error state, the API layer reports
 * network failures here, and this says the one thing they all have in common:
 * it's the connection, not your data. It clears itself the moment a request
 * succeeds again.
 */
import { useState, useEffect } from 'react';
import { onConnectionChange } from '../services/api.js';
import { WHITE, FONT } from '../constants.js';

export default function ConnectionBanner() {
  const [down, setDown] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const off = onConnectionChange(({ ok, offline: isOffline }) => {
      setDown(!ok);
      setOffline(!!isOffline);
    });
    const goOffline = () => { setDown(true); setOffline(true); };
    const goOnline  = () => { setDown(false); setOffline(false); };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      off();
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!down) return null;

  return (
    <div role="status" style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 3500,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      padding: '10px 16px', background: '#7C2D12', color: WHITE,
      fontFamily: FONT, fontSize: 12.5, fontWeight: 700,
      boxShadow: '0 -4px 16px rgba(0,0,0,.18)',
    }}>
      <span>{offline ? '📴' : '⚠️'}</span>
      <span>
        {offline
          ? "You're offline — anything on this page may be out of date."
          : "Can't reach Akoro right now — parts of this page may be missing or out of date."}
      </span>
      <button onClick={() => window.location.reload()} style={{
        marginLeft: 4, padding: '4px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,.35)',
        background: 'transparent', color: WHITE, fontSize: 11.5, fontWeight: 800,
        cursor: 'pointer', fontFamily: FONT,
      }}>Retry</button>
    </div>
  );
}
