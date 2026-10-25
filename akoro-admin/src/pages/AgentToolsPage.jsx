/**
 * Learners' tools — the tools learners' (and instructors') own agents built
 * (self-tooling) and not yet promoted, merge candidates, and how create_tool
 * goals end. Promoted tools are listed on Agent capabilities → Agent tools.
 *
 * Promotion runs the Verification Gate's promotion check on three test
 * learners first; it only goes through on PASS.
 */
import { useCallback, useEffect, useState } from 'react';
import { BarChart2, Copy, Globe, RefreshCw, Search, ShieldCheck, Wrench } from 'lucide-react';

import { PageLayout } from '../components/Layout.jsx';
import { Btn, Inp, Modal, Skeleton, Toast } from '../components/Primitives.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { AMBER, BLUE, BORDER, FONT, GREEN, INK, LIGHT, MUTED, MUTED2, PURPLE, RED, WHITE } from '../constants.js';

const TABS = [
  { key: 'library', label: 'Library', icon: Wrench },
  { key: 'similar', label: 'Similar tools', icon: Copy },
  { key: 'analytics', label: 'Analytics', icon: BarChart2 },
];
const STATUS = {
  active:   { label: 'On',       color: GREEN,  bg: '#ECFDF5' },
  disabled: { label: 'Off',      color: AMBER,  bg: '#FFF7ED' },
  revoked:  { label: 'Revoked',  color: RED,    bg: '#FEF2F2' },
  archived: { label: 'Archived', color: MUTED,  bg: LIGHT },
};
const when = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const pill = (text, color, bg, key) => <span key={key || text} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: bg, color, fontFamily: FONT, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{text}</span>;
const statusPill = (s) => { const x = STATUS[s] || STATUS.active; return pill(x.label, x.color, x.bg, s); };
const scopePill = (scope, audience) => {
  const who = audience === 'instructor' ? 'Instructor' : 'Learner';
  return scope === 'platform' ? pill(`Every ${who.toLowerCase()}`, PURPLE, '#F5F3FF', 'scope') : pill(who, audience === 'instructor' ? AMBER : BLUE, audience === 'instructor' ? '#FFF7ED' : '#EFF6FF', 'scope');
};
const owner = (t) => (t.owner ? (t.owner.name || t.owner.username || 'Learner') : 'Akoro');

export default function AgentToolsPage() {
  const [tab, setTab] = useState('library');
  const [toast, setToast] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [reload, setReload] = useState(0);
  const refresh = () => setReload((n) => n + 1);

  return (
    <PageLayout title="Learners’ tools" subtitle="Tools learners’ and instructors’ own agents built, not yet promoted to everyone"
      action={<Btn variant="secondary" size="sm" onClick={refresh}><RefreshCw size={14} /> Refresh</Btn>}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      <div style={{ maxWidth: 1220, margin: '0 auto' }}>
        <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: `1px solid ${BORDER}`, overflowX: 'auto' }}>
          {TABS.map(({ key, label, icon: Icon }) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'none', padding: '9px 12px', cursor: 'pointer',
            fontFamily: FONT, fontSize: 13, fontWeight: tab === key ? 700 : 600, color: tab === key ? INK : MUTED,
            borderBottom: `2px solid ${tab === key ? AMBER : 'transparent'}`, marginBottom: -1, whiteSpace: 'nowrap',
          }}><Icon size={14} /> {label}</button>)}
        </div>
        {tab === 'library' && <Library reload={reload} onOpen={setOpenId} onToast={setToast} />}
        {tab === 'similar' && <Similar reload={reload} onOpen={setOpenId} onToast={setToast} />}
        {tab === 'analytics' && <Analytics reload={reload} onToast={setToast} />}
      </div>
      <ToolModal id={openId} onClose={() => setOpenId(null)} onToast={setToast} onChanged={refresh} />
    </PageLayout>
  );
}

function Library({ reload, onOpen, onToast }) {
  const scope = 'learner';
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    setData(null);
    try {
      const q = new URLSearchParams({ limit: '100' });
      if (scope) q.set('scope', scope);
      if (status) q.set('status', status);
      if (term) q.set('search', term);
      setData(await apiGet(`/api/admin/agent-tools?${q}`));
    } catch (e) { onToast({ type: 'error', message: e.message || 'Could not load tools.' }); setData({ tools: [], total: 0 }); }
  }, [scope, status, term, onToast]);
  useEffect(() => { load(); }, [load, reload]);

  const chip = (value, current, set, label) => <button key={label} onClick={() => set(value)} style={{
    border: `1px solid ${current === value ? AMBER : BORDER}`, background: current === value ? '#FFF7ED' : WHITE, color: current === value ? INK : MUTED,
    borderRadius: 999, padding: '6px 11px', cursor: 'pointer', fontFamily: FONT, fontWeight: current === value ? 700 : 600, fontSize: 12, whiteSpace: 'nowrap',
  }}>{label}</button>;

  return <>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {chip('active', status, setStatus, 'On')}{chip('disabled', status, setStatus, 'Off')}{chip('revoked', status, setStatus, 'Revoked')}{chip('archived', status, setStatus, 'Archived')}{chip('', status, setStatus, 'Any status')}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); setTerm(search.trim()); }} style={{ display: 'flex', gap: 8, flex: '1 1 240px', maxWidth: 360 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={15} color={MUTED} style={{ position: 'absolute', top: '50%', left: 11, transform: 'translateY(-50%)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search label or goal…" aria-label="Search tools"
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px 9px 33px', borderRadius: 9, border: `1px solid ${BORDER}`, background: WHITE, color: INK, fontFamily: FONT, fontSize: 13, outline: 'none' }} />
        </div>
        <Btn type="submit" variant="secondary" size="sm">Search</Btn>
      </form>
    </div>
    {!data ? <Skeleton height={240} /> : !data.tools.length
      ? <Empty icon={Wrench} text="No tools match." sub="Tools appear here when learners' agents build them with create_tool." />
      : <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, background: LIGHT, fontFamily: FONT, fontSize: 13, fontWeight: 700, color: INK }}>{data.tools.length} of {data.total}</div>
        {data.tools.map((t) => <ToolRow key={t.id} t={t} onOpen={onOpen} />)}
      </div>}
  </>;
}

function ToolRow({ t, onOpen, extra }) {
  return <button onClick={() => onOpen(t.id)} style={{ width: '100%', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 14, textAlign: 'left', padding: 15, border: 'none', borderBottom: `1px solid ${BORDER}`, background: WHITE, cursor: 'pointer', fontFamily: FONT }}>
    <div style={{ minWidth: 0 }}>
      <div style={{ color: INK, fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</div>
      <div style={{ color: MUTED, fontSize: 12.5, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.goal}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, color: MUTED2, fontSize: 11.5, marginTop: 7 }}>
        <span>{owner(t)}</span><span>·</span><span>{t.mode}</span><span>·</span><span>used {t.uses}×</span>
        {t.changes?.length > 0 && <><span>·</span><span style={{ color: AMBER, fontWeight: 700 }}>changes data</span></>}
        {t.failStreak > 0 && <><span>·</span><span style={{ color: RED }}>{t.failStreak} failure{t.failStreak === 1 ? '' : 's'} in a row</span></>}
        <span>·</span><span>{when(t.createdAt)}</span>{extra}
      </div>
    </div>
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'flex-end' }}>{scopePill(t.scope, t.audience)}{statusPill(t.status)}</div>
  </button>;
}

function Similar({ reload, onOpen, onToast }) {
  const [groups, setGroups] = useState(null);
  useEffect(() => {
    setGroups(null);
    apiGet('/api/admin/agent-tools/similar').then((d) => setGroups(d.groups || []))
      .catch((e) => { onToast({ type: 'error', message: e.message || 'Could not load similar tools.' }); setGroups([]); });
  }, [reload, onToast]);
  if (!groups) return <Skeleton height={240} />;
  if (!groups.length) return <Empty icon={Copy} text="No similar tools yet." sub="When several learners build tools over the same data with similar goals, they're grouped here — promote one for everyone and retire the copies." />;
  return <div style={{ display: 'grid', gap: 14 }}>
    {groups.map((g) => <div key={g.tools.map((t) => t.id).join()} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '11px 15px', background: LIGHT, borderBottom: `1px solid ${BORDER}`, fontFamily: FONT, fontSize: 12.5 }}>
        <span style={{ color: INK, fontWeight: 700 }}>{g.tools.length} tools · {g.owners} learner{g.owners === 1 ? '' : 's'} · used {g.uses}×</span>
        <span style={{ color: MUTED }}>{g.platformTool ? 'Already has a tool for everyone' : 'Open one to promote it and retire the rest'}</span>
      </div>
      {g.tools.map((t) => <ToolRow key={t.id} t={t} onOpen={onOpen} />)}
    </div>)}
  </div>;
}

function ToolModal({ id, onClose, onToast, onChanged }) {
  const [t, setT] = useState(null);
  const [busy, setBusy] = useState(false);
  const [promote, setPromote] = useState(null);   // { name, label, goal, replaces: Set }
  const [similar, setSimilar] = useState([]);
  useEffect(() => {
    setT(null); setPromote(null); setSimilar([]);
    if (!id) return;
    apiGet(`/api/admin/agent-tools/${id}`).then((d) => setT(d.tool)).catch((e) => { onToast({ type: 'error', message: e.message }); onClose(); });
    apiGet('/api/admin/agent-tools/similar').then((d) => setSimilar((d.groups || []).find((g) => g.tools.some((x) => x.id === id))?.tools.filter((x) => x.id !== id && x.scope === 'learner') || [])).catch(() => {});
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps -- refetch only when the tool changes
  if (!id) return null;

  const setStatus = async (status) => {
    if (status === 'revoked' && !window.confirm(`Revoke "${t.label}"? ${t.scope === 'platform' ? 'It stops for every learner at once.' : 'The learner can’t turn it back on.'}`)) return;
    setBusy(true);
    try { await apiPost(`/api/admin/agent-tools/${id}/status`, { status }); onToast({ type: 'success', message: 'Saved.' }); onChanged(); onClose(); }
    catch (e) { onToast({ type: 'error', message: e.message || 'Could not save.' }); }
    finally { setBusy(false); }
  };
  const doPromote = async () => {
    setBusy(true);
    try {
      const r = await apiPost(`/api/admin/agent-tools/${id}/promote`, { name: promote.name, label: promote.label, goal: promote.goal, replaces: [...promote.replaces] });
      onToast({ type: 'success', message: `Promoted to everyone (check ${String(r.runId).slice(0, 8)} passed${r.retired ? `, ${r.retired} cop${r.retired === 1 ? 'y' : 'ies'} retired` : ''}).` });
      onChanged(); onClose();
    } catch (e) { onToast({ type: 'error', message: e.message || 'Promotion failed.' }); }
    finally { setBusy(false); }
  };

  const row = (label, value) => <div><div style={{ color: MUTED2, marginBottom: 3 }}>{label}</div><div style={{ color: INK, fontWeight: 600, overflowWrap: 'anywhere' }}>{value}</div></div>;
  return <Modal open={!!id} onClose={busy ? () => {} : onClose} title={t ? t.label : 'Tool'} width={780}>
    {!t ? <Skeleton height={220} /> : <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>{scopePill(t.scope, t.audience)}{statusPill(t.status)}{t.verified && pill(`Verified: ${t.verified}`, GREEN, '#ECFDF5', 'v')}{t.promotion && pill(`Promotion check: ${t.promotion.verdict}`, PURPLE, '#F5F3FF', 'p')}</div>
      <p style={{ margin: '0 0 14px', color: INK, fontFamily: FONT, fontSize: 13.5, lineHeight: 1.6 }}>{t.goal}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, padding: 12, background: LIGHT, borderRadius: 10, marginBottom: 14, fontFamily: FONT, fontSize: 12 }}>
        {row('Owner', owner(t))}{row('Name', <code>{t.name}</code>)}{row('Mode', t.mode)}{row('Used', `${t.uses}×`)}
        {row('Data', [...t.views, ...t.capabilities].join(', ') || '—')}{row('Created', when(t.createdAt))}
        {t.changes?.length > 0 && row('Can change', t.changes.join(' '))}
      </div>
      <details style={{ marginBottom: 14, fontFamily: FONT, fontSize: 12 }}>
        <summary style={{ cursor: 'pointer', color: MUTED, fontWeight: 700 }}>Definition and verification</summary>
        <pre style={{ background: '#0F172A', color: '#E2E8F0', padding: 12, borderRadius: 9, overflow: 'auto', maxHeight: 260, fontSize: 11.5 }}>{JSON.stringify({ definition: t.definition, params: t.params, verification: t.verification }, null, 2)}</pre>
      </details>

      {promote ? <div style={{ border: `1px solid ${BORDER}`, borderRadius: 11, padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <Inp label="Name for everyone" value={promote.name} onChange={(e) => setPromote({ ...promote, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 48) })} />
          <Inp label="Label learners see" value={promote.label} onChange={(e) => setPromote({ ...promote, label: e.target.value.slice(0, 60) })} />
        </div>
        <Inp label="What it does" value={promote.goal} onChange={(e) => setPromote({ ...promote, goal: e.target.value.slice(0, 300) })} containerStyle={{ marginTop: 10 }} />
        {similar.length > 0 && <div style={{ marginTop: 12, fontFamily: FONT, fontSize: 12.5 }}>
          <div style={{ color: MUTED, fontWeight: 700, marginBottom: 6 }}>Retire similar learner copies (their owners get this one):</div>
          {similar.map((s) => <label key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', color: INK }}>
            <input type="checkbox" checked={promote.replaces.has(s.id)} onChange={(e) => { const r = new Set(promote.replaces); e.target.checked ? r.add(s.id) : r.delete(s.id); setPromote({ ...promote, replaces: r }); }} />
            {s.label} <span style={{ color: MUTED2 }}>— {owner(s)}</span>
          </label>)}
        </div>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', background: '#FFFBEB', borderRadius: 9, marginTop: 12, fontFamily: FONT, fontSize: 12, color: INK, lineHeight: 1.5 }}>
          <ShieldCheck size={15} color={AMBER} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Promoting first runs a Verification Gate check: the tool's samples on three test learners, each on their own data. It's only promoted if that passes. Every learner then gets it, run on their own data only.{t.changes?.length > 0 && <> It changes data ({t.changes.join(' ')}): promoting turns that on for everyone, and every change still waits for each learner's Confirm. Revoking the tool turns it off again.</>}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <Btn variant="secondary" onClick={() => setPromote(null)} disabled={busy}>Back</Btn>
          <Btn onClick={doPromote} disabled={busy || promote.name.length < 3 || promote.label.length < 2}>{busy ? 'Checking…' : 'Run check and promote'}</Btn>
        </div>
      </div> : <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        {t.status === 'active' && <Btn variant="secondary" onClick={() => setStatus('disabled')} disabled={busy}>Turn off</Btn>}
        {t.status === 'disabled' && <Btn variant="secondary" onClick={() => setStatus('active')} disabled={busy}>Turn on</Btn>}
        {['active', 'disabled'].includes(t.status) && <Btn variant="secondary" onClick={() => setStatus('revoked')} disabled={busy}>Revoke (delete)</Btn>}
        {t.scope === 'learner' && t.status === 'active' && <Btn onClick={() => setPromote({ name: t.name, label: t.label, goal: t.goal, replaces: new Set() })} disabled={busy}><Globe size={14} /> Promote to everyone</Btn>}
      </div>}
    </>}
  </Modal>;
}

function Analytics({ reload, onToast }) {
  const [days, setDays] = useState(30);
  const [a, setA] = useState(null);
  useEffect(() => {
    setA(null);
    apiGet(`/api/admin/self-tooling/analytics?days=${days}`).then((d) => setA(d.analytics))
      .catch((e) => { onToast({ type: 'error', message: e.message || 'Could not load analytics.' }); setA(false); });
  }, [days, reload, onToast]);
  if (a === null) return <Skeleton height={300} />;
  if (!a) return null;
  const o = a.goals.byOutcome;
  const tile = (label, value, sub) => <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, fontFamily: FONT }}>
    <div style={{ color: MUTED, fontSize: 12, fontWeight: 600 }}>{label}</div>
    <div style={{ color: INK, fontSize: 24, fontWeight: 800, marginTop: 4 }}>{value ?? '—'}</div>
    {sub && <div style={{ color: MUTED2, fontSize: 11.5, marginTop: 3 }}>{sub}</div>}
  </div>;
  const resolved = a.goals.total ? Math.round(((o.created || 0) / a.goals.total) * 100) : null;
  return <div style={{ display: 'grid', gap: 16 }}>
    <div style={{ display: 'flex', gap: 6 }}>{[7, 30, 90].map((d) => <Btn key={d} size="sm" variant={days === d ? 'primary' : 'secondary'} onClick={() => setDays(d)}>{d} days</Btn>)}</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
      {tile('Goals asked', a.goals.total, `${a.goals.learners} learner${a.goals.learners === 1 ? '' : 's'}`)}
      {tile('Built', o.created || 0, resolved != null ? `${resolved}% of goals` : null)}
      {tile('Sent to an admin', o.escalated || 0)}
      {tile('Couldn’t be built', (o.rejected || 0) + (o.failed || 0))}
      {tile('Build time (median)', a.goals.msP50 != null ? `${(a.goals.msP50 / 1000).toFixed(1)} s` : null, a.goals.msP90 != null ? `90% under ${(a.goals.msP90 / 1000).toFixed(1)} s` : null)}
      {tile('Tools in use', a.tools.learner + a.tools.platform, `${a.tools.platform} for everyone`)}
    </div>
    <DailyBars daily={a.goals.daily} />
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
      <ListCard title="Most requested permissions" empty="No permission requests." rows={a.requests.topCapabilities.map((c) => [c.does || c.capability, `${c.learners} learner${c.learners === 1 ? '' : 's'}`])} />
      <ListCard title="Why goals weren't built" empty="Nothing rejected." rows={a.goals.topRejections.map((r) => [r.key, r.count])} />
      <ListCard title="Most used tools" empty="No tools used yet." rows={a.tools.mostUsed.map((t) => [`${t.label}${t.scope === 'platform' ? ' (everyone)' : ''}`, `${t.uses}×`])} />
      <ListCard title="Failing tools" empty="No tool is failing." rows={a.tools.failing.map((t) => [t.label, `${t.failStreak} in a row`])} />
    </div>
  </div>;
}

/** Goals per day — one series, hover shows the breakdown; the table is the cards below. */
function DailyBars({ daily }) {
  const totals = daily.map((d) => d.created + d.escalated + d.rejected + d.failed);
  const max = Math.max(1, ...totals);
  return <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16, fontFamily: FONT }}>
    <div style={{ color: INK, fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Goals per day</div>
    <div role="img" aria-label={`Goals per day, most ${max}`} style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120, borderBottom: `1px solid ${BORDER}` }}>
      {daily.map((d, i) => <div key={d.date} title={`${d.date}: ${totals[i]} goal${totals[i] === 1 ? '' : 's'} — built ${d.created}, to admin ${d.escalated}, not built ${d.rejected + d.failed}`}
        style={{ flex: 1, minWidth: 2, height: '100%', display: 'flex', alignItems: 'flex-end', cursor: 'default' }}>
        <div style={{ width: '100%', height: `${(totals[i] / max) * 100}%`, minHeight: totals[i] ? 2 : 0, background: AMBER, borderRadius: '4px 4px 0 0' }} />
      </div>)}
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', color: MUTED2, fontSize: 11, marginTop: 6 }}><span>{daily[0]?.date}</span><span>{daily.at(-1)?.date}</span></div>
  </div>;
}

function ListCard({ title, rows, empty }) {
  return <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', fontFamily: FONT }}>
    <div style={{ padding: '11px 14px', borderBottom: `1px solid ${BORDER}`, background: LIGHT, color: INK, fontWeight: 700, fontSize: 13 }}>{title}</div>
    {!rows.length ? <div style={{ padding: 14, color: MUTED, fontSize: 12.5 }}>{empty}</div>
      : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}><tbody>
        {rows.map(([k, v], i) => <tr key={i} style={{ borderBottom: i < rows.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
          <td style={{ padding: '9px 14px', color: INK }}>{k}</td><td style={{ padding: '9px 14px', color: MUTED, textAlign: 'right', whiteSpace: 'nowrap' }}>{v}</td>
        </tr>)}
      </tbody></table>}
  </div>;
}

function Empty({ icon: Icon, text, sub }) {
  return <div style={{ minHeight: 200, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, fontFamily: FONT }}>
    <div><div style={{ width: 44, height: 44, display: 'inline-grid', placeItems: 'center', background: '#FFF7ED', borderRadius: 13, marginBottom: 9 }}><Icon size={20} color={AMBER} /></div>
      <div style={{ color: INK, fontWeight: 700, fontSize: 14 }}>{text}</div>
      {sub && <div style={{ color: MUTED, fontSize: 12, marginTop: 5, maxWidth: 420 }}>{sub}</div>}</div>
  </div>;
}
