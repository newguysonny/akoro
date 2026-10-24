/*
 * ChallengesList — the Challenges tab: ONE list, one compact card for every
 * challenge (invitations, open seats, seats you took, your own posts,
 * reviews, recurring series). Format, Scope and Timing are fields on the card,
 * not sections; filter chips narrow the same list. Tapping a card opens the
 * challenge sheet (bottom sheet on phones/tablets, dialog on desktop):
 * invitations and reviews the existing ChallengeModal (via onOpenInvite), the
 * agent network's challenge requests the RequestSheet below, a recurring
 * series the SeriesSheet (skip the next one, opt out; the creator ends it).
 * reference/Akoro Battles — Model.md.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../common/Icons.jsx';
import Spinner from '../common/Spinner.jsx';
import SheetFrame from './SheetFrame.jsx';
import { BRAND, RED } from '../../constants.js';
import { FILTERS, filterItems, mergeItems } from './challengeItems.js';
import { acceptChallengeRequest, cancelChallengeRequest, fetchChallengeRequests } from '../../services/agentNetworkApi.js';
import { apiPost } from '../../services/api.js';

const NUNITO = "'Nunito',sans-serif";
const FORMAT_ICON = { '1v1': 'ti-swords', Group: 'ti-users-group', 'Team 2v2': 'ti-users', 'Open lobby': 'ti-door-enter', Daily: 'ti-calendar-event', Review: 'ti-clipboard-check' };
const STATUS_COLOR = { invite: RED, review: BRAND, joined: BRAND, open: '#EC4899', mine: 'var(--ak-text-sub)' };
const SCOPE_STYLE = {
  course: { icon: 'ti-book', color: '#3B82F6' },
  class: { icon: 'ti-school', color: '#10B981' },
  network: { icon: 'ti-world', color: '#EC4899' },
};
const TIMING_STYLE = {
  now: { icon: 'ti-bolt', color: RED, bg: 'rgba(239,68,68,.10)' },
  scheduled: { icon: 'ti-calendar', color: 'var(--ak-text-sub)', bg: 'var(--ak-tag-bg)' },
  repeat: { icon: 'ti-repeat', color: '#D97706', bg: 'rgba(245,158,11,.12)' },
};
const AVATAR_BG = { guide: BRAND, teacher: '#10B981', player: '#F59E0B' };

const chip = (bg, color) => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 7, fontSize: 10.5, fontWeight: 800, background: bg, color, whiteSpace: 'nowrap' });

function Fields({ item }) {
  const sc = SCOPE_STYLE[item.scope.kind] || SCOPE_STYLE.network;
  const tm = TIMING_STYLE[item.timing.kind] || TIMING_STYLE.scheduled;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      <span style={chip(`${BRAND}14`, BRAND)}><span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '.05em', opacity: .75 }}>FORMAT</span>{item.format}</span>
      <span style={chip(`${sc.color}14`, sc.color)}><Icon name={sc.icon} size={12} color={sc.color} />{item.scope.label}</span>
      <span style={chip(tm.bg, tm.color)}><Icon name={tm.icon} size={12} color={tm.color} />{item.timing.label}</span>
    </div>
  );
}

function Avatar({ from, size = 20 }) {
  if (from.avatar) return <img src={from.avatar} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  return <span style={{ width: size, height: size, borderRadius: '50%', background: AVATAR_BG[from.host] || '#F59E0B', color: '#fff', fontSize: size * .5, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{from.initial}</span>;
}

export function ChallengeCard({ item, onOpen }) {
  const icon = item.recurring ? 'ti-repeat' : FORMAT_ICON[item.format] || 'ti-swords';
  const tint = STATUS_COLOR[item.status] || BRAND;
  return (
    <button type="button" onClick={() => onOpen(item)} style={{ textAlign: 'left', width: '100%', border: '1px solid var(--ak-border2)', borderRadius: 16, padding: '12px 13px', background: 'var(--ak-surface)', cursor: 'pointer', fontFamily: NUNITO, display: 'block' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ width: 38, height: 38, borderRadius: 12, background: `${item.recurring ? '#D97706' : BRAND}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name={icon} size={19} color={item.recurring ? '#D97706' : BRAND} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--ak-text)', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: tint, marginTop: 2 }}>{item.statusLine}</div>
          <div style={{ marginTop: 9 }}><Fields item={item} /></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', minWidth: 0 }}>
            <Avatar from={item.from} />
            {item.from.online && <span title="Online" style={{ width: 7, height: 7, borderRadius: '50%', background: '#10B981', flexShrink: 0 }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{[item.from.name, item.from.sub].filter(Boolean).join(' · ')}</span>
            <Icon name="ti-chevron-right" size={17} color="var(--ak-text-muted)" />
          </div>
        </div>
      </div>
    </button>
  );
}

/** The sheet for an agent-network challenge request (open seat, seat you took, your own post). */
function RequestSheet({ item, onClose, onChanged }) {
  const r = item.raw;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const act = async () => {
    setBusy(true);
    try {
      const out = item.status === 'mine' ? await cancelChallengeRequest(r.id) : await acceptChallengeRequest(r.id);
      setMsg(item.status === 'mine' ? 'Cancelled.' : out?.full ? 'Battle on! It is in your Battles tab.' : `You're in · ${out?.seats || ''} seats`);
      onChanged?.();
    } catch (e) {
      setMsg(e?.message || 'Could not do that.');
    } finally { setBusy(false); }
  };
  const hp = r.hpPerMiss ?? r.hp_per_miss ?? 10;
  const tiles = [
    { label: 'Questions', value: r.questions ?? r.total_questions ?? '—' },
    { label: 'Seats', value: item.seats || (item.format === '1v1' ? '2' : '—') },
    { label: 'HP per miss', value: hp > 0 ? `−${hp}` : 'None' },
  ];
  return (
    <SheetFrame onClose={onClose} label={item.title}>
      <div style={{ padding: '16px 20px 0' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: 12, background: 'rgba(236,72,153,.08)', marginBottom: 14 }}>
          <Icon name="ti-world" size={20} color="#EC4899" />
          <div>
            <div style={{ fontSize: 11, fontWeight: 900, color: '#EC4899', letterSpacing: '.04em', textTransform: 'uppercase' }}>{item.status === 'mine' ? 'Your post' : item.status === 'joined' ? "You're in" : 'Open'} · {item.format} · Network</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ak-text-sub)' }}>{item.status === 'joined' ? 'It starts once the seats fill (or at its time).' : item.status === 'mine' ? 'Anyone on Akoro can take a seat.' : 'Take a seat; it starts once the seats fill (or at its time).'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Avatar from={item.from} size={40} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)' }}>{item.from.name}{item.from.online && <span style={{ fontSize: 11, fontWeight: 700, color: '#10B981' }}> · online</span>}</div>
            {item.from.sub && <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>{item.from.sub}</div>}
          </div>
        </div>
        <div style={{ fontSize: 17, fontWeight: 900, color: 'var(--ak-text)', margin: '2px 0 4px' }}>{item.title}</div>
        {r.note && <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ak-text-sub)', lineHeight: 1.55, marginBottom: 10 }}>“{r.note}”</div>}
        <Fields item={item} />
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-sub)', marginTop: 8 }}>{[r.subject, r.exam].filter(Boolean).join(' · ')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, margin: '12px 0' }}>
          {tiles.map((t) => (
            <div key={t.label} style={{ background: 'var(--ak-bg)', border: '1px solid var(--ak-border)', borderRadius: 12, padding: 9, textAlign: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ak-text-muted)' }}>{t.label}</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--ak-text)' }}>{t.value}</div>
            </div>
          ))}
        </div>
        {hp > 0 && (
          <div style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(239,68,68,.06)', fontSize: 12, fontWeight: 700, color: 'var(--ak-text-sub)', lineHeight: 1.5, marginBottom: 10 }}>
            <b style={{ color: 'var(--ak-text)' }}>−{hp} HP per miss.</b> Your agent starts on 100 HP; after {Math.ceil(100 / hp)} misses it's out and watches the rest, unranked.
          </div>
        )}
        {msg && <div style={{ fontSize: 12.5, fontWeight: 800, color: BRAND, margin: '4px 0 8px' }}>{msg}</div>}
        {item.status !== 'joined' && !msg && (
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: 13, borderRadius: 14, border: '1.5px solid var(--ak-border2)', background: 'var(--ak-bg)', fontSize: 14, fontWeight: 800, color: 'var(--ak-text-sub)', cursor: 'pointer', fontFamily: NUNITO }}>Close</button>
            <button type="button" disabled={busy} onClick={act} style={{ flex: 1.8, padding: 13, borderRadius: 14, border: item.status === 'mine' ? `1.5px solid ${RED}55` : 'none', background: item.status === 'mine' ? 'var(--ak-surface)' : BRAND, color: item.status === 'mine' ? RED : '#fff', fontSize: 14, fontWeight: 900, cursor: 'pointer', fontFamily: NUNITO, opacity: busy ? .6 : 1 }}>
              {busy ? '…' : item.status === 'mine' ? 'Cancel my post' : 'Take a seat'}
            </button>
          </div>
        )}
      </div>
    </SheetFrame>
  );
}

const DAY_LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/** The sheet for a recurring series: its rule, the next one, and Skip / Opt out (or End, for its creator). */
function SeriesSheet({ item, onClose, onChanged }) {
  const c = item.raw;
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const act = async (kind) => {
    setBusy(kind);
    try {
      await apiPost(`/api/battle/series/${c.seriesId}/${kind}`, {});
      setMsg(kind === 'skip' ? "You'll sit the next one out. You're still in the rest."
        : kind === 'opt-out' ? "You've left the series. You won't be put in any more of them."
        : 'Series ended. No more of them will be set.');
      onChanged?.();
    } catch (e) {
      setMsg(e?.message || 'Could not do that.');
    } finally { setBusy(null); setConfirm(null); }
  };
  const days = (c.series?.days || []).slice().sort((a, b) => a - b).map((d) => DAY_LONG[d]);
  const until = c.series?.until ? new Date(c.series.until).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '';
  const tiles = [
    { label: 'Questions', value: c.totalQuestions ?? '—' },
    { label: 'Length', value: c.durationMin ? `${c.durationMin} min` : '—' },
    { label: 'In it', value: c.players ?? '—' },
  ];
  const btn = (primary, danger) => ({ flex: 1, padding: 13, borderRadius: 14, border: primary ? 'none' : `1.5px solid ${danger ? `${RED}55` : 'var(--ak-border2)'}`, background: primary ? BRAND : 'var(--ak-surface)', color: primary ? '#fff' : danger ? RED : 'var(--ak-text-sub)', fontSize: 14, fontWeight: 900, cursor: 'pointer', fontFamily: NUNITO });
  return (
    <SheetFrame onClose={onClose} label={item.title}>
      <div style={{ padding: '16px 20px 0' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: 12, background: 'rgba(245,158,11,.10)', marginBottom: 14 }}>
          <Icon name="ti-repeat" size={20} color="#D97706" />
          <div>
            <div style={{ fontSize: 11, fontWeight: 900, color: '#D97706', letterSpacing: '.04em', textTransform: 'uppercase' }}>Recurring · {item.format} · {item.scope.label}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ak-text-sub)' }}>{c.mine ? 'Everyone you invited is in every one, unless they opt out.' : "You're in every one automatically. No need to accept each time."}</div>
          </div>
        </div>
        <div style={{ fontSize: 17, fontWeight: 900, color: 'var(--ak-text)', margin: '2px 0 6px' }}>{item.title}</div>
        <Fields item={item} />
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-sub)', marginTop: 8 }}>{[c.subject, c.topic].filter(Boolean).join(' · ')}</div>
        <div style={{ margin: '12px 0', padding: '11px 12px', borderRadius: 12, background: 'var(--ak-bg)', border: '1px solid var(--ak-border)', fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-sub)', lineHeight: 1.6 }}>
          <div><b style={{ color: 'var(--ak-text)' }}>Repeats</b> {days.join(', ')} at {c.series?.time}{c.series?.tz ? ` (${c.series.tz.split('/').pop().replace(/_/g, ' ')} time)` : ''}</div>
          {until && <div><b style={{ color: 'var(--ak-text)' }}>Ends</b> {until}</div>}
          {item.next && <div><b style={{ color: 'var(--ak-text)' }}>Next</b> {item.next}{c.skippingNext ? ' · you are sitting this one out' : ''}</div>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
          {tiles.map((t) => (
            <div key={t.label} style={{ background: 'var(--ak-bg)', border: '1px solid var(--ak-border)', borderRadius: 12, padding: 9, textAlign: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ak-text-muted)' }}>{t.label}</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--ak-text)' }}>{t.value}</div>
            </div>
          ))}
        </div>
        {c.lastNote && <div style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(239,68,68,.06)', fontSize: 12, fontWeight: 700, color: 'var(--ak-text-sub)', lineHeight: 1.5, marginBottom: 10 }}>{c.lastNote}</div>}
        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ak-text-muted)', lineHeight: 1.5, marginBottom: 10 }}>Each one appears in your Battles tab an hour before it starts. Entry (coins for your agent's answers) is checked each time.</div>
        {msg && <div style={{ fontSize: 12.5, fontWeight: 800, color: BRAND, margin: '4px 0 8px' }}>{msg}</div>}
        {!msg && (c.mine ? (
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button type="button" onClick={onClose} style={btn(false)}>Close</button>
            {confirm === 'end'
              ? <button type="button" disabled={!!busy} onClick={() => act('end')} style={{ ...btn(true), background: RED, flex: 1.6 }}>{busy ? '…' : 'Yes, end it'}</button>
              : <button type="button" onClick={() => setConfirm('end')} style={{ ...btn(false, true), flex: 1.6 }}>End series</button>}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button type="button" disabled={!!busy || c.skippingNext || !c.nextAt} onClick={() => act('skip')} style={{ ...btn(false), opacity: c.skippingNext ? .5 : 1 }}>{busy === 'skip' ? '…' : 'Skip next one'}</button>
            {confirm === 'opt-out'
              ? <button type="button" disabled={!!busy} onClick={() => act('opt-out')} style={{ ...btn(true), background: RED }}>{busy ? '…' : 'Yes, opt out'}</button>
              : <button type="button" onClick={() => setConfirm('opt-out')} style={btn(false, true)}>Opt out of series</button>}
          </div>
        ))}
      </div>
    </SheetFrame>
  );
}

export default function ChallengesList({ invites = [], onOpenInvite, onCount, onBattleCreated, onSeriesChanged }) {
  const [req, setReq] = useState(null);
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null);
  const load = useCallback(() => {
    Promise.all([
      fetchChallengeRequests().catch(() => null),
      fetchChallengeRequests({ mine: 'true' }).catch(() => null),
      fetchChallengeRequests({ joined: 'true' }).catch(() => null),
    ]).then(([o, m, j]) => {
      const openList = o?.requests || [];
      onCount?.(openList.length);
      setReq({
        open: openList,
        mine: (m?.requests || []).filter((r) => r.status === 'open'),
        joined: (j?.requests || []).filter((r) => r.status === 'open'),
      });
    });
  }, [onCount]);
  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => mergeItems({ invites, ...(req || {}) }), [invites, req]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, filterItems(items, f.key).length])), [items]);
  const shown = filterItems(items, filter);
  const openItem = (item) => (item.source === 'invite' ? onOpenInvite?.(item.raw) : setOpen(item));

  return (
    <div style={{ background: 'var(--ak-surface)', minHeight: '100%', fontFamily: NUNITO }}>
      <div style={{ display: 'flex', gap: 7, padding: '12px 16px 10px', overflowX: 'auto', scrollbarWidth: 'none', borderBottom: '1px solid var(--ak-border)' }}>
        {FILTERS.filter((f) => f.key === 'all' || counts[f.key] > 0 || f.key === filter).map((f) => {
          const on = filter === f.key;
          return (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)} style={{ flexShrink: 0, padding: '5px 12px', borderRadius: 20, border: `1.5px solid ${on ? BRAND : 'var(--ak-border2)'}`, background: on ? `${BRAND}0F` : 'var(--ak-surface)', color: on ? BRAND : 'var(--ak-text-sub)', fontSize: 11.5, fontWeight: on ? 800 : 700, cursor: 'pointer', fontFamily: NUNITO, display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
              {f.label}
              <span style={{ fontSize: 10, fontWeight: 900, borderRadius: 8, padding: '0 6px', background: on ? BRAND : 'var(--ak-tag-bg)', color: on ? '#fff' : 'var(--ak-text-sub)' }}>{counts[f.key]}</span>
            </button>
          );
        })}
      </div>
      {req === null && !invites.length ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><Spinner size={20} /></div>
      ) : shown.length === 0 ? (
        <div style={{ padding: '44px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
          <Icon name="ti-swords" size={46} color="var(--ak-text-muted)" style={{ opacity: .25 }} />
          <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--ak-text-muted)', margin: 0 }}>{filter === 'all' ? 'No challenges right now' : 'Nothing here'}</p>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ak-text-muted)', margin: 0 }}>Ask your agent: “Post a 1v1 Maths challenge for tonight at 8.”</p>
        </div>
      ) : (
        <div style={{ padding: '10px 14px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map((it) => <ChallengeCard key={it.key} item={it} onOpen={openItem} />)}
        </div>
      )}
      {open && open.source === 'series' && <SeriesSheet item={open} onClose={() => setOpen(null)} onChanged={() => onSeriesChanged?.()} />}
      {open && open.source === 'request' && <RequestSheet item={open} onClose={() => setOpen(null)} onChanged={() => { load(); onBattleCreated?.(); }} />}
    </div>
  );
}
