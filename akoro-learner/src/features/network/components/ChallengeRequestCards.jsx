/*
 * ChallengeRequestCards — open challenge requests ("JAMB Chemistry 1v1,
 * tonight at 8") with Accept; the learner's own with Cancel. Used under an
 * Agent Chat reply and in the Battles tab's "Open" view.
 */
import { splitAgent } from './AgentCards.jsx';
import { useState } from 'react';
import { Icon } from '../../../components/common/Icons.jsx';
import { BRAND } from '../../../constants.js';
import { acceptChallengeRequest, cancelChallengeRequest } from '../../../services/agentNetworkApi.js';

const NUNITO = "'Nunito',sans-serif";
const when = (iso) => {
  const d = new Date(iso || '');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};
const KIND = { '1v1': '1v1', team: '2v2 team', group: 'Group' };

export default function ChallengeRequestCards({ requests = [], mine = false, joined = false, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState({});
  if (!requests.length) return null;
  const act = async (r) => {
    setBusy(r.id);
    try {
      const out = mine ? await cancelChallengeRequest(r.id) : await acceptChallengeRequest(r.id);
      setMsg((m) => ({ ...m, [r.id]: mine ? 'Cancelled' : out?.full ? 'Battle on! Check your Battles tab.' : `You're in — ${out?.seats || ''} seats` }));
      onChanged?.();
    } catch (e) {
      setMsg((m) => ({ ...m, [r.id]: e?.message || 'Could not do that.' }));
    } finally { setBusy(null); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
      {requests.map((r) => (
        <div key={r.id} style={{ padding: '10px 12px', borderRadius: 14, background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', fontFamily: NUNITO }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 32, height: 32, borderRadius: 10, background: `${BRAND}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="ti-swords" size={16} color={BRAND} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>
                {KIND[r.kind || (r.battle_type === 'open' ? 'group' : r.battle_type)] || '1v1'} · {r.subject}{r.exam ? ` · ${r.exam}` : ''} · {r.questions ?? r.total_questions} questions · −{r.hpPerMiss ?? r.hp_per_miss ?? 10} HP/miss
                {r.seats ? ` · ${r.seats} seats` : (joined || mine) && r.max_players ? ` · ${1 + (r.accepted_by || []).length}/${r.max_players} seats` : ''}
              </div>
            </div>
            {joined && <span style={{ fontSize: 11, fontWeight: 800, color: BRAND, flexShrink: 0 }}>You're in</span>}
            {!joined && !msg[r.id] && (mine ? r.status === 'open' : true) && (
              <button type="button" disabled={busy === r.id} onClick={() => act(r)}
                style={{ padding: '6px 12px', borderRadius: 999, border: mine ? '1px solid var(--ak-border)' : 'none', background: mine ? 'var(--ak-surface)' : BRAND, color: mine ? 'var(--ak-text)' : '#fff', fontSize: 12, fontWeight: 900, cursor: 'pointer', fontFamily: NUNITO, flexShrink: 0 }}>
                {busy === r.id ? '…' : mine ? 'Cancel' : 'Accept'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)' }}>
            {r.by && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{r.by.online && <span title="Online" style={{ width: 8, height: 8, borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />}{r.by.name} {r.by.username} · {splitAgent(r.by.agent).name || 'Agent'} · Lv {r.by.level}</span>}
            {(r.scheduledFor || r.scheduled_for) && <span style={{ color: BRAND }}><Icon name="ti-calendar" size={11} /> {when(r.scheduledFor || r.scheduled_for)}</span>}
            {mine && <span>{r.status}</span>}
          </div>
          {r.note && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ak-text)', marginTop: 5 }}>“{r.note}”</div>}
          {msg[r.id] && <div style={{ fontSize: 12, fontWeight: 800, color: BRAND, marginTop: 6 }}>{msg[r.id]}</div>}
        </div>
      ))}
    </div>
  );
}
