/*
 * DailyChallenge — the Battles tab's "Daily" view: today's five shared
 * questions (one go a day), the day's ranking, and this week's league.
 */
import { useEffect, useRef, useState } from 'react';
import Spinner from '../common/Spinner.jsx';
import { Icon } from '../common/Icons.jsx';
import { BRAND, GREEN, RED, GOLD } from '../../constants.js';
import { fetchDaily, submitDaily, fetchDailyRanking, fetchWeeklyLeague } from '../../services/agentNetworkApi.js';

const NUNITO = "'Nunito',sans-serif";
const card = { background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 16, padding: '12px 14px' };

function Ranking({ rows = [], unit = 'correct' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
      {rows.map((r) => (
        <div key={`${r.rank}-${r.name}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: r.you ? 900 : 700, color: r.you ? BRAND : 'var(--ak-text)' }}>
          <span style={{ width: 22, textAlign: 'right', color: r.rank <= 3 ? GOLD : 'var(--ak-text-muted)' }}>{r.rank}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}{r.agent ? ` · ${r.agent}` : ''}{r.you ? ' (you)' : ''}</span>
          <span>{unit === 'xp' ? `${r.xp} XP` : `${r.correct}/${r.total}${r.seconds != null ? ` · ${r.seconds}s` : ''}`}</span>
        </div>
      ))}
    </div>
  );
}

export default function DailyChallenge() {
  const [set, setSet] = useState(null);
  const [err, setErr] = useState('');
  const [picks, setPicks] = useState({});
  const [result, setResult] = useState(null);
  const [ranking, setRanking] = useState(null);
  const [league, setLeague] = useState(null);
  const [scope, setScope] = useState('classmates');
  const [busy, setBusy] = useState(false);
  const started = useRef(Date.now());

  useEffect(() => {
    fetchDaily().then((d) => { setSet(d); started.current = Date.now(); if (d?.attempted) fetchDailyRanking(d.subject).then(setRanking).catch(() => {}); })
      .catch((e) => setErr(e?.message || 'Could not load today\'s challenge.'));
  }, []);
  useEffect(() => { fetchWeeklyLeague(scope).then(setLeague).catch(() => setLeague(null)); }, [scope]);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const answers = set.questions.map((q) => (picks[q.n] != null ? q.options[picks[q.n]]?.label : ''));
      const r = await submitDaily({ subject: set.subject, answers, time_ms: Date.now() - started.current });
      setResult(r);
      fetchDailyRanking(set.subject).then(setRanking).catch(() => {});
    } catch (e) { setErr(e?.message || 'Could not submit.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: '12px 16px 24px', display: 'flex', flexDirection: 'column', gap: 12, fontFamily: NUNITO }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="ti-calendar-bolt" size={18} color={BRAND} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)' }}>Daily challenge{set ? ` · ${set.subject}` : ''}</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>Five questions, one go a day — everyone gets the same set.</div>
          </div>
        </div>
        {!set && !err && <div style={{ display: 'flex', justifyContent: 'center', padding: 18 }}><Spinner size={18} /></div>}
        {err && <div style={{ fontSize: 12.5, fontWeight: 700, color: RED, marginTop: 8 }}>{err}</div>}
        {set && !set.attempted && !result && (
          <>
            {set.questions.map((q) => (
              <div key={q.n} style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', lineHeight: 1.45 }}>{q.n}. {q.stem} {q.source && <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ak-text-muted)' }}>({q.source})</span>}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
                  {q.options.map((o, oi) => {
                    const on = picks[q.n] === oi;
                    return (
                      <button key={oi} type="button" onClick={() => setPicks((p) => ({ ...p, [q.n]: oi }))}
                        style={{ display: 'flex', gap: 8, alignItems: 'flex-start', textAlign: 'left', padding: '8px 10px', borderRadius: 10, border: `1.5px solid ${on ? BRAND : 'var(--ak-border)'}`, background: on ? `${BRAND}10` : 'var(--ak-surface)', color: 'var(--ak-text)', fontSize: 13, fontWeight: on ? 800 : 600, cursor: 'pointer', fontFamily: NUNITO }}>
                        <b style={{ color: BRAND }}>{o.label}.</b> {o.text}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <button type="button" onClick={submit} disabled={busy || Object.keys(picks).length < set.questions.length}
              style={{ width: '100%', marginTop: 14, padding: 11, borderRadius: 20, border: 'none', background: Object.keys(picks).length < set.questions.length ? 'var(--ak-border)' : `linear-gradient(135deg, ${BRAND}, #4C1DCC)`, color: '#fff', fontSize: 13, fontWeight: 900, cursor: 'pointer', fontFamily: NUNITO }}>
              {busy ? 'Marking…' : `Submit (${Object.keys(picks).length}/${set.questions.length})`}
            </button>
          </>
        )}
        {(result || set?.attempted) && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: GREEN }}>{(result || set.result).correct}/{(result || set.result).total}</div>
            {result?.xp ? <div style={{ fontSize: 12, fontWeight: 800, color: GOLD }}>+{result.xp} XP</div> : null}
            {result?.review && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
                {result.review.map((r) => <div key={r.n} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: r.right ? GREEN : RED }}>{r.n}. <Icon name={r.right ? 'ti-check' : 'ti-x'} size={13} color={r.right ? GREEN : RED} />{r.right ? 'Right' : `You ${r.yourAnswer}, answer ${r.answer}`}</div>)}
              </div>
            )}
            {!result && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)' }}>Done for today — come back tomorrow.</div>}
          </div>
        )}
      </div>

      {ranking?.top?.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--ak-text)' }}>Today's ranking · {ranking.players} played{ranking.me ? ` · you're #${ranking.me.rank}` : ''}</div>
          <Ranking rows={ranking.top} />
        </div>
      )}

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--ak-text)', flex: 1 }}>This week's league</div>
          {[['classmates', 'Classmates'], ['school', 'School'], ['everyone', 'Everyone']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setScope(k)} aria-pressed={scope === k}
              style={{ padding: '4px 10px', borderRadius: 999, border: `1.5px solid ${scope === k ? BRAND : 'var(--ak-border)'}`, background: scope === k ? `${BRAND}12` : 'var(--ak-surface)', color: scope === k ? BRAND : 'var(--ak-text-muted)', fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: NUNITO }}>{l}</button>
          ))}
        </div>
        {league ? (
          <>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)', marginTop: 4 }}>{league.me?.rank ? `You're #${league.me.rank} with ${league.me.xp} XP this week` : 'Earn XP this week to join the league.'}</div>
            <Ranking rows={league.top || []} unit="xp" />
          </>
        ) : <div style={{ fontSize: 12, color: 'var(--ak-text-muted)', marginTop: 6 }}>No league for that yet.</div>}
      </div>
    </div>
  );
}
