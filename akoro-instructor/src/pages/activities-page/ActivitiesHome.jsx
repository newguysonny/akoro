/**
 * The Activities list: metrics, a stage filter (all / live / scheduled /
 * lobby / completed), a type filter, and one card per activity — battles
 * included. Creating an activity happens in the agent chat, not here.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageLayout, useIsMobile } from '../../components/Layout.jsx';
import { Btn, Badge, Toast } from '../../components/Primitives.jsx';
import { apiGet, apiDelete } from '../../services/api.js';
import { useBattlesAPI } from '../../hooks/useBattlesAPI.js';
import { useCoursesAPI } from '../../hooks/useCoursesAPI.js';
import { useInstructorSocket } from '../../hooks/useWebSocket.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { BattleModal, ParticipantsModal, MarkSheetModal } from '../../components/battles/BattleManage.jsx';
import WatchBattleModal from '../../components/WatchBattleModal.jsx';
import QuestionBankModal from '../../components/QuestionBankModal.jsx';
import { confirmDialog } from '../../components/ConfirmHost.jsx';
import { WORKBENCH_TYPES, byKey } from '../../components/activities/ActivityForm.jsx';
import { toItems, countStages } from '../../lib/activityStates.js';
import DraftsStrip from './DraftsStrip.jsx';
import { GREEN, PURPLE, BLUE, RED } from '../../constants.js';
import { C } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

const STAGE_TABS = [
  { key: 'all', label: 'All' }, { key: 'live', label: 'Live' }, { key: 'scheduled', label: 'Scheduled' },
  { key: 'lobby', label: 'Lobby' }, { key: 'completed', label: 'Completed' },
];
const STAGE_LOOK = {
  live:      { bg: '#DCFCE7', color: GREEN,     label: 'Live' },
  scheduled: { bg: '#FEF3C7', color: '#D97706', label: 'Scheduled' },
  lobby:     { bg: '#DBEAFE', color: BLUE,      label: 'Lobby' },
  completed: { bg: '#EDE9FE', color: PURPLE,    label: 'Completed' },
};
const CHAT_STARTS = [
  { label: 'Prepare an assignment', fill: 'Prepare an assignment on  for my class' },
  { label: 'Set a battle', fill: 'Set a battle on  for my class' },
  { label: 'Schedule a live course', fill: 'Schedule a live course on  for ' },
  { label: 'Start a self study', fill: 'Set a self study on  for my class' },
];

const RANGES = [
  { key: 'any', label: 'Any date' }, { key: 'today', label: 'Today' }, { key: 'week', label: 'Last 7 days' },
  { key: 'month', label: 'Last 30 days' }, { key: 'custom', label: 'Custom range' },
];
/* [from, to) in ms for a range preset; null = no limit. Compared with the date the activity was set (created). */
function rangeBounds(range, from, to, now = new Date()) {
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const day = 86400000;
  if (range === 'today') return [startOfDay(now), startOfDay(now) + day];
  if (range === 'week') return [startOfDay(now) - 6 * day, startOfDay(now) + day];
  if (range === 'month') return [startOfDay(now) - 29 * day, startOfDay(now) + day];
  if (range === 'custom') {
    const f = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const t = to ? new Date(`${to}T00:00:00`).getTime() + day : null;
    return [f, t];
  }
  return [null, null];
}

const fmtWhen = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
};

export default function ActivitiesHome() {
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const [sp, setSp] = useSearchParams();
  const { user } = useAuth();
  const socket = useInstructorSocket(user?.id);
  const { getBattles, updateBattle, startBattle, deleteBattle } = useBattlesAPI();
  const { getCourses } = useCoursesAPI();

  const [activities, setActivities] = useState([]);
  const [battles, setBattles] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [watching, setWatching] = useState(null);
  const [marking, setMarking] = useState(null);
  const [bankOpen, setBankOpen] = useState(false);

  const stage = STAGE_TABS.some((t) => t.key === sp.get('stage')) ? sp.get('stage') : 'all';
  const type = sp.get('type') || 'all';
  const range = RANGES.some((r) => r.key === sp.get('range')) ? sp.get('range') : 'any';
  const from = sp.get('from') || '';
  const to = sp.get('to') || '';
  const q = sp.get('q') || '';
  const setFilter = (patch) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => (v === 'all' || v === 'any' || v === '' ? next.delete(k) : next.set(k, v)));
    setSp(next, { replace: true });
  };
  const showToast = (message, kind = 'success') => { setToast({ message, type: kind }); setTimeout(() => setToast(null), 3500); };

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      apiGet('/api/self-study').then((d) => d?.data ?? []).catch(() => []),
      getBattles().then((r) => r?.data ?? []).catch(() => []),
    ]);
    setActivities(a); setBattles(b); setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => { getCourses().then((r) => setCourses(r?.data ?? r?.courses ?? [])).catch(() => setCourses([])); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const refresh = () => load();
    socket.on('battle.created', refresh); socket.on('battle.updated', refresh);
    return () => { socket.off('battle.created', refresh); socket.off('battle.updated', refresh); };
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => toItems(activities, battles), [activities, battles]);
  const [lo, hi] = rangeBounds(range, from, to);
  const needle = q.trim().toLowerCase();
  const typed = items.filter((i) => {
    if (type !== 'all' && i.type !== type) return false;
    if (needle && !`${i.title} ${i.subject} ${(byKey(i.type) || {}).name || ''}`.toLowerCase().includes(needle)) return false;
    if (lo != null || hi != null) {
      const t = (i.created || i.when) ? new Date(i.created || i.when).getTime() : NaN;
      if (Number.isNaN(t) || (lo != null && t < lo) || (hi != null && t >= hi)) return false;
    }
    return true;
  });
  const shown = stage === 'all' ? typed : typed.filter((i) => i.stage === stage);
  const counts = countStages(typed);
  const stageCount = (k) => (k === 'all' ? typed.length : typed.filter((i) => i.stage === k).length);

  const toChat = (fill = '') => navigate('/chat', { state: { prefill: fill } });

  const onStart = async (b) => {
    try { await startBattle(b.id); setBattles((bs) => bs.map((x) => (x.id === b.id ? { ...x, status: 'live' } : x))); showToast('Battle is starting — it goes live in a moment.'); }
    catch (e) { showToast(e?.message || 'Could not start the battle', 'error'); }
  };
  const onDeleteBattle = async (b) => {
    if (!await confirmDialog(`Delete “${b.title}”? This removes it for everyone invited, along with its questions and results.`)) return;
    const before = battles; setBattles((bs) => bs.filter((x) => x.id !== b.id));
    try { await deleteBattle(b.id); showToast('Battle deleted'); } catch (e) { setBattles(before); showToast(e?.message || 'Could not delete the battle', 'error'); }
  };
  const onDeleteActivity = async (a) => {
    if (!await confirmDialog(`Delete “${a.title}”? Learners keep any session they already started.`)) return;
    const before = activities; setActivities((xs) => xs.filter((x) => x.id !== a.id));
    try { await apiDelete(`/api/self-study/${a.id}`); } catch { setActivities(before); showToast('Could not delete the activity', 'error'); }
  };
  // Battles are CREATED from chat; this only saves edits to one that exists.
  const saveBattle = async (form) => {
    await updateBattle(editing.id, {
      title: form.title.trim(), description: form.description || null, topic: form.topic || null, difficulty: form.difficulty,
      total_questions: parseInt(form.totalQuestions, 10) || 15, time_limit_seconds: (parseInt(form.duration, 10) || 15) * 60,
      xp_prize: parseInt(form.xpPrize, 10) || 0, xp_pool: parseInt(form.xpPrize, 10) || 0,
      hp_per_miss: form.hpPerMiss === '' ? undefined : parseInt(form.hpPerMiss, 10),
      min_xp: form.kind === 'review' ? 0 : (parseInt(form.minXp, 10) || 0),
      scheduled_start: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
    });
    showToast('Battle updated'); setEditing(null); load();
  };

  const metrics = [
    { label: 'Total', value: counts.total, color: C.brand },
    { label: 'Live Now', value: counts.live, color: GREEN },
    { label: 'Scheduled', value: counts.scheduled, color: BLUE },
    { label: 'Completed', value: counts.completed, color: PURPLE },
  ];

  return (
    <PageLayout
      title="Activities"
      subtitle="Everything you've set for learners — every type, every stage"
      action={
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn size="sm" variant="secondary" onClick={() => setBankOpen(true)} title="Question bank" aria-label="Question bank"><Ico ti="ti-target" size={14} />{!mobile && ' Question bank'}</Btn>
          <Btn size="sm" onClick={() => toChat('')}><Ico ti="ti-sparkles" size={14} /> Create in chat</Btn>
        </div>
      }
    >
      <DraftsStrip refreshKey={refreshKey} onResolved={() => setRefreshKey((k) => k + 1)} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 20 }}>
        {metrics.map(({ label, value, color }) => (
          <div key={label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: C.font }}>{loading ? '—' : value}</div>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: C.font }}>{label}</div>
          </div>
        ))}
      </div>

      <Chips ariaLabel="Stage" value={stage} onChange={(k) => setFilter({ stage: k })}
        options={STAGE_TABS.map((t) => ({ ...t, count: loading ? null : stageCount(t.key) }))} strong />
      <Chips ariaLabel="Type" value={type} onChange={(k) => setFilter({ type: k })}
        options={[{ key: 'all', label: 'All types' }, ...WORKBENCH_TYPES.map((t) => ({ key: t.key, label: t.name, color: t.color }))]} />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
        <label style={{ position: 'relative', flex: '1 1 220px', minWidth: 0 }}>
          <Ico ti="ti-search" size={14} color={C.muted2} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={q} onChange={(e) => setFilter({ q: e.target.value })} placeholder="Search title or subject" aria-label="Search activities"
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px 8px 32px', borderRadius: 10, border: `1.5px solid ${C.border}`, background: C.surface, fontSize: 13, fontFamily: C.font, color: C.ink }} />
        </label>
        <select value={range} onChange={(e) => setFilter({ range: e.target.value })} aria-label="Date set" title="Filter by the date it was set"
          style={{ padding: '8px 12px', borderRadius: 10, border: `1.5px solid ${C.border}`, background: C.surface, fontSize: 13, fontFamily: C.font, color: C.ink }}>
          {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        {range === 'custom' && (
          <>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFilter({ from: e.target.value })} aria-label="From date"
              style={{ padding: '7px 10px', borderRadius: 10, border: `1.5px solid ${C.border}`, background: C.surface, fontSize: 13, fontFamily: C.font, color: C.ink }} />
            <span style={{ fontSize: 12, color: C.muted2 }}>to</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setFilter({ to: e.target.value })} aria-label="To date"
              style={{ padding: '7px 10px', borderRadius: 10, border: `1.5px solid ${C.border}`, background: C.surface, fontSize: 13, fontFamily: C.font, color: C.ink }} />
          </>
        )}
        {(q || range !== 'any') && <button type="button" onClick={() => setFilter({ q: '', range: 'any', from: '', to: '' })} style={{ background: 'none', border: 'none', color: C.brand, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}>Clear</button>}
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {[1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 190, borderRadius: 16 }} />)}
        </div>
      ) : shown.length === 0 ? (
        <Empty everything={items.length === 0} filtered={!!(q || range !== 'any' || type !== 'all')} stage={stage} onStart={toChat} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {shown.map((it) => (
            <Card key={it.id} it={it}
              onOpen={() => navigate('/activities/detail', { state: { activity: it.raw } })}
              onDelete={() => (it.kind === 'battle' ? onDeleteBattle(it.raw) : onDeleteActivity(it.raw))}
              onAnalytics={() => navigate(`/self-study/${it.raw.id}/analytics`)} onStart={() => onStart(it.raw)} onWatch={() => setWatching(it.raw)} onEdit={() => setEditing(it.raw)}
              onRoster={() => (it.raw.type === 'review' && it.stage === 'completed' ? setMarking(it.raw.id) : setViewing(it.raw.id))} />
          ))}
        </div>
      )}

      <BattleModal open={!!editing} onClose={() => setEditing(null)} onSubmit={saveBattle} courses={courses} editing={editing} />
      {watching && <WatchBattleModal battle={watching} onClose={() => setWatching(null)} onEnded={load} />}
      <MarkSheetModal open={!!marking} onClose={() => setMarking(null)} battleId={marking} />
      <ParticipantsModal open={!!viewing} onClose={() => setViewing(null)} battleId={viewing} />
      <QuestionBankModal open={bankOpen} onClose={() => setBankOpen(false)} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}

function Chips({ options, value, onChange, ariaLabel, strong = false }) {
  return (
    <div role="tablist" aria-label={ariaLabel} style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: strong ? 10 : 18, scrollbarWidth: 'none' }}>
      {options.map((o) => {
        const on = value === o.key;
        const accent = strong ? C.brand : (o.color || C.brand);
        return (
          <button key={o.key} role="tab" aria-selected={on} onClick={() => onChange(o.key)} style={{
            flexShrink: 0, padding: strong ? '7px 15px' : '5px 12px', borderRadius: 20, fontSize: strong ? 12.5 : 11.5, fontWeight: 700, cursor: 'pointer',
            fontFamily: C.font, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6,
            background: on ? accent : C.surface, color: on ? '#fff' : C.muted, border: `1.5px solid ${on ? accent : C.border}`,
          }}>
            {o.label}
            {o.count != null && <span style={{ fontSize: 10.5, fontWeight: 800, opacity: on ? .9 : .7 }}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Card({ it, onOpen, onDelete, onStart, onWatch, onEdit, onRoster, onAnalytics }) {
  const meta = byKey(it.type) || {};
  const look = STAGE_LOOK[it.stage];
  const b = it.kind === 'battle' ? it.raw : null;
  const a = it.kind === 'activity' ? it.raw : null;
  const p = a?.progress ?? { assigned: 0, started: 0, complete: 0 };
  const pct = p.assigned ? Math.round((p.complete / p.assigned) * 100) : 0;
  const isLive = it.stage === 'live';
  const editable = b && b.mine && !['live', 'completed'].includes(b.status);
  return (
    <div style={{ background: C.surface, border: `1px solid ${isLive ? C.brand : C.border}`, borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, fontFamily: C.font }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: `${meta.color || C.brand}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Ico ti={meta.ti || 'ti-clipboard'} size={19} color={meta.color || C.brand} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, lineHeight: 1.3, overflowWrap: 'break-word' }}>{it.title}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{[meta.name, it.subject].filter(Boolean).join(' · ')}</div>
        </div>
      </div>

      {b ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: look.bg, color: look.color, fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 20, flexShrink: 0 }}>
          {isLive && <span style={{ width: 5, height: 5, borderRadius: '50%', background: look.color, animation: 'pulse-dot 1.5s infinite' }} />}
          {look.label.toUpperCase()}
        </span>
          <Badge color={BLUE} bg="#EFF6FF"><Ico ti="ti-users" size={10} style={{ marginRight: 2 }} />{b.type === 'review' ? 'Review' : `${b.participantCount ?? 0} players`}</Badge>
          <Badge color={C.muted} bg={C.bg}><Ico ti="ti-clock" size={10} style={{ marginRight: 2 }} />{b.durationMin}min</Badge>
          <Badge color={C.brand} bg={C.brandSoft}><Ico ti="ti-bolt" size={10} style={{ marginRight: 2 }} />{b.xpPool} XP</Badge>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: look.bg, color: look.color, fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 20, flexShrink: 0 }}>
          {isLive && <span style={{ width: 5, height: 5, borderRadius: '50%', background: look.color, animation: 'pulse-dot 1.5s infinite' }} />}
          {look.label.toUpperCase()}
        </span>
            <Badge color={BLUE} bg="#EFF6FF"><Ico ti="ti-users" size={10} style={{ marginRight: 2 }} />{p.assigned} assigned</Badge>
            <Badge color={C.brand} bg={C.brandSoft}>{p.started} started</Badge>
            <Badge color={GREEN} bg="#DCFCE7"><Ico ti="ti-circle-check" size={10} style={{ marginRight: 2 }} />{p.complete} done</Badge>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: C.bg, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${C.brand}, ${GREEN})` }} />
          </div>
        </>
      )}

      {it.when && (
        <div style={{ fontSize: 11, color: C.muted2, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Ico ti="ti-clock" size={11} />{it.whenLabel} {fmtWhen(it.when)}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
        {b ? (
          <>
            {it.stage === 'live' && <Btn size="sm" variant="secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={onWatch}><Ico ti="ti-broadcast" size={14} /> Watch live</Btn>}
            {(it.stage === 'scheduled' || it.stage === 'lobby') && <Btn size="sm" style={{ flex: 1, justifyContent: 'center' }} onClick={onStart}><Ico ti="ti-player-play" size={14} /> Start now</Btn>}
            {it.stage === 'completed' && <Btn size="sm" variant="secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={onRoster}><Ico ti="ti-trophy" size={14} /> {b.type === 'review' ? 'Mark sheet' : 'Results'}</Btn>}
            {it.stage !== 'completed' && <Btn size="sm" variant="secondary" onClick={onRoster} title="Players"><Ico ti="ti-users" size={13} /></Btn>}
            {it.stage === 'completed' && <Btn size="sm" variant="secondary" onClick={onWatch} title="Replay"><Ico ti="ti-broadcast" size={13} /></Btn>}
            {editable && <Btn size="sm" variant="secondary" onClick={onEdit} title="Edit"><Ico ti="ti-pencil" size={13} /></Btn>}
            {b.mine && b.status !== 'live' && <Btn size="sm" variant="secondary" onClick={onDelete} title="Delete"><Ico ti="ti-trash" size={13} /></Btn>}
          </>
        ) : (
          <>
            <Btn size="sm" variant="secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={onOpen}><Ico ti="ti-eye" size={14} /> See who's done it</Btn>
            {it.type === 'self_study' && <Btn size="sm" variant="secondary" onClick={onAnalytics} title="Analytics" aria-label="Analytics"><Ico ti="ti-chart-bar" size={13} /></Btn>}
            <Btn size="sm" variant="secondary" onClick={onDelete} title="Delete"><Ico ti="ti-trash" size={13} /></Btn>
          </>
        )}
      </div>
    </div>
  );
}

function Empty({ everything, filtered, stage, onStart }) {
  return (
    <div style={{ background: C.surface, border: `1px dashed ${C.border}`, borderRadius: 16, padding: '40px 20px', textAlign: 'center', fontFamily: C.font }}>
      <Ico ti="ti-clipboard-list" size={32} color={C.muted} style={{ marginBottom: 10 }} />
      <p style={{ fontSize: 14, color: C.ink, fontWeight: 700, margin: '0 0 4px' }}>
        {everything ? 'No activities yet' : filtered ? 'Nothing matches these filters' : stage === 'all' ? 'Nothing yet' : `Nothing ${stage} right now`}
      </p>
      <p style={{ fontSize: 12.5, color: C.muted, margin: '0 auto 16px', maxWidth: 420, lineHeight: 1.5 }}>
        Ask your agent to prepare one — you review the draft in chat, then assign it.
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {CHAT_STARTS.map((s) => (
          <button key={s.label} onClick={() => onStart(s.fill)} style={{ padding: '6px 13px', borderRadius: 20, border: `1.5px solid ${C.border}`, background: C.surface, color: C.brand, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}>{s.label}</button>
        ))}
      </div>
    </div>
  );
}
