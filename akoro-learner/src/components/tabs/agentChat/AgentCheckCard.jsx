/**
 * AgentCheckCard — an Agent Check's own card in the chat (2026-10-20), under
 * its run's message: its title, ONE tracking line ("Running in Battles · 3 of
 * 5 answered", then "2 of 5 · below the pass mark") and, while it runs, the
 * link to the battle in Battles (the usual battle modal). Everything else —
 * each question, the agent's report — is the run itself, in the chat.
 */
import { RED, GREEN } from '../../../constants.js';
import { Icon } from '../../common/Icons.jsx';
import { agentCheckCard } from '../../../lib/agentChatTrace.js';

const BADGE = {
  running: { label: 'Live', bg: '#FEE2E2', fg: '#B91C1C' },
  marked: { label: 'Marked', bg: 'var(--ak-surface-hover)', fg: 'var(--ak-text-muted)' },
  passed: { label: 'Passed', bg: `${GREEN}18`, fg: GREEN },
  stopped: { label: 'Stopped', bg: 'var(--ak-surface-hover)', fg: 'var(--ak-text-muted)' },
};

export default function AgentCheckCard({ check, events, onWatch }) {
  if (!check?.battleId) return null;
  const card = agentCheckCard(check, events);
  const badge = BADGE[card.state] || BADGE.running;
  return (
    <div data-agent-check={card.state} style={{ border: '1px solid #FECACA', borderRadius: 14, padding: 11, background: 'var(--ak-surface)', display: 'grid', gap: 9, width: 'min(560px, 100%)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="ti-swords" size={18} color={RED}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--ak-text)' }}>{check.title || `Agent Check: ${check.topic || ''}`}</div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>Study Prep · your guide asks, your agent answers</div>
        </div>
        <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 99, background: badge.bg, color: badge.fg, whiteSpace: 'nowrap' }}>{badge.label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, background: '#FFF5F5', border: '1px solid #FECACA', fontSize: 12, fontWeight: 800, color: '#B91C1C' }}>
        <Icon name="ti-chart-dots" size={15} color="#B91C1C"/>
        <span style={{ flex: 1 }}>{card.line}</span>
        {card.state === 'running' && (
          <button type="button" onClick={() => onWatch?.(check.battleId)} style={{ border: 0, background: 'transparent', color: '#B91C1C', fontWeight: 850, fontSize: 11.5, textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>Watch in Battles</button>
        )}
      </div>
    </div>
  );
}
