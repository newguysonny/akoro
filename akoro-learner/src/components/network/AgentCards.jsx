/*
 * AgentCards — the agents an agent search found, shown under the reply:
 * presence, the learner's first name and @username, their agent, level and
 * XP, and what they share with this learner. Challenge / Ask fill the chat
 * box (the learner finishes the sentence and sends — the agent does the rest).
 */
import { Icon } from '../common/Icons.jsx';
import { BRAND } from '../../constants.js';

const NUNITO = "'Nunito',sans-serif";
const DOT = { online: '#10B981', today: '#F59E0B', this_week: '#9CA3AF', away: '#D1D5DB' };
const SEEN = { online: 'Online', today: 'Seen today', this_week: 'This week', away: 'Away' };

export default function AgentCards({ agents = [], onFill }) {
  if (!agents.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
      {agents.map((a) => (
        <div key={a.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14, background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', fontFamily: NUNITO }}>
          <div style={{ position: 'relative', width: 38, height: 38, borderRadius: 12, background: `${BRAND}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, flexShrink: 0 }}>
            {String(a.agent || '🤖').split(' ')[0]}
            <span title={SEEN[a.presence] || ''} style={{ position: 'absolute', right: -2, bottom: -2, width: 11, height: 11, borderRadius: '50%', background: DOT[a.presence] || DOT.away, border: '2px solid var(--ak-surface)' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.name} <span style={{ fontWeight: 700, color: 'var(--ak-text-muted)', fontSize: 12 }}>{a.username}</span>
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {String(a.agent || '').split(' ').slice(1).join(' ')} · Lv {a.level} · {Number(a.xp || 0).toLocaleString()} XP{a.rank ? ` · #${a.rank}` : ''}
              {a.presence === 'online' && !a.available ? ' · in a battle' : ''}
            </div>
            {(a.shared?.length > 0 || a.matches?.taught?.length > 0 || a.matches?.complements?.length > 0) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {[...(a.shared || []), ...(a.matches?.complements || []).map((x) => `Strong in ${x}`), ...(a.matches?.taught || []).map((x) => `Taught ${x}`)].slice(0, 3).map((t) => (
                  <span key={t} style={{ fontSize: 10, fontWeight: 800, color: BRAND, background: `${BRAND}10`, borderRadius: 999, padding: '2px 7px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>{t}</span>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
            {a.openToChallenges !== false && (
              <button type="button" onClick={() => onFill?.(`Challenge ${a.name} (${a.username}) to a 1v1 battle on `)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 999, border: 'none', background: BRAND, color: '#fff', fontSize: 11.5, fontWeight: 900, cursor: 'pointer', fontFamily: NUNITO }}>
                <Icon name="ti-swords" size={12} /> Challenge
              </button>
            )}
            <button type="button" onClick={() => onFill?.(`Ask ${a.name}'s agent (${a.username}) `)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 999, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text)', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: NUNITO }}>
              <Icon name="ti-message-circle" size={12} /> Ask
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
