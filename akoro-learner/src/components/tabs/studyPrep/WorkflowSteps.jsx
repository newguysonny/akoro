/**
 * WorkflowSteps — the workflow card's head and step list (Phase 3, the
 * approved preview): a title with a state badge, then each step of the
 * workflow — ✓ with its time, a spinner on the one running, ✕ if it failed —
 * and the AI-drafted tag on a drafted outline. Only the workflow's own state:
 * the chat's thinking and tool rows stay outside the card.
 */
import { BRAND, GREEN, RED } from '../../../constants.js';
import { Icon } from '../../common/Icons.jsx';
import { durationLabel } from '../../../lib/agentChatTrace.js';

const BADGE = {
  live: { background: `${BRAND}14`, color: BRAND, icon: 'ti-point-filled' },
  wait: { background: '#FFF7ED', color: '#D97706', icon: 'ti-hand-finger' },
  done: { background: 'var(--ak-surface-hover)', color: 'var(--ak-text-muted)', icon: 'ti-check' },
};

export function WorkflowHead({ head, subject }) {
  const b = BADGE[head.tone] || BADGE.done;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <Icon name="ti-route" size={15} color={BRAND}/>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{head.title}</div>
        {subject && <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>Study Prep · {subject}</div>}
      </div>
      <span data-workflow-badge={head.badge} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 99, background: b.background, color: b.color, whiteSpace: 'nowrap' }}>
        <Icon name={b.icon} size={11} color={b.color}/>{head.badge}
      </span>
    </div>
  );
}

export function WorkflowSteps({ steps, limit = 0 }) {
  if (!steps?.length) return null;
  const shown = limit ? steps.slice(-limit) : steps;
  return (
    <div data-workflow-steps="" style={{ border: '1px solid var(--ak-border2)', borderRadius: 12, overflow: 'hidden', background: 'var(--ak-surface)' }}>
      {limit && steps.length > limit ? <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)', padding: '5px 11px', borderBottom: '1px solid var(--ak-border)' }}>{steps.length - limit} earlier step{steps.length - limit === 1 ? '' : 's'}</div> : null}
      {shown.map((s, i) => (
        <div key={s.id} data-workflow-step={s.status} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 11px', borderTop: i || (limit && steps.length > limit) ? '1px solid var(--ak-border)' : 0 }}>
          {s.status === 'running'
            ? <span className="ak-wf-spin" style={{ display: 'inline-flex', marginTop: 1 }}><Icon name="ti-loader-2" size={15} color={BRAND}/></span>
            : <Icon name={s.status === 'failed' ? 'ti-circle-x' : 'ti-circle-check'} size={15} color={s.status === 'failed' ? RED : GREEN} style={{ marginTop: 1 }}/>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)' }}>{s.headline}</div>
            {(s.description || s.status === 'failed' && s.result) && <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ak-text-muted)', lineHeight: 1.45 }}>{s.status === 'failed' && s.result ? s.result : s.description}</div>}
            {s.status === 'done' && s.result && s.result !== 'Done' && <div data-workflow-found="" style={{ fontSize: 11.5, fontWeight: 750, color: 'var(--ak-text-sub)', lineHeight: 1.45, display: 'flex', gap: 4 }}><Icon name="ti-arrow-right" size={12} color="var(--ak-text-muted)" style={{ marginTop: 2 }}/>{s.result}</div>}
            {s.why && <div data-workflow-why="" style={{ fontSize: 11, fontWeight: 600, fontStyle: 'italic', color: 'var(--ak-text-muted)', lineHeight: 1.45 }}>Why: {s.why}</div>}
            {s.tag && <span style={{ display: 'inline-block', marginTop: 4, fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 7, background: '#FEF3C7', color: '#92400E' }}>{s.tag}</span>}
          </div>
          {s.status !== 'running' && s.ms != null && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)', whiteSpace: 'nowrap' }}>{durationLabel(s.ms)}</span>}
        </div>
      ))}
      <style>{'@keyframes ak-wf-spin{to{transform:rotate(360deg)}}.ak-wf-spin{animation:ak-wf-spin 1.1s linear infinite}'}</style>
    </div>
  );
}
