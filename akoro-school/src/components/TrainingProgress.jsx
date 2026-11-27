import { useState, useEffect, useRef } from 'react';
import { pollTrainingRun } from '../services/trainingApi.js';
import { GREEN, RED, PURPLE } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

/* Maps backend pipeline phases → human labels. */
const PHASE_LABELS = {
  init:          'Starting training run…',
  store:         'Uploading to secure storage…',
  transcribe:    'Transcribing with Whisper…',
  extract:       'Extracting your teaching style…',
  segment:       'Capturing high-value segments…',
  embed:         'Embedding knowledge into memory…',
  profile:       'Updating teacher profile…',
  orchestration: 'Building your unique agent…',
  calibrate:     'Calculating XP…',
};

const TAG_COLOR = { ok: GREEN, info: 'rgba(255,255,255,.6)', warn: '#F0A04B', err: RED, xp: C.brand, sys: PURPLE };

/**
 * Real training progress, driven by polling the backend run.
 * Props: runId, agentName, onComplete(summary), onError(err)
 */
export default function TrainingProgress({ runId, agentName = 'Your Agent', onComplete, onError }) {
  const [pct, setPct]       = useState(2);
  const [phase, setPhase]   = useState('init');
  const [logs, setLogs]     = useState([]);
  const [insights, setIns]  = useState([]);
  const [failed, setFailed] = useState(false);
  const logBoxRef = useRef(null);

  useEffect(() => {
    if (!runId) return;
    const stop = pollTrainingRun(runId, {
      onProgress: ({ phase: ph, pct: p }) => {
        if (ph) setPhase(ph);
        if (typeof p === 'number') setPct((prev) => Math.max(prev, p));
      },
      onLog:     (l) => setLogs((prev) => [...prev, l].slice(-40)),
      onInsight: (i) => setIns((prev) => [...prev, i]),
      onComplete: (summary) => { setPct(100); onComplete?.(summary); },
      onError:    (err) => { setFailed(true); onError?.(err); },
    });
    return stop;
  }, [runId]); // eslint-disable-line

  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logs]);

  const totalXP = insights.reduce((s, i) => s + (i.xp || 0), 0);
  const label = failed ? 'Training failed' : (PHASE_LABELS[phase] || 'Working…');
  const iconTi = failed ? 'ti-alert-triangle' : (pct >= 100 ? 'ti-circle-check' : (phase === 'orchestration' ? 'ti-sparkles' : 'ti-brain'));

  return (
    <div style={{
      background: C.hero, borderRadius: 20, padding: 24,
      display: 'flex', flexDirection: 'column', gap: 18,
      color: '#fff', fontFamily: C.font,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: failed ? `linear-gradient(135deg, ${RED}, #B91C1C)` : `linear-gradient(135deg, ${C.brand}, ${PURPLE})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          animation: (pct < 100 && !failed) ? 'pulse-dot 1.5s infinite' : 'none',
          boxShadow: `0 0 32px ${tint(27)}`,
        }}>
          <Ico ti={iconTi} size={26} color="#fff" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{agentName}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }}>{label}</div>
        </div>
        {totalXP > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 700, color: C.brand }}>
            <Ico ti="ti-bolt" size={14} />+{totalXP} XP
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div>
        <div style={{ height: 6, background: 'rgba(255,255,255,.1)', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
          <div style={{
            height: '100%', borderRadius: 3, width: `${pct}%`,
            background: failed ? RED : `linear-gradient(90deg, ${C.brand}, ${PURPLE})`,
            transition: 'width .4s ease',
          }} />
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: 'rgba(255,255,255,.5)' }}>{Math.round(pct)}%</div>
      </div>

      {/* Live log feed */}
      {logs.length > 0 && (
        <div ref={logBoxRef} style={{
          maxHeight: 150, overflowY: 'auto', background: 'rgba(0,0,0,.25)',
          borderRadius: 12, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4,
          fontSize: 11.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}>
          {logs.map((l) => (
            <div key={l.id} style={{ display: 'flex', gap: 8, lineHeight: 1.4 }}>
              <span style={{ color: TAG_COLOR[l.tag] || 'rgba(255,255,255,.5)', fontWeight: 700, flexShrink: 0 }}>
                {l.tag}
              </span>
              <span style={{ color: 'rgba(255,255,255,.85)' }}>
                {l.message}{l.value ? <span style={{ color: 'rgba(255,255,255,.5)' }}> — {l.value}</span> : null}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Insight chips */}
      {insights.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {insights.slice(-6).map((i) => (
            <span key={i.id} style={{
              fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
              background: tint(18), border: `1px solid ${tint(33)}`, color: C.brand,
            }}>
              {(i.concept || i.type)}{i.xp ? ` +${i.xp}` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
