/**
 * PlannerNotes — "How I'm planning": the Study Prep planning run as short,
 * plain steps (plannerNotes() in lib/agentChatTrace.js). Open while the plan
 * is made; folded to "How I planned it · N steps" once it's ready (a tap
 * opens it again). The agent's messages are rendered after it, as usual.
 * On for everyone; the developer view shows the raw notes instead.
 */
import { useEffect, useState } from 'react';
import { BRAND, GREEN, RED } from '../../../constants.js';
import { Icon } from '../../common/Icons.jsx';
import { plannerNotes } from '../../../lib/agentChatTrace.js';
import TraceBlocks from './TraceBlocks.jsx';

export default function PlannerNotes({ blocks }) {
  const { steps, said, running } = plannerNotes(blocks);
  const [open, setOpen] = useState(running);
  // It folds itself when the plan is ready; the learner can open it again.
  useEffect(() => { setOpen(running); }, [running]);
  if (!steps.length) return <TraceBlocks blocks={said}/>;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div data-planner-notes={running ? 'running' : 'done'} style={{ border: '1px solid var(--ak-border2)', borderRadius: 12, overflow: 'hidden', background: 'var(--ak-surface)' }}>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '8px 10px', border: 0, background: 'var(--ak-surface-hover)', cursor: 'pointer', fontSize: 12, fontWeight: 900, color: 'var(--ak-text-sub)', fontFamily: "'Nunito',sans-serif", textAlign: 'left' }}>
          <Icon name="ti-list-details" size={14} color="var(--ak-text-sub)"/>
          <span style={{ flex: 1 }}>{running ? "How I'm planning" : `How I planned it · ${steps.length} step${steps.length === 1 ? '' : 's'}`}</span>
          <Icon name={open ? 'ti-chevron-up' : 'ti-chevron-down'} size={14} color="var(--ak-text-muted)"/>
        </button>
        {open && steps.map((step) => (
          <div key={step.id} style={{ display: 'flex', gap: 8, padding: '7px 10px', borderTop: '1px solid var(--ak-border)', fontSize: 12, fontWeight: 700, color: 'var(--ak-text-sub)', lineHeight: 1.4 }}>
            {step.running
              ? <span aria-hidden style={{ width: 12, height: 12, marginTop: 2, borderRadius: '50%', border: `1.6px solid ${BRAND}40`, borderTopColor: BRAND, display: 'inline-block', animation: 'ak-trace-spin .8s linear infinite', flexShrink: 0 }}/>
              : <Icon name={step.ok ? 'ti-circle-check' : 'ti-alert-circle'} size={14} color={step.ok ? GREEN : RED} style={{ marginTop: 1, flexShrink: 0 }}/>}
            <div style={{ minWidth: 0 }}>
              <div>{step.headline}</div>
              {(step.reason || step.result) && <div style={{ fontSize: 11, color: 'var(--ak-text-muted)', fontWeight: 650 }}>{step.result || step.reason}</div>}
            </div>
          </div>
        ))}
        <style>{'@keyframes ak-trace-spin{to{transform:rotate(360deg)}}'}</style>
      </div>
      <TraceBlocks blocks={said}/>
    </div>
  );
}
