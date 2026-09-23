/**
 * MediaPlayer.jsx — the record viewer's audio/video pane.
 *
 * The ORIGINAL file plays here — no re-encoding, no proxying: the element
 * streams the presigned R2 URL directly (range requests included, so
 * seeking is instant). Controls match the app family and the reader's
 * shared toolbar:
 *
 *   · play / pause
 *   · back 10s / forward 10s
 *   · seek bar + current/total time
 *   · playback speed — 0.75× / 1× / 1.25× / 1.5× / 2× — so a recorded
 *     lesson can be slowed down to take notes or sped up to revise
 *
 * `onReady` hands the toolbar an imperative handle (toggle / skip /
 * cycleRate / state) so the reader's own toolbar buttons drive the same
 * element; `onState` keeps its icons honest. `onPosition` reports
 * watched-through ratio at 10% milestones so the shelf's progress bar
 * reflects reality. `startAt` resumes where the learner left off,
 * `onTimeUpdate` (throttled to 10s) lets a parent persist position, and
 * HLS (.m3u8) sources attach via hls.js — the same seam the course
 * player uses — so streamed course videos play here too.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Icon } from '../common/Icons.jsx';
import { BRAND, GREEN } from '../../constants.js';

const RATES = [0.75, 1, 1.25, 1.5, 2];

/* 42 → "0:42", 3675 → "1:01:15" */
const fmt = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

export default function MediaPlayer({ kind, src, title, startAt = 0, onReady, onState, onPosition, onTimeUpdate, downloadName, downloadUrl }) {
  const elRef    = useRef(null);
  const [playing, setPlaying]   = useState(false);
  const [time, setTime]         = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate]         = useState(1);
  const [error, setError]       = useState(false);
  const milestone = useRef(0);
  const tickRef   = useRef(0);
  const timeUpdateRef = useRef(onTimeUpdate);
  timeUpdateRef.current = onTimeUpdate;

  /* Element events → React state (and the toolbar's). */
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const sync = () => {
      setPlaying(!el.paused && !el.ended);
      setRate(el.playbackRate || 1);
      onState?.({ playing: !el.paused && !el.ended, rate: el.playbackRate || 1 });
    };
    const onTime = () => {
      setTime(el.currentTime || 0);
      if (Number.isFinite(el.duration) && el.duration > 0) {
        const ratio = el.currentTime / el.duration;
        const step = Math.floor(ratio * 10);
        if (step > milestone.current) { milestone.current = step; onPosition?.(step * 10); }
      }
      // Position persistence hook — throttled like the course player (10s).
      const now = Date.now();
      if (timeUpdateRef.current && now - tickRef.current >= 10000 && Number.isFinite(el.duration) && el.currentTime > 0) {
        tickRef.current = now;
        timeUpdateRef.current({ time: el.currentTime, duration: el.duration });
      }
    };
    const onMeta  = () => {
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
      // Resume where the learner left off (course videos carry last position).
      if (startAt > 0 && Number.isFinite(el.duration) && startAt < el.duration) {
        try { el.currentTime = startAt; } catch { /* ignore */ }
      }
    };
    const onEnd   = () => { milestone.current = 10; onPosition?.(100); sync(); };
    const onErr   = () => setError(true);
    el.addEventListener('play', sync);
    el.addEventListener('pause', sync);
    el.addEventListener('ratechange', sync);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnd);
    el.addEventListener('error', onErr);
    return () => {
      el.removeEventListener('play', sync);
      el.removeEventListener('pause', sync);
      el.removeEventListener('ratechange', sync);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('error', onErr);
    };
  }, [onState, onPosition, src, startAt]);

  /* Attach the source. Plain files go straight to the element; HLS (.m3u8)
     attaches through hls.js — the same seam the course player uses —
     falling back to the element when neither is supported. */
  useEffect(() => {
    if (kind !== 'video' || !src) return;
    const video = elRef.current;
    if (!video) return;
    let cancelled = false;
    let detach = () => {};
    (async () => {
      if (/\.m3u8($|\?)/i.test(src)) {
        const Hls = (await import('hls.js')).default;
        if (cancelled) return;
        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true });
          hls.loadSource(src);
          hls.attachMedia(video);
          detach = () => { try { hls.destroy(); } catch { /* ignore */ } };
          return;
        }
      }
      video.src = src;
      detach = () => { try { video.removeAttribute('src'); video.load?.(); } catch { /* ignore */ } };
    })();
    return () => { cancelled = true; detach(); };
  }, [kind, src]);

  /* The imperative handle the shared toolbar drives. */
  const toggle = useCallback(() => {
    const el = elRef.current; if (!el) return;
    if (el.paused) {
      // play() returns a Promise in browsers; guard for environments where
      // it doesn't (older WebViews, test DOMs).
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => setError(true));
    } else el.pause();
  }, []);
  const skip = useCallback((delta) => {
    const el = elRef.current; if (!el || !Number.isFinite(el.duration)) return;
    el.currentTime = Math.max(0, Math.min(el.duration, (el.currentTime || 0) + delta));
    setTime(el.currentTime);
  }, []);
  const cycleRate = useCallback((dir = 1) => {
    const el = elRef.current; if (!el) return;
    const idx = RATES.indexOf(el.playbackRate);
    const next = RATES[((idx < 0 ? 1 : idx) + dir + RATES.length) % RATES.length];
    el.playbackRate = next; setRate(next);
    onState?.({ playing: !el.paused, rate: next });
  }, [onState]);

  useEffect(() => {
    onReady?.({ toggle, skip, cycleRate, rates: RATES });
  }, [onReady, toggle, skip, cycleRate]);

  const seek = (e) => {
    const el = elRef.current; if (!el) return;
    const v = Number(e.target.value);
    el.currentTime = v; setTime(v);
  };

  /* ── The pane ── Video: the element IS the pane (native controls give
     fullscreen + volume for free; the shared toolbar drives the same
     element). Audio: a card, because a bare control bar is too thin to
     be the whole content of a session. */
  if (error) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 320 }}>
          <Icon name="ti-cloud-off" size={34} color="var(--ak-text-muted)" />
          <p style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', marginTop: 10 }}>
            This file could not be played
          </p>
          <p style={{ fontSize: 11.5, color: 'var(--ak-text-muted)', marginTop: 4, lineHeight: 1.5 }}>
            The link may have expired — close and reopen the record to get a fresh one.
          </p>
          {downloadUrl && (
            <a href={downloadUrl} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12,
              background: BRAND, color: '#fff', fontSize: 12, fontWeight: 800, padding: '9px 16px', borderRadius: 100,
              textDecoration: 'none', fontFamily: "'Nunito',sans-serif" }}>
              <Icon name="ti-download" size={13}/> Download instead
            </a>
          )}
        </div>
      </div>
    );
  }

  if (kind === 'video') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0B0B14' }}>
        <video ref={elRef} src={src} controls playsInline preload="metadata"
          style={{ flex: 1, minHeight: 0, width: '100%', objectFit: 'contain', background: '#0B0B14', outline: 'none' }}/>
      </div>
    );
  }

  /* Audio card — the element itself is hidden; the card IS its face. */
  return (
    <div style={{ height: '100%', overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <audio ref={elRef} src={src} preload="metadata" style={{ display: 'none' }}/>
      <div style={{ width: 'min(100%, 460px)', background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 20, padding: '26px 22px 20px', fontFamily: "'Nunito',sans-serif" }}>
        <div style={{ width: 92, height: 92, margin: '0 auto 14px', borderRadius: 24,
          background: `linear-gradient(135deg, ${BRAND}22, ${BRAND}0A)`, border: `1px solid ${BRAND}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="ti-music" size={38} color={BRAND}/>
        </div>
        <p style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)', textAlign: 'center', margin: '0 0 18px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</p>

        {/* seek */}
        <input type="range" min={0} max={duration || 0} step={0.1} value={Math.min(time, duration || 0)}
          onChange={seek} aria-label="Seek"
          style={{ width: '100%', accentColor: BRAND, cursor: 'pointer', height: 4 }}/>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, fontWeight: 700,
          color: 'var(--ak-text-muted)', fontFamily: "'Nunito',sans-serif", margin: '4px 2px 14px' }}>
          <span>{fmt(time)}</span><span>{fmt(duration)}</span>
        </div>

        {/* transport */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <button onClick={() => skip(-10)} aria-label="Back 10 seconds" title="Back 10s"
            style={{ width: 42, height: 42, borderRadius: '50%', border: '1px solid var(--ak-border)', background: 'var(--ak-bg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="ti-player-track-back" size={14} color="var(--ak-text-sub)"/>
            <span style={{ fontSize: 7.5, fontWeight: 900, color: 'var(--ak-text-muted)', marginTop: 1 }}>10</span>
          </button>
          <button onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'}
            style={{ width: 62, height: 62, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: `linear-gradient(135deg, ${BRAND}, #4C1DCC)`, display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 6px 18px ${BRAND}55` }}>
            <Icon name={playing ? 'ti-player-pause' : 'ti-player-play'} size={24} color="#fff"/>
          </button>
          <button onClick={() => skip(10)} aria-label="Forward 10 seconds" title="Forward 10s"
            style={{ width: 42, height: 42, borderRadius: '50%', border: '1px solid var(--ak-border)', background: 'var(--ak-bg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="ti-player-track-forward" size={14} color="var(--ak-text-sub)"/>
            <span style={{ fontSize: 7.5, fontWeight: 900, color: 'var(--ak-text-muted)', marginTop: 1 }}>10</span>
          </button>
        </div>

        {/* speed — slow it down to take notes, speed it up to revise */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 18 }}>
          {RATES.map((r) => (
            <button key={r} onClick={() => { const el = elRef.current; if (el) { el.playbackRate = r; setRate(r); } }}
              aria-pressed={rate === r} title={`Play at ${r}× speed`}
              style={{ padding: '5px 11px', borderRadius: 100, border: 'none', cursor: 'pointer', fontFamily: "'Nunito',sans-serif",
                fontSize: 11, fontWeight: 800,
                background: rate === r ? GREEN : 'var(--ak-tag-bg)', color: rate === r ? '#fff' : 'var(--ak-text-muted)' }}>
              {r}×
            </button>
          ))}
        </div>
        {downloadUrl && (
          <a href={downloadUrl} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16,
            fontSize: 11, fontWeight: 800, color: 'var(--ak-text-muted)', textDecoration: 'none' }}>
            <Icon name="ti-download" size={12}/> {downloadName || 'Save a copy'}
          </a>
        )}
      </div>
    </div>
  );
}
