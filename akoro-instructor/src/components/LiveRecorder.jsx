import { useState, useRef, useEffect } from 'react';
import { GREEN, RED } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

/* Pick a MediaRecorder mime the backend's /upload filter accepts. */
function pickMime() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/**
 * Records audio from the device microphone and hands back a File.
 * Props: onRecorded(file | null) — called with the recorded File on stop,
 *        or null when the recording is cleared.
 */
export default function LiveRecorder({ onRecorded }) {
  const [state, setState]   = useState('idle'); // idle | recording | ready | error
  const [seconds, setSec]   = useState(0);
  const [error, setError]   = useState('');
  const [fileName, setName] = useState('');

  const mediaRef  = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef  = useRef(null);

  useEffect(() => () => cleanup(), []); // stop tracks on unmount

  const cleanup = () => {
    clearInterval(timerRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const start = async () => {
    setError('');
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState('error'); setError('Recording is not supported in this browser.'); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMime();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const type = rec.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        const ext  = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        const name = `live-recording-${Date.now()}.${ext}`;
        const file = new File([blob], name, { type });
        setName(name);
        setState('ready');
        onRecorded?.(file);
        cleanup();
      };
      rec.start(1000); // gather data in 1s slices
      mediaRef.current = rec;
      setSec(0);
      setState('recording');
      timerRef.current = setInterval(() => setSec((s) => s + 1), 1000);
    } catch (e) {
      setState('error');
      setError(e.name === 'NotAllowedError' ? 'Microphone permission denied.' : (e.message || 'Could not start recording.'));
    }
  };

  const stop = () => {
    clearInterval(timerRef.current);
    if (mediaRef.current && mediaRef.current.state !== 'inactive') mediaRef.current.stop();
  };

  const reset = () => {
    setState('idle'); setSec(0); setName(''); setError('');
    chunksRef.current = [];
    onRecorded?.(null);
  };

  const box = {
    border: `2px dashed ${state === 'recording' ? RED : state === 'ready' ? GREEN : 'rgba(232,136,74,.4)'}`,
    borderRadius: 14, padding: '22px 20px', textAlign: 'center',
    background: state === 'recording' ? 'rgba(220,38,38,.05)' : state === 'ready' ? 'rgba(16,185,129,.06)' : 'rgba(232,136,74,.04)',
    marginBottom: 14, fontFamily: C.font,
  };

  if (state === 'error') {
    return (
      <div style={box}>
        <Ico ti="ti-alert-triangle" size={22} color={RED} style={{ marginBottom: 6 }} />
        <div style={{ fontWeight: 700, color: C.ink, marginBottom: 4 }}>Can’t record</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>{error}</div>
        <button onClick={() => setState('idle')} style={btn(C.surface, C.ink)}>Try again</button>
      </div>
    );
  }

  if (state === 'ready') {
    return (
      <div style={box}>
        <Ico ti="ti-circle-check" size={22} color={GREEN} style={{ marginBottom: 6 }} />
        <div style={{ fontWeight: 700, color: C.ink, marginBottom: 2 }}>Recording captured · {fmt(seconds)}</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>{fileName}</div>
        <button onClick={reset} style={btn(C.surface, C.ink)}>Record again</button>
      </div>
    );
  }

  if (state === 'recording') {
    return (
      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: RED, animation: 'pulse-dot 1.2s infinite' }} />
          <span style={{ fontWeight: 800, color: C.ink, fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{fmt(seconds)}</span>
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>Recording… speak naturally as you teach.</div>
        <button onClick={stop} style={btn(RED, '#fff')}><Ico ti="ti-player-stop" size={13} fill="#fff" /> Stop recording</button>
      </div>
    );
  }

  return (
    <div style={box}>
      <Ico ti="ti-microphone" size={24} color={C.brand} style={{ marginBottom: 6 }} />
      <div style={{ fontWeight: 700, color: C.ink, marginBottom: 4 }}>Record live from your device</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>Capture a lesson now — it trains your agent on stop.</div>
      <button onClick={start} style={btn(C.brand, '#fff')}><Ico ti="ti-microphone" size={13} /> Start recording</button>
    </div>
  );
}

function btn(bg, color) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '9px 16px', borderRadius: 10, border: bg === C.surface ? `1.5px solid ${C.border}` : 'none',
    background: bg, color, fontFamily: C.font, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  };
}
