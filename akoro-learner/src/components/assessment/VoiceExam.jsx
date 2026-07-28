/**
 * VoiceExam — the exam phase as a voice-agent experience.
 * A small proctor ring avatar (top-left) whose border reflects face presence +
 * the server proctor result; a large central agent orb that reacts to
 * speaking/listening; the current question spoken aloud and captioned; answers
 * by voice, with a tucked-away text fallback.
 */
import { useState } from 'react';
import { BRAND, RED, GREEN } from '../../constants.js';
import { XIcon } from '../common/Icons.jsx';

const AMBER = '#F59E0B';

// Ring colour from BOTH signals: local face-presence (instant) + server proctor.
function ringState(status, signals, proctor) {
  if (status !== 'running') return { c: AMBER, blink: false, label: 'Starting camera…' };
  if ((signals.faceCount || 0) === 0) return { c: RED, blink: true, label: 'No face detected' };
  if ((signals.faceCount || 0) > 1)   return { c: RED, blink: false, label: 'Multiple faces' };
  const lvl = proctor?.level;
  if (lvl === 'high' || lvl === 'critical') return { c: RED, blink: false, label: 'Flagged' };
  if (lvl === 'elevated' || lvl === 'warn' || lvl === 'medium') return { c: AMBER, blink: false, label: 'Verifying…' };
  return { c: GREEN, blink: false, label: 'Verified' };
}

export default function VoiceExam({
  videoRef, canvasRef, status, signals, proctor, frameW, frameH,
  blocks, progress, listening, interim, speaking, loading, disabled,
  onToggleListening, input, onInputChange, onSend, agentEmoji = '🎓',
}) {
  const [showType, setShowType] = useState(false);
  const ring = ringState(status, signals, proctor);

  // Latest thing the assessor said (question / feedback / hint).
  const lastAgent = [...blocks].reverse().find(b => b && b.text && ['question', 'sergeant', 'hint'].includes(b.type));
  const caption = lastAgent?.text || (loading ? 'Thinking…' : 'Get ready for your first question…');

  const orbScale = speaking ? 1.08 : listening ? 1.04 : 1;
  const orbGlow  = speaking ? BRAND : listening ? GREEN : 'rgba(124,59,255,.5)';

  return (
    <div style={{ position: 'relative', height: '100%', minHeight: 480, display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @keyframes ve-ring-blink { 0%,100%{opacity:1} 50%{opacity:.25} }
        @keyframes ve-orb-pulse  { 0%,100%{transform:scale(1)} 50%{transform:scale(1.14)} }
        @keyframes ve-wave       { 0%{transform:scaleY(.4)} 50%{transform:scaleY(1)} 100%{transform:scaleY(.4)} }
      `}</style>

      {/* Top row: proctor ring avatar + progress */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div title={ring.label} style={{ position: 'relative', width: 64, height: 64, borderRadius: '50%', padding: 3,
          background: ring.c, animation: ring.blink ? 've-ring-blink 1s ease-in-out infinite' : 'none',
          boxShadow: `0 0 14px ${ring.c}66`, flexShrink: 0 }}>
          <video ref={videoRef} muted playsInline
            style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', background: '#000', transform: 'scaleX(-1)' }} />
          <canvas ref={canvasRef} width={frameW} height={frameH} style={{ display: 'none' }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: ring.c }}>{ring.label}</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#94A3B8', marginTop: 2 }}>
            Question {Math.min((progress?.index || 0) + 1, progress?.total || 0)} of {progress?.total || 0}
          </div>
        </div>
      </div>

      {/* Center: agent orb + caption */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, padding: '18px 10px' }}>
        <div style={{ position: 'relative', width: 168, height: 168, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* Halo rings when active */}
          {(speaking || listening) && (
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `2px solid ${orbGlow}`, animation: 've-orb-pulse 1.6s ease-in-out infinite', opacity: .5 }} />
          )}
          <div style={{ width: 132, height: 132, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 54, background: `radial-gradient(circle at 50% 35%, ${BRAND}, #2A0E66)`,
            boxShadow: `0 0 46px ${orbGlow}`, transform: `scale(${orbScale})`, transition: 'transform .18s ease' }}>
            {agentEmoji}
          </div>
        </div>

        <div style={{ maxWidth: 460, textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: speaking ? BRAND : listening ? GREEN : '#64748B', marginBottom: 8 }}>
            {speaking ? 'Assessor speaking' : listening ? 'Listening…' : loading ? 'Thinking…' : 'Tap the mic to answer'}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#E2E8F0', lineHeight: 1.5 }}>{caption}</div>
          {listening && interim && (
            <div style={{ marginTop: 12, fontSize: 14, fontWeight: 700, color: GREEN, fontStyle: 'italic' }}>“{interim}”</div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingBottom: 6 }}>
        <button onClick={onToggleListening} disabled={disabled}
          style={{ width: 76, height: 76, borderRadius: '50%', border: 'none', cursor: disabled ? 'default' : 'pointer',
            background: listening ? GREEN : 'rgba(124,59,255,.16)', border: `2px solid ${listening ? GREEN : BRAND}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: listening ? `0 0 26px ${GREEN}88` : 'none', transition: 'all .18s' }}>
          {listening ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 26 }}>
              {[0, 1, 2, 3].map(i => <span key={i} style={{ width: 4, height: 22, borderRadius: 3, background: '#fff', animation: `ve-wave 1s ease-in-out ${i * 0.12}s infinite` }} />)}
            </div>
          ) : (
            <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          )}
        </button>
        <div style={{ fontSize: 12, color: '#64748B', fontWeight: 700 }}>{listening ? 'Tap to send your answer' : 'Hold a quiet space · stay in frame'}</div>

        <button onClick={() => setShowType(s => !s)} style={{ background: 'none', border: 'none', color: '#64748B', fontSize: 12, fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}>
          {showType ? 'Hide typing' : 'Type instead'}
        </button>
        {showType && (
          <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 460 }}>
            <input value={input} onChange={(e) => onInputChange(e.target.value)} disabled={disabled} placeholder="Type your answer…"
              onKeyDown={(e) => { if (e.key === 'Enter') onSend(); }}
              style={{ flex: 1, padding: '11px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,.14)', background: 'rgba(255,255,255,.04)', color: '#E2E8F0', fontSize: 14, outline: 'none', fontFamily: 'inherit' }} />
            <button onClick={onSend} disabled={disabled || !input.trim()} style={{ padding: '0 18px', borderRadius: 12, border: 'none', background: BRAND, color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>Send</button>
          </div>
        )}
      </div>
    </div>
  );
}
