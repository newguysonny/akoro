import { useState, useEffect } from 'react';
import { Brain, Zap, CheckCircle, Clock } from 'lucide-react';
import { AMBER, INK, MUTED, BORDER, LIGHT, WHITE, GREEN, PURPLE, FONT } from '../constants.js';

const STAGES = [
  { icon: Brain, label: 'Analyzing your teaching style…', detail: 'Processing uploaded materials and conversation patterns' },
  { icon: Zap,   label: 'Building knowledge graph…',      detail: 'Extracting key concepts and learning objectives' },
  { icon: Brain, label: 'Calibrating response model…',    detail: 'Tuning tone, depth, and explanation style' },
  { icon: CheckCircle, label: 'Training complete!',       detail: 'Your AI teaching assistant is ready' },
];

export default function TrainingSimulation({ onComplete, agentName = 'Your AI Agent' }) {
  const [stage,    setStage]    = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => {
      setProgress(p => {
        const next = p + (Math.random() * 3 + 1);
        if (next >= 100) {
          clearInterval(tick);
          setTimeout(() => onComplete?.(), 800);
          return 100;
        }
        return next;
      });
    }, 80);
    return () => clearInterval(tick);
  }, [onComplete]);

  useEffect(() => {
    const stageProgress = [0, 30, 60, 90];
    const s = stageProgress.findLastIndex?.(sp => progress >= sp) ?? 0;
    setStage(Math.min(s, STAGES.length - 1));
  }, [progress]);

  const current = STAGES[stage];
  const Icon = current.icon;

  return (
    <div style={{
      background: INK, borderRadius: 20, padding: 32,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24,
      color: WHITE, fontFamily: FONT, textAlign: 'center',
    }}>
      {/* Animated icon */}
      <div style={{
        width: 80, height: 80, borderRadius: '50%',
        background: `linear-gradient(135deg, ${AMBER}, ${PURPLE})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: progress < 100 ? 'pulse-dot 1.5s infinite' : 'none',
        boxShadow: `0 0 40px ${AMBER}44`,
      }}>
        <Icon size={36} color={WHITE} />
      </div>

      {/* Agent name */}
      <div>
        <h3 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>{agentName}</h3>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', margin: 0 }}>AI Training in Progress</p>
      </div>

      {/* Progress bar */}
      <div style={{ width: '100%' }}>
        <div style={{
          height: 6, background: 'rgba(255,255,255,.1)', borderRadius: 3,
          overflow: 'hidden', marginBottom: 8,
        }}>
          <div style={{
            height: '100%', borderRadius: 3,
            background: `linear-gradient(90deg, ${AMBER}, ${PURPLE})`,
            width: `${progress}%`, transition: 'width .1s linear',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,.5)' }}>
          <span>{current.label}</span>
          <span>{Math.round(progress)}%</span>
        </div>
      </div>

      {/* Stage detail */}
      <p style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', margin: 0, maxWidth: 300 }}>
        {current.detail}
      </p>

      {/* Stages */}
      <div style={{ display: 'flex', gap: 8 }}>
        {STAGES.map((s, i) => (
          <div key={i} style={{
            width: 8, height: 8, borderRadius: '50%',
            background: i <= stage ? AMBER : 'rgba(255,255,255,.2)',
            transition: 'background .3s',
          }} />
        ))}
      </div>
    </div>
  );
}
