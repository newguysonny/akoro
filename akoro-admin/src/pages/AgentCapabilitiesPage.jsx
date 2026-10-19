/**
 * Agent capabilities — what the agent chat can do, read live from the API
 * (modules/agent-capabilities): a new tool or feature appears on its next
 * deploy without editing this page.
 *
 *   kind="tools"     Akoro's own chat tools and the tools promoted to everyone
 *   kind="features"  what the agent does that isn't a tool
 * Learners' own (unpromoted) tools live on Learners' tools (AgentToolsPage).
 */
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';

import { PageLayout } from '../components/Layout.jsx';
import { Btn, Skeleton, Toast } from '../components/Primitives.jsx';
import { apiGet } from '../services/api.js';
import { BLUE, BORDER, FONT, GREEN, INK, LIGHT, MUTED, MUTED2, PURPLE, RED, WHITE } from '../constants.js';

const WHO = {
  learner:    { label: 'Learner',    color: BLUE,      bg: '#EFF6FF' },
  instructor: { label: 'Instructor', color: '#B45309', bg: '#FFF7ED' },
  shared:     { label: 'Shared',     color: PURPLE,    bg: '#F5F3FF' },
};
const PAGES = {
  tools: { title: 'Agent tools', endpoint: '/api/admin/agent-capabilities/tools',
    subtitle: 'Akoro’s own chat tools and the tools promoted to everyone — read from the code, so new ones appear on their next deploy.' },
  features: { title: 'Agent features', endpoint: '/api/admin/agent-capabilities/features',
    subtitle: 'What the agent does that isn’t a chat tool: on its own, in the chat, and in the reader.' },
};
const pill = (text, color, bg) => <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 999, background: bg, color, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{text}</span>;
const cell = { padding: '11px 12px', borderBottom: `1px solid ${BORDER}`, verticalAlign: 'top', fontSize: 13, color: INK };
const head = { textAlign: 'left', padding: '9px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: MUTED, background: LIGHT, borderBottom: `1px solid ${BORDER}` };

export default function AgentCapabilitiesPage({ kind = 'tools' }) {
  const page = PAGES[kind];
  const [data, setData] = useState(null);
  const [toast, setToast] = useState(null);
  const [reload, setReload] = useState(0);
  const [who, setWho] = useState('');
  const [area, setArea] = useState('');
  const [status, setStatus] = useState('');
  const [term, setTerm] = useState('');

  useEffect(() => {
    let live = true;
    setData(null);
    apiGet(page.endpoint).then((d) => live && setData(d))
      .catch((e) => { if (live) { setToast({ type: 'error', message: e.message || 'Could not load.' }); setData({ rows: [], areas: {} }); } });
    return () => { live = false; };
  }, [page.endpoint, reload]);

  const rows = useMemo(() => data?.rows || [], [data]);
  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return rows.filter((r) => (!who || r.who === who) && (!area || r.area === area)
      && (!status || (status === 'new' ? r.isNew : status === 'missing' ? !r.examples.length : r.status === status))
      && (!q || [r.name, r.ref, r.what, ...r.examples].join(' ').toLowerCase().includes(q)));
  }, [rows, who, area, status, term]);
  const areas = data?.areas || {};
  const groups = useMemo(() => Object.keys(areas).map((k) => [k, shown.filter((r) => r.area === k)]).filter(([, list]) => list.length), [areas, shown]);
  const count = (w) => rows.filter((r) => r.who === w).length;

  const tab = (value, label) => <button key={label} role="tab" aria-selected={who === value} onClick={() => setWho(value)} style={{
    border: 'none', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 600,
    background: who === value ? INK : 'transparent', color: who === value ? WHITE : MUTED,
  }}>{label}</button>;
  const select = { fontFamily: FONT, fontSize: 13, padding: '8px 10px', borderRadius: 9, border: `1px solid ${BORDER}`, background: WHITE, color: INK };

  return (
    <PageLayout title={page.title} subtitle={page.subtitle}
      action={<Btn variant="secondary" size="sm" onClick={() => setReload((n) => n + 1)}><RefreshCw size={14} /> Refresh</Btn>}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      <div style={{ maxWidth: 1220, margin: '0 auto', fontFamily: FONT }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
          {[['Learner', count('learner')], ['Instructor', count('instructor')], ['Shared', count('shared')], ['Missing an example', rows.filter((r) => !r.examples.length).length, RED]].map(([l, n, c]) => (
            <div key={l} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>{l}</div>
              <div data-capability-count={l} style={{ fontSize: 22, fontWeight: 800, color: n && c ? c : INK, marginTop: 4 }}>{data ? n : '–'}</div>
            </div>))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <div role="tablist" style={{ display: 'flex', gap: 4, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 3 }}>
            {tab('', `All ${rows.length}`)}{tab('learner', 'Learner')}{tab('instructor', 'Instructor')}{tab('shared', 'Shared')}
          </div>
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search size={15} color={MUTED} style={{ position: 'absolute', top: '50%', left: 11, transform: 'translateY(-50%)' }} />
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search a capability or prompt…" aria-label="Search capabilities"
              style={{ ...select, width: '100%', boxSizing: 'border-box', paddingLeft: 33, outline: 'none' }} />
          </div>
          <select aria-label="Area" value={area} onChange={(e) => setArea(e.target.value)} style={select}>
            <option value="">All areas</option>
            {Object.entries(areas).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} style={select}>
            <option value="">Any status</option><option value="on">On</option><option value="off">Switched off</option>
            <option value="new">New this week</option><option value="missing">Missing an example</option>
          </select>
        </div>

        {!data ? <Skeleton height={320} /> : !shown.length
          ? <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 28, textAlign: 'center', color: MUTED, fontSize: 13 }}>Nothing matches.</div>
          : <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead><tr>
                <th style={{ ...head, width: '22%' }}>Capability</th><th style={{ ...head, width: '10%' }}>Who</th>
                <th style={head}>What it does</th><th style={{ ...head, width: '30%' }}>Example prompts</th><th style={{ ...head, width: '11%' }}>Status</th>
              </tr></thead>
              <tbody>
                {groups.map(([k, list]) => [
                  <tr key={`g-${k}`}><td colSpan={5} style={{ ...cell, background: LIGHT, fontSize: 12, fontWeight: 700, color: MUTED, padding: '7px 12px' }}>{areas[k]} · {list.length}</td></tr>,
                  ...list.map((r) => <Row key={r.key} r={r} />),
                ])}
              </tbody>
            </table>
          </div>}
      </div>
    </PageLayout>
  );
}

function Row({ r }) {
  const w = WHO[r.who] || WHO.learner;
  return (
    <tr data-capability={r.ref}>
      <td style={cell}>
        <div style={{ fontWeight: 700 }}>{r.name}</div>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: MUTED2, marginTop: 2, wordBreak: 'break-all' }}>{r.kind === 'platform' ? `promoted · ${r.ref}` : r.ref}</div>
      </td>
      <td style={cell}>{pill(w.label, w.color, w.bg)}</td>
      <td style={{ ...cell, color: '#374151' }}>{r.what}{r.since && <span style={{ color: MUTED2 }}> ({r.since})</span>}</td>
      <td style={{ ...cell, fontStyle: 'italic', color: '#374151' }}>
        {r.examples.length ? r.examples.map((x) => <div key={x} style={{ margin: '1px 0' }}>{x.startsWith('(') ? x : `“${x}”`}</div>)
          : <span style={{ fontStyle: 'normal', fontWeight: 600, fontSize: 12, color: RED }}>No example yet</span>}
      </td>
      <td style={cell}>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {r.status === 'on' ? pill('On', GREEN, '#ECFDF5') : pill('Switched off', MUTED, '#F3F4F6')}
          {r.isNew && pill('New', '#92400E', '#FEF3C7')}
        </div>
        {r.switch && <div style={{ fontSize: 11, color: MUTED2, marginTop: 5 }}>{r.switch}</div>}
        {r.kind === 'platform' && <div style={{ fontSize: 11, color: MUTED2, marginTop: 5 }}>used {r.uses}×</div>}
      </td>
    </tr>
  );
}
