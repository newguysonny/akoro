/**
 * OfflineBanner — a slim fixed banner shown while the device is offline.
 * Purely presentational: the service worker (Phase 1 PWA) serves the cached
 * app shell and last-seen content, and this tells the learner why live actions
 * (teaching, assessment, chat) may not go through until they reconnect.
 */
import { useEffect, useState } from 'react';

export default function OfflineBanner() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  if (!offline) return null;

  return (
    <div role="status" style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 3000,
      background: '#1A1A2E', color: '#fff',
      fontFamily: "'Nunito', system-ui, sans-serif", fontSize: 13, fontWeight: 700,
      padding: '9px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      boxShadow: '0 -2px 12px rgba(0,0,0,.18)',
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F59E0B', flexShrink: 0 }} />
      You’re offline — showing saved content. Live lessons resume when you reconnect.
    </div>
  );
}
