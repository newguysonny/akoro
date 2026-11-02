/**
 * Proactive kinds — watch-only mode for the agent's proactive work
 * (Grand Plan Phase 18 item 1).
 *
 * Each kind of suggestion the agent can bring a learner (or an instructor)
 * has a mode: Off · Observe (the agent only records what it would have
 * proposed, and why — the learner sees nothing and nothing is charged) ·
 * Live. A scope can give a list of learners or one school a different mode
 * (e.g. live for one school while everyone else is observed). Every switch is
 * recorded with who and when.
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Eye, History, Power, RefreshCw, Radio, XCircle } from 'lucide-react';

import { PageLayout } from '../components/Layout.jsx';
import { Btn, Inp, Modal, Sel, Skeleton, Toast } from '../components/Primitives.jsx';
import { confirmDialog } from '../components/ConfirmHost.jsx';
import { apiGet, apiPatch } from '../services/api.js';
import { AMBER, BLUE, BORDER, FONT, GREEN, INK, LIGHT, MUTED, MUTED2, RED, WHITE } from '../constants.js';

const unwrap = (d) => d?.data ?? d;
const when = (v) => (v ? new Date(v).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const MODES = {
  off: { label: 'Off', color: MUTED, bg: LIGHT, icon: Power },
  observe: { label: 'Observe', color: BLUE, bg: '#EFF6FF', icon: Eye },
  live: { label: 'Live', color: GREEN, bg: '#ECFDF5', icon: Radio },
};
const card = { background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18, marginBottom: 18 };
const th = { textAlign: 'left', fontFamily: FONT, fontSize: 11, fontWeight: 700, color: MUTED, padding: '8px 10px', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap' };
const td = { fontFamily: FONT, fontSize: 13, color: INK, padding: '10px', borderBottom: `1px solid ${BORDER}`, verticalAlign: 'top' };
const ids = (text) => String(text || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

function ModePill({ mode }) {
  const m = MODES[mode] || MODES.observe;
  const Icon = m.icon;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: m.bg, color: m.color, fontFamily: FONT, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
    <Icon size={12} /> {m.label}
  </span>;
}

function EditModal({ kind, onClose, onSaved, setToast }) {
  const [mode, setMode] = useState(kind.mode);
  const [scopeMode, setScopeMode] = useState(kind.scope?.mode || '');
  const [users, setUsers] = useState((kind.scope?.userIds || []).join(', '));
  const [school, setSchool] = useState((kind.scope?.schoolIds || [])[0] || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const scope = scopeMode ? { mode: scopeMode, userIds: ids(users), schoolIds: school.trim() ? [school.trim()] : [] } : null;
    const goingLive = mode === 'live' && kind.mode !== 'live';
    const ok = await confirmDialog({
      title: `Set ${kind.kind} to ${MODES[mode].label}?`,
      message: goingLive
        ? 'Learners will start receiving this kind of suggestion. The change is recorded with your name.'
        : 'The change is recorded with your name.',
      confirmLabel: 'Save',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await apiPatch(`/api/admin/proactive-kinds/${kind.kind}`, { mode, scope, note: note.trim() || null });
      setToast({ type: 'success', message: `${kind.kind}: saved.` });
      onSaved();
    } catch (e) { setToast({ type: 'error', message: e.message || 'Could not save.' }); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Mode: ${kind.kind}`} width={560}>
      <Sel label="Mode for everyone" value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="off">Off — never proposed</option>
        <option value="observe">Observe — recorded only, never shown or charged</option>
        <option value="live">Live — proposed to the learner</option>
      </Sel>
      <div style={{ height: 12 }} />
      <Sel label="Scope (optional) — a different mode for some learners or one school" value={scopeMode} onChange={(e) => setScopeMode(e.target.value)}>
        <option value="">No scope</option>
        <option value="off">Off for the scope</option>
        <option value="observe">Observe for the scope</option>
        <option value="live">Live for the scope</option>
      </Sel>
      {scopeMode && <>
        <div style={{ height: 12 }} />
        <Inp label="Learner ids (comma or space separated)" value={users} onChange={(e) => setUsers(e.target.value)} placeholder="uuid, uuid" />
        <div style={{ height: 12 }} />
        <Inp label="School id (one)" value={school} onChange={(e) => setSchool(e.target.value)} placeholder="uuid" />
      </>}
      <div style={{ height: 12 }} />
      <Inp label="Note (why)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. observed for two weeks, acceptance looks good" />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={busy}>Save</Btn>
      </div>
    </Modal>
  );
}

function Observations({ kind, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    apiGet(`/api/admin/proactive-kinds/${kind}/observations?limit=100`).then((d) => setData(unwrap(d))).catch((e) => setErr(e.message || 'Could not load.'));
  }, [kind]);
  return (
    <Modal open onClose={onClose} title={`What ${kind} would have proposed`} width={900}>
      {err && <div style={{ color: RED, fontFamily: FONT, fontSize: 13 }}>{err}</div>}
      {!data && !err && <Skeleton height={120} />}
      {data && (data.observations.length === 0
        ? <div style={{ fontFamily: FONT, fontSize: 13, color: MUTED }}>No observe records yet.</div>
        : <div style={{ maxHeight: 420, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>When</th><th style={th}>Who</th><th style={th}>Would have proposed</th><th style={th}>Because</th><th style={th}>Later, live</th></tr></thead>
            <tbody>{data.observations.map((o) => (
              <tr key={o.id}>
                <td style={td}>{when(o.created_at)}</td>
                <td style={td}>{o.who || String(o.user_id).slice(0, 8)}</td>
                <td style={td}>{o.title}</td>
                <td style={{ ...td, color: MUTED }}>{o.reason || '—'}</td>
                <td style={td}>{o.acceptedLater
                  ? <span style={{ color: GREEN, display: 'inline-flex', gap: 4, alignItems: 'center' }}><CheckCircle2 size={13} /> accepted</span>
                  : o.similarLater ? <span style={{ color: AMBER, display: 'inline-flex', gap: 4, alignItems: 'center' }}><XCircle size={13} /> proposed, not accepted</span>
                    : <span style={{ color: MUTED2 }}>—</span>}</td>
              </tr>))}</tbody>
          </table>
        </div>)}
      {data?.history?.length > 0 && <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: FONT, fontSize: 13, fontWeight: 700, color: INK, margin: '16px 0 8px' }}><History size={14} /> Switches</div>
        {data.history.map((h, i) => (
          <div key={i} style={{ fontFamily: FONT, fontSize: 12, color: MUTED, marginBottom: 4 }}>
            {when(h.changed_at)} · {h.changed_by_label || 'admin'} · {h.before?.mode || 'default'} → {h.after?.mode}{h.after?.scope_mode ? ` (scope: ${h.after.scope_mode})` : ''}{h.note ? ` — ${h.note}` : ''}
          </div>))}
      </>}
    </Modal>
  );
}

export default function ProactiveKindsPage() {
  const [kinds, setKinds] = useState(null);
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(async () => {
    try { setKinds(unwrap(await apiGet('/api/admin/proactive-kinds')).kinds || []); }
    catch (e) { setToast({ type: 'error', message: e.message || 'Could not load kinds.' }); setKinds((k) => k || []); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const section = (audience, title) => {
    const rows = (kinds || []).filter((k) => k.audience === audience);
    return (
      <div style={card}>
        <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: INK, marginBottom: 12 }}>{title}</div>
        {!kinds ? <Skeleton height={120} /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Kind</th><th style={th}>Mode</th><th style={th}>Scope</th>
                <th style={th}>Observed 30d</th><th style={th}>Proposed 30d</th><th style={th}>Accepted</th><th style={th}>Dismissed</th>
                <th style={th}>Last change</th><th style={th} />
              </tr></thead>
              <tbody>{rows.map((k) => (
                <tr key={k.kind}>
                  <td style={{ ...td, fontWeight: 600 }}>{k.kind}{!k.existing && <span style={{ color: AMBER, fontSize: 11, marginLeft: 6 }}>new</span>}</td>
                  <td style={td}><ModePill mode={k.mode} /></td>
                  <td style={td}>{k.scope ? <span><ModePill mode={k.scope.mode} /> <span style={{ color: MUTED, fontSize: 12 }}>
                    {k.scope.userIds.length ? `${k.scope.userIds.length} learner${k.scope.userIds.length === 1 ? '' : 's'}` : ''}{k.scope.userIds.length && k.scope.schoolIds.length ? ' · ' : ''}{k.scope.schoolIds.length ? 'a school' : ''}</span></span> : <span style={{ color: MUTED2 }}>—</span>}</td>
                  <td style={td}>{k.counts.observed30d}</td>
                  <td style={td}>{k.counts.proposed30d}</td>
                  <td style={td}>{k.counts.accepted30d}</td>
                  <td style={td}>{k.counts.dismissed30d}</td>
                  <td style={{ ...td, color: MUTED, fontSize: 12 }}>{k.updatedBy ? `${k.updatedBy} · ${when(k.updatedAt)}` : (k.stored ? when(k.updatedAt) : 'default')}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <Btn variant="secondary" size="sm" onClick={() => setViewing(k.kind)}><Eye size={13} /> Records</Btn>{' '}
                    <Btn size="sm" onClick={() => setEditing(k)}>Change</Btn>
                  </td>
                </tr>))}</tbody>
            </table>
          </div>)}
      </div>
    );
  };

  return (
    <PageLayout title="Proactive kinds" subtitle="Off · Observe · Live for each kind of suggestion the agent brings — observe records what it would have proposed, and why"
      action={<Btn variant="secondary" size="sm" onClick={load}><RefreshCw size={14} /> Refresh</Btn>}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      <div style={{ maxWidth: 1220, margin: '0 auto' }}>
        {section('learner', 'Learner suggestions')}
        {section('instructor', 'Instructor suggestions')}
      </div>
      {editing && <EditModal kind={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} setToast={setToast} />}
      {viewing && <Observations kind={viewing} onClose={() => setViewing(null)} />}
    </PageLayout>
  );
}
