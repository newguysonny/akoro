/*
 * StreamCards — the shared pieces every workflow card draws from (Grand Plan
 * Phase 11, §13.2; preview approved 2026-11-07). One look for the same thing
 * wherever it shows: the Study Prep card, the Agent Check card, the chat trace,
 * Home and Tasks → Needs you.
 *
 *   WorkflowStateBadge  the server descriptor's badge { tone, label }
 *   ScoreRing           a result as a ring: "3/5" or a percentage
 *   RejectedRow         the red verification row (what the harness refused, and why)
 *   DevLine             developer mode: one quiet line of raw facts
 *
 * Approvals use ApprovalButtons (Allow / Reject / Later) — never a card's own.
 */
import { Icon } from '../../../components/common/Icons.jsx';

const NUNITO = "'Nunito',sans-serif";
export const BADGE_TONES = Object.freeze({
  your_turn: { color: '#6C3BFF', icon: 'ti-hand-finger' },
  working: { color: '#0EA5E9', icon: 'ti-loader-2' },
  paused: { color: '#B45309', icon: 'ti-player-pause' },
  failed: { color: '#EF4444', icon: 'ti-alert-triangle' },
  done: { color: '#10B981', icon: 'ti-circle-check' },
});

export function WorkflowStateBadge({ badge, style = null }) {
  if (!badge?.label) return null;
  const tone = BADGE_TONES[badge.tone] || BADGE_TONES.working;
  return (
    <span data-workflow-badge={badge.tone || ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 20, padding: '1px 8px', fontSize: 10.5, fontWeight: 800, background: `${tone.color}14`, color: tone.color, fontFamily: NUNITO, whiteSpace: 'nowrap', ...style }}>
      <Icon name={tone.icon} size={11} color={tone.color} />{badge.label}
    </span>
  );
}

/** score 0–1; with correct/total the ring reads "3/5". */
export function ScoreRing({ score = 0, correct = null, total = null, passed = false, size = 58 }) {
  const s = Math.max(0, Math.min(1, Number(score) || 0));
  const color = passed ? '#10B981' : s >= 0.5 ? '#F59E0B' : '#EF4444';
  const r = (size - 8) / 2, c = 2 * Math.PI * r;
  const label = total ? `${correct ?? Math.round(s * total)}/${total}` : `${Math.round(s * 100)}%`;
  return (
    <span data-score-ring="" style={{ position: 'relative', width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width={size} height={size} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ak-border2)" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${c * s} ${c}`} />
      </svg>
      <span style={{ fontSize: size > 50 ? 15 : 12, fontWeight: 900, color: 'var(--ak-text)', fontFamily: NUNITO }}>{label}</span>
    </span>
  );
}

export function RejectedRow({ headline, reason = null, tag = null }) {
  return (
    <div data-rejected-row="" role="note" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 10, background: '#EF44440F', borderLeft: '3px solid #EF4444', fontFamily: NUNITO, fontSize: 12.5, lineHeight: 1.45, color: 'var(--ak-text)' }}>
      <Icon name="ti-shield-x" size={14} color="#EF4444" style={{ marginTop: 2, flexShrink: 0 }} />
      <span><b>{headline}</b>{reason ? ` ${reason}` : ''}{tag && <span style={{ color: 'var(--ak-text-muted)', fontSize: 11 }}> · {tag}</span>}</span>
    </div>
  );
}

export function DevLine({ parts = [] }) {
  const shown = parts.filter((p) => p != null && p !== '');
  if (!shown.length) return null;
  return (
    <div data-dev-line="" style={{ fontSize: 11, color: 'var(--ak-text-muted)', fontFamily: "ui-monospace,Menlo,monospace", padding: '6px 9px', border: '1px dashed var(--ak-border2)', borderRadius: 8, overflowWrap: 'anywhere' }}>
      {shown.join(' · ')}
    </div>
  );
}
