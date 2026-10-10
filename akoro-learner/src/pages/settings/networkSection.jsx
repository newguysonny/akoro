/*
 * AgentNetworkSection — Settings → Agent: who can find and message this
 * learner's agent, whether it takes challenges and when, blocked agents,
 * and past-question practice so far.
 */
import { useEffect, useState } from 'react';
import { Section, Row, Toggle, Icon, BRAND, ALL_SUBJECTS } from './shared.jsx';
import {
  fetchNetworkSettings, saveNetworkSettings, fetchBlocked, unblockAgent, fetchPastQuestionSummary,
} from '../../services/agentNetworkApi.js';

const WHO = [
  ['everyone', 'Everyone'], ['school', 'My school'], ['classmates', 'Classmates & coursemates'], ['hidden', 'Nobody (hidden)'],
];
const MSG = [['everyone', 'Everyone'], ['school', 'My school'], ['classmates', 'Classmates & coursemates'], ['nobody', 'Nobody']];
const TIMES = [['morning', 'Mornings'], ['afternoon', 'Afternoons'], ['evening', 'Evenings'], ['night', 'Nights'], ['weekend', 'Weekends']];
const TYPES = [['1v1', '1v1'], ['open', 'Open lobby'], ['team', 'Team (2v2)'], ['review', 'Study review']];
const NUNITO = "'Nunito',sans-serif";

function Choice({ options, value, onPick }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '4px 14px 12px' }}>
      {options.map(([k, label]) => {
        const on = Array.isArray(value) ? value.includes(k) : value === k;
        return (
          <button key={k} type="button" onClick={() => onPick(k)} aria-pressed={on}
            style={{ padding: '6px 11px', borderRadius: 999, border: `1.5px solid ${on ? BRAND : 'var(--ak-border)'}`, background: on ? `${BRAND}14` : 'var(--ak-surface)', color: on ? BRAND : 'var(--ak-text)', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: NUNITO }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

const Label = ({ children }) => (
  <div style={{ padding: '10px 14px 2px', fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', fontFamily: NUNITO }}>{children}</div>
);

export default function AgentNetworkSection() {
  const [s, setS] = useState(null);
  const [blocked, setBlocked] = useState([]);
  const [pq, setPq] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetchNetworkSettings().then(setS).catch(() => setErr('Could not load your agent network settings.'));
    fetchBlocked().then(setBlocked).catch(() => {});
    fetchPastQuestionSummary().then(setPq).catch(() => {});
  }, []);

  const save = async (patch) => {
    const before = s;
    setS((x) => ({ ...x, ...patch })); setErr('');
    try { setS(await saveNetworkSettings(patch)); }
    catch (e) { setS(before); setErr(e?.message || 'Could not save that.'); }
  };
  const toggleIn = (key, k) => save({ [key]: (s?.[key] || []).includes(k) ? s[key].filter((x) => x !== k) : [...(s?.[key] || []), k] });

  if (!s) return err ? <Section title="Agent network"><div style={{ padding: 14, fontSize: 12.5, color: 'var(--ak-text-muted)' }}>{err}</div></Section> : null;

  return (
    <>
      <Section title="Agent network">
        <Label>Who can find my agent</Label>
        <Choice options={WHO} value={s.visibility} onPick={(v) => save({ visibility: v })} />
        <Label>Who can message my agent</Label>
        <Choice options={MSG} value={s.accept_messages} onPick={(v) => save({ accept_messages: v })} />
        <Row icon="ti-swords" label="Open to battle challenges" noArrow>
          <Toggle on={s.open_to_challenges !== false} onChange={() => save({ open_to_challenges: s.open_to_challenges === false })} />
        </Row>
        <Row icon="ti-trophy" label="Show me on leaderboards" noArrow>
          <Toggle on={s.show_on_leaderboards !== false} onChange={() => save({ show_on_leaderboards: s.show_on_leaderboards === false })} />
        </Row>
        <Label>When I like to battle</Label>
        <Choice options={TIMES} value={s.battle_times || []} onPick={(k) => toggleIn('battle_times', k)} />
        <Label>Battles I like</Label>
        <Choice options={TYPES} value={s.battle_types || []} onPick={(k) => toggleIn('battle_types', k)} />
        <Label>Daily battle subject</Label>
        <div style={{ padding: '4px 14px 12px' }}>
          <select value={s.daily_subject || ''} onChange={(e) => save({ daily_subject: e.target.value || null })} aria-label="Daily battle subject"
            style={{ width: '100%', padding: '9px 11px', borderRadius: 12, border: '1.5px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text)', fontSize: 13, fontWeight: 700, fontFamily: NUNITO }}>
            <option value="">My first subject</option>
            {ALL_SUBJECTS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ak-text-muted)', marginTop: 5 }}>A battle every evening at 7 PM — your agent plays it from your notes, against everyone in that subject. Applies from the next one you're seated in.</div>
        </div>
        {err && <div style={{ padding: '0 14px 12px', fontSize: 12, fontWeight: 700, color: '#DC2626' }}>{err}</div>}
      </Section>

      {blocked.length > 0 && (
        <Section title="Blocked agents">
          {blocked.map((id) => (
            <Row key={id} icon="ti-ban" label="Blocked learner" sub={`${id.slice(0, 8)}…`} noArrow>
              <button type="button" onClick={() => unblockAgent(id).then(() => setBlocked((b) => b.filter((x) => x !== id))).catch(() => {})}
                style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text)', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: NUNITO }}>
                Unblock
              </button>
            </Row>
          ))}
        </Section>
      )}

      <Section title="Past questions practised">
        {pq.length ? pq.map((r) => (
          <Row key={`${r.exam}|${r.subject}`} icon="ti-file-certificate" label={`${r.exam}${r.subject ? ` · ${r.subject}` : ''}`}
            sub={`${r.attempted} questions · ${r.accuracy}% correct${r.years?.length ? ` · ${r.years.join(', ')}` : ''}`} noArrow />
        )) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', fontSize: 12.5, color: 'var(--ak-text-muted)', fontFamily: NUNITO }}>
            <Icon name="ti-info-circle" size={15} /> Past-question battles and practice with your agent show up here.
          </div>
        )}
      </Section>
    </>
  );
}
