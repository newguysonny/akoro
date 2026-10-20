/*
 * AgentToolsPage — Settings → My agent tools: the tools the instructor's AI
 * Chat agent built for them (self-tooling, phase S7). Shows what each does in
 * plain words, never how it was built. Turn off / on, rename, delete. Below
 * them, permissions the agent asked an admin for (withdrawable while they
 * wait). Same API as the learner app: /api/self-tooling/* is per account.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wrench, Trash2, Pencil, Check, X, Hourglass, Calendar, CheckCircle2, XCircle, Clock, MessageSquare } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPatch, apiPost } from '../services/api.js';
import { confirmDialog } from '../components/ConfirmHost.jsx';
import { RED } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const when = (iso) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' }) : null);

const REQUEST_STATUS = {
  new:          { icon: Hourglass, ti: 'ti-hourglass',   text: 'Waiting for an admin' },
  under_review: { icon: Hourglass, ti: 'ti-hourglass',   text: 'Being reviewed' },
  planned:      { icon: Calendar, ti: 'ti-calendar',    text: 'Planned by the Akoro team' },
  approved:     { icon: CheckCircle2, ti: 'ti-circle-check', text: 'Approved — your agent is finishing it' },
  implemented:  { icon: CheckCircle2, ti: 'ti-circle-check', text: 'Approved — answered in your chat' },
  declined:     { icon: XCircle, ti: 'ti-circle-x',      text: 'Not approved' },
  expired:      { icon: Clock, ti: 'ti-clock',       text: 'Expired without a decision' },
};

function Toggle({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onChange} style={{
      width: 42, height: 23, borderRadius: 12, position: 'relative', border: 'none', padding: 0,
      background: on ? C.brand : '#E5E7EB', transition: 'background .25s', cursor: 'pointer', flexShrink: 0,
    }}>
      <span style={{
        position: 'absolute', top: 2.5, left: on ? 21 : 2.5, width: 18, height: 18, borderRadius: '50%',
        background: '#fff', transition: 'left .25s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
      }} />
    </button>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted2, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: C.font, marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function Row({ icon: Icon, ti, label, sublabel, right, muted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderBottom: `1px solid ${C.border}` }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: tint(9), display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.brand, opacity: muted ? 0.55 : 1 }}>
        <Ico lucide={Icon} ti={ti} size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0, opacity: muted ? 0.55 : 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, fontFamily: C.font, color: C.ink, overflowWrap: 'anywhere' }}>{label}</div>
        {sublabel && <div style={{ fontSize: 12, color: C.muted2, fontFamily: C.font, marginTop: 2, lineHeight: 1.45 }}>{sublabel}</div>}
      </div>
      {right}
    </div>
  );
}

const iconBtn = { width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, color: C.muted };

export default function AgentToolsPage() {
  const navigate = useNavigate();
  const [state, setState] = useState(null);       // { enabled, tools } | null while loading
  const [requests, setRequests] = useState([]);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null);   // { id, label }

  useEffect(() => {
    apiGet('/api/self-tooling/tools').then((d) => setState(d?.data || d)).catch(() => setState({ enabled: false, tools: [] }));
    apiGet('/api/self-tooling/requests').then((d) => setRequests((d?.data || d)?.requests || [])).catch(() => {});
  }, []);

  const patch = async (id, body, optimistic) => {
    const before = state.tools;
    setErr('');
    setState((s) => ({ ...s, tools: optimistic(s.tools) }));
    try { await apiPatch(`/api/self-tooling/tools/${id}`, body); }
    catch (e) { setState((s) => ({ ...s, tools: before })); setErr(e?.message || 'Could not save that.'); }
  };
  const toggle = (t) => patch(t.id, { status: t.status === 'active' ? 'disabled' : 'active' },
    (list) => list.map((x) => (x.id === t.id ? { ...x, status: x.status === 'active' ? 'disabled' : 'active' } : x)));
  const rename = () => {
    const label = editing.label.trim();
    if (label.length < 2) { setErr('Give the tool a name of at least 2 characters.'); return; }
    const id = editing.id;
    setEditing(null);
    patch(id, { label }, (list) => list.map((x) => (x.id === id ? { ...x, label } : x)));
  };
  const remove = async (t) => {
    if (!(await confirmDialog({ title: `Delete "${t.label}"?`, message: 'Your agent will stop using this tool. It can build it again if you ask.', confirmLabel: 'Delete', danger: true }))) return;
    patch(t.id, { delete: true }, (list) => list.filter((x) => x.id !== t.id));
  };
  const withdraw = async (r) => {
    if (!(await confirmDialog({ title: 'Withdraw this request?', message: 'Your agent will stop waiting for permission. You can ask again later.', confirmLabel: 'Withdraw' }))) return;
    try {
      await apiPost(`/api/self-tooling/requests/${r.id}/cancel`, {});
      setRequests((list) => list.map((x) => (x.id === r.id ? { ...x, status: 'declined', note: 'Withdrawn' } : x)));
    } catch (e) { setErr(e?.message || 'Could not withdraw that.'); }
  };

  const note = (text) => <div style={{ padding: '14px 16px', fontSize: 13, color: C.muted, fontFamily: C.font, lineHeight: 1.55 }}>{text}</div>;

  return (
    <PageLayout title="My agent tools" subtitle="Tools your AI Chat agent built to answer your questions">
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <Section title="Tools">
          {!state ? note('Loading…')
            : !state.enabled ? note('Agent-built tools aren\'t switched on for your account yet.')
            : state.tools.length === 0 ? (
              <>
                {note('When you ask your AI Chat agent something none of its tools can answer — like "which of my students haven\'t started Activity 2?" — it can build a small tool for you. Your tools only ever see your own classes, and they show up here.')}
                <div style={{ padding: '0 16px 14px' }}>
                  <button type="button" onClick={() => navigate('/chat')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: C.font, fontSize: 13, fontWeight: 600, padding: '8px 12px', borderRadius: 10, border: 'none', background: C.brand, color: '#fff', cursor: 'pointer' }}>
                    <Ico lucide={MessageSquare} ti="ti-message" size={14} /> Open AI Chat
                  </button>
                </div>
              </>
            ) : state.tools.map((t) => editing?.id === t.id ? (
              <Row key={t.id} icon={Wrench} ti="ti-tool" label={
                <input autoFocus value={editing.label} maxLength={60} aria-label="Tool name"
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setEditing(null); }}
                  style={{ width: '100%', fontFamily: C.font, fontSize: 14, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.ink, boxSizing: 'border-box' }} />
              } right={
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" onClick={rename} aria-label="Save name" style={{ ...iconBtn, color: C.brand }}><Ico lucide={Check} ti="ti-check" size={15} /></button>
                  <button type="button" onClick={() => setEditing(null)} aria-label="Cancel" style={iconBtn}><Ico lucide={X} ti="ti-x" size={15} /></button>
                </div>
              } />
            ) : (
              <Row key={t.id} icon={Wrench} ti="ti-tool" label={t.label} muted={t.status !== 'active'}
                sublabel={[t.goal, t.uses ? `used ${t.uses}×` : 'not used yet', t.lastUsedAt ? `last ${when(t.lastUsedAt)}` : null, t.status !== 'active' ? 'off' : null].filter(Boolean).join(' · ')}
                right={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Toggle on={t.status === 'active'} onChange={() => toggle(t)} label={`${t.status === 'active' ? 'Turn off' : 'Turn on'} ${t.label}`} />
                    <button type="button" onClick={() => setEditing({ id: t.id, label: t.label })} aria-label={`Rename ${t.label}`} style={iconBtn}><Ico lucide={Pencil} ti="ti-pencil" size={14} /></button>
                    <button type="button" onClick={() => remove(t)} aria-label={`Delete ${t.label}`} style={iconBtn}><Ico lucide={Trash2} ti="ti-trash" size={14} /></button>
                  </div>
                } />
            ))}
          {err && <div style={{ padding: '8px 16px 12px', fontSize: 12, color: RED, fontFamily: C.font }}>{err}</div>}
        </Section>

        {requests.length > 0 && (
          <Section title="Permission requests">
            {requests.map((r) => {
              const s = REQUEST_STATUS[r.status] || REQUEST_STATUS.new;
              const waiting = ['new', 'under_review'].includes(r.status);
              return (
                <Row key={r.id} icon={s.icon} ti={s.ti} label={r.label || r.permission}
                  sublabel={[s.text, r.note, `asked ${when(r.createdAt)}`].filter(Boolean).join(' · ')}
                  right={waiting && (
                    <button type="button" onClick={() => withdraw(r)} style={{ fontSize: 12, fontFamily: C.font, fontWeight: 600, padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, cursor: 'pointer' }}>
                      Withdraw
                    </button>
                  )} />
              );
            })}
          </Section>
        )}
      </div>
    </PageLayout>
  );
}
