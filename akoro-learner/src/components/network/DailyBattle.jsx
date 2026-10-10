/*
 * DailyBattle — the recurring daily battle in the Battles tab.
 *
 *   DailyBattleCard   one occurrence: Scheduled (today 7 PM / tomorrow),
 *                     Active (play until midnight), Completed (score) or Missed
 *   DailyPlay         the sheet that plays it: five shared questions, one go,
 *                     then the score (the day's ranking lives in Rankings)
 */
import { useEffect, useRef, useState } from 'react';
import Spinner from '../common/Spinner.jsx';
import { Icon } from '../common/Icons.jsx';
import { BRAND, GREEN, RED, GOLD } from '../../constants.js';
import { fetchDaily, submitDaily } from '../../services/agentNetworkApi.js';

const NUNITO = "'Nunito',sans-serif";
const time = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' });
const dayLabel = (iso) => {
  const d = new Date(iso), today = new Date();
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};

const LOOK = {
  scheduled: { label: 'SCHEDULED', color: BRAND, bg: 'rgba(108,59,255,.10)', border: 'rgba(108,59,255,.25)' },
  active: { label: '● LIVE', color: RED, bg: 'rgba(239,68,68,.12)', border: 'rgba(239,68,68,.30)' },
  completed: { label: 'COMPLETED', color: GREEN, bg: 'rgba(16,185,129,.10)', border: 'rgba(16,185,129,.25)' },
  missed: { label: 'MISSED', color: 'var(--ak-text-muted)', bg: 'var(--ak-surface-hover)', border: 'var(--ak-border)' },
};

/** occ: { state, subject, startsAt, endsAt, result? } */
export function DailyBattleCard({ occ, onPlay }) {
  const look = LOOK[occ.state] || LOOK.scheduled;
  return (
    <div style={{ borderRadius: 18, border: `1.5px solid ${look.border}`, background: 'var(--ak-surface)', overflow: 'hidden', fontFamily: NUNITO }}>
      <div style={{ padding: '13px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 40, height: 40, borderRadius: 12, background: `${BRAND}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="ti-calendar-repeat" size={20} color={BRAND} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 2px' }}>Daily battle · {occ.subject}</p>
            <p style={{ fontSize: 11, color: 'var(--ak-text-muted)', margin: 0, fontWeight: 600 }}>Every day · 5 questions · same set for everyone</p>
          </div>
          <span style={{ background: look.bg, border: `1px solid ${look.border}`, borderRadius: 8, padding: '3px 9px', fontSize: 9.5, fontWeight: 900, color: look.color, letterSpacing: 0.3, flexShrink: 0 }}>{look.label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap', fontSize: 11.5, fontWeight: 700 }}>
          {occ.state === 'scheduled' && <span style={{ color: BRAND, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="ti-calendar" size={12} color={BRAND} />{dayLabel(occ.startsAt)} {time(occ.startsAt)}</span>}
          {occ.state === 'active' && <span style={{ color: RED, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="ti-hourglass" size={12} color={RED} />Open until {time(occ.endsAt)}</span>}
          {(occ.state === 'completed' || occ.state === 'missed') && <span style={{ color: 'var(--ak-text-muted)' }}>{dayLabel(occ.startsAt)}</span>}
          {occ.result && <span style={{ color: GREEN, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="ti-trophy" size={12} color={GREEN} />{occ.result.correct}/{occ.result.total}{occ.result.seconds != null ? ` · ${occ.result.seconds}s` : ''}</span>}
          {occ.state === 'missed' && <span style={{ color: 'var(--ak-text-muted)' }}>Not played</span>}
          <span style={{ color: GOLD, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="ti-bolt" size={12} color={GOLD} />Up to 70 XP</span>
        </div>
        {occ.state === 'active' && (
          <button type="button" onClick={onPlay}
            style={{ width: '100%', marginTop: 12, padding: 10, borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${RED}, #DC2626)`, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: NUNITO, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name="ti-player-play" size={14} color="#fff" /> Play today's battle
          </button>
        )}
      </div>
    </div>
  );
}

export function DailyPlay({ onClose, onDone }) {
  const [set, setSet] = useState(null);
  const [err, setErr] = useState('');
  const [picks, setPicks] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(Date.now());
  useEffect(() => {
    fetchDaily().then((d) => { setSet(d); started.current = Date.now(); }).catch((e) => setErr(e?.message || "Could not open today's battle."));
  }, []);
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const answers = set.questions.map((q) => (picks[q.n] != null ? q.options[picks[q.n]]?.label : ''));
      setResult(await submitDaily({ subject: set.subject, answers, time_ms: Date.now() - started.current }));
      onDone?.();
    } catch (e) { setErr(e?.message || 'Could not submit.'); }
    finally { setBusy(false); }
  };
  const done = result || set?.attempted;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(10,10,25,.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Daily battle"
        style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', background: 'var(--ak-surface)', borderRadius: '22px 22px 0 0', padding: '12px 18px calc(env(safe-area-inset-bottom, 0px) + 18px)', fontFamily: NUNITO }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Icon name="ti-calendar-repeat" size={18} color={BRAND} />
          <div style={{ flex: 1, fontSize: 15, fontWeight: 900, color: 'var(--ak-text)' }}>Daily battle{set ? ` · ${set.subject}` : ''}</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ak-text-muted)' }}><Icon name="ti-x" size={18} /></button>
        </div>
        {!set && !err && <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner size={20} /></div>}
        {err && <div style={{ fontSize: 12.5, fontWeight: 700, color: RED, margin: '8px 0' }}>{err}</div>}
        {set && !done && (
          <>
            {set.questions.map((q) => (
              <div key={q.n} style={{ marginTop: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ak-text)', lineHeight: 1.45 }}>{q.n}. {q.stem} {q.source && <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ak-text-muted)' }}>({q.source})</span>}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
                  {q.options.map((o, oi) => {
                    const on = picks[q.n] === oi;
                    return (
                      <button key={oi} type="button" onClick={() => setPicks((p) => ({ ...p, [q.n]: oi }))}
                        style={{ display: 'flex', gap: 8, alignItems: 'flex-start', textAlign: 'left', padding: '9px 11px', borderRadius: 10, border: `1.5px solid ${on ? BRAND : 'var(--ak-border)'}`, background: on ? `${BRAND}10` : 'var(--ak-surface)', color: 'var(--ak-text)', fontSize: 13, fontWeight: on ? 800 : 600, cursor: 'pointer', fontFamily: NUNITO }}>
                        <b style={{ color: BRAND }}>{o.label}.</b> {o.text}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <button type="button" onClick={submit} disabled={busy || Object.keys(picks).length < set.questions.length}
              style={{ width: '100%', marginTop: 16, padding: 12, borderRadius: 20, border: 'none', background: Object.keys(picks).length < set.questions.length ? 'var(--ak-border)' : `linear-gradient(135deg, ${BRAND}, #4C1DCC)`, color: '#fff', fontSize: 13, fontWeight: 900, cursor: 'pointer', fontFamily: NUNITO }}>
              {busy ? 'Marking…' : `Submit (${Object.keys(picks).length}/${set.questions.length})`}
            </button>
          </>
        )}
        {done && (
          <div style={{ textAlign: 'center', padding: '14px 0 6px' }}>
            <div style={{ fontSize: 30, fontWeight: 900, color: GREEN }}>{(result || set.result).correct}/{(result || set.result).total}</div>
            {result?.xp ? <div style={{ fontSize: 13, fontWeight: 800, color: GOLD }}>+{result.xp} XP</div> : null}
            {result?.rank && <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', marginTop: 4 }}>You're #{result.rank.rank} of {result.rank.of} today</div>}
            {result?.review && (
              <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, marginTop: 10, textAlign: 'left' }}>
                {result.review.map((r) => <div key={r.n} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 700, color: r.right ? GREEN : RED }}>{r.n}. <Icon name={r.right ? 'ti-check' : 'ti-x'} size={13} color={r.right ? GREEN : RED} />{r.right ? 'Right' : `You ${r.yourAnswer}, answer ${r.answer}`}</div>)}
              </div>
            )}
            <p style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '12px 0 0' }}>See today's ranking in Rankings → Daily. The next battle is tomorrow.</p>
          </div>
        )}
      </div>
    </div>
  );
}
