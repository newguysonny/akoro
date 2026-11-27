/*
 * MyToolsSection — Settings → Agent → My tools: the tools this learner's agent
 * built for them (self-tooling). Shows what each does in plain words, never
 * how it was built. Turn off / on, delete. Domain tools (one tool per kind of
 * data, with actions under it) open into their own view: the domain's switch,
 * and every action with its own switch and delete — the same nesting the rest
 * of Settings uses. Below them, permissions the agent asked an admin for (and
 * can withdraw while they wait). Hidden when self-tooling is off.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Section, Row, Toggle } from './shared.jsx';
import { apiGet, apiPatch, apiPost } from '../../services/api.js';
import { APP_HOME } from '../../config/target.js';
import SpecView from '../../features/agent-chat/components/SpecView.jsx';
import { confirmDialog } from '../../components/common/ConfirmHost.jsx';

const NUNITO = "'Nunito',sans-serif";
const when = (iso) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' }) : null);

/* Plain words for an action — the learner never sees by_subject & friends. */
const words = (s) => String(s || '').replace(/_/g, ' ');
function actionText(a) {
  if (a === 'count') return { label: 'Count', sub: 'How many there are' };
  if (a === 'list') return { label: 'List', sub: 'See them one by one' };
  if (a === 'search') return { label: 'Search', sub: 'Find by text' };
  if (a.startsWith('by_')) { const f = words(a.slice(3)); return { label: `Group by ${f}`, sub: `Split the answer per ${f}` }; }
  if (a.startsWith('sum_')) { const f = words(a.slice(4)); return { label: `Total ${f}`, sub: `Add up the ${f}` }; }
  if (a.startsWith('max_')) { const f = words(a.slice(4)); return { label: `Highest ${f}`, sub: `The biggest ${f}` }; }
  if (a.startsWith('min_')) { const f = words(a.slice(4)); return { label: `Lowest ${f}`, sub: `The smallest ${f}` }; }
  return { label: words(a), sub: '' };
}
const isDomain = (t) => !!t?.domain && Array.isArray(t?.actions) && t.actions.length > 0;
const usesLine = (t) => [t.uses ? `used ${t.uses}×` : null, t.lastUsedAt ? `last ${when(t.lastUsedAt)}` : null].filter(Boolean).join(' · ');

export default function MyToolsSection() {
  const [state, setState] = useState(null);   // { enabled, tools }
  const [err, setErr] = useState('');
  const [requests, setRequests] = useState([]);
  const [openId, setOpenId] = useState(null); // the domain tool being looked inside
  const [viewId, setViewId] = useState(null); // the tool whose own tab (SpecView) is open
  const [view, setView] = useState(null);     // its /tools/:id/view payload
  const navigate = useNavigate();
  const [sheet, setSheet] = useState(false);  // the open domain's ⋮ menu
  const [renaming, setRenaming] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');

  useEffect(() => {
    apiGet('/api/self-tooling/tools').then((d) => setState(d?.data || d)).catch(() => setState({ enabled: false, tools: [] }));
    apiGet('/api/self-tooling/requests').then((d) => setRequests((d?.data || d)?.requests || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!viewId) { setView(null); return; }
    let live = true;
    apiGet(`/api/self-tooling/tools/${viewId}/view`).then((d) => { if (live) setView(d?.data || d); }).catch(() => { if (live) setView({ error: true }); });
    return () => { live = false; };
  }, [viewId]);

  if (!state?.enabled) return null;

  const patch = async (id, body, optimistic) => {
    const before = state.tools;
    setErr('');
    if (optimistic) setState((s) => ({ ...s, tools: optimistic(s.tools) }));
    try {
      const d = await apiPatch(`/api/self-tooling/tools/${id}`, body);
      const t = d?.data || d;
      if (t && t.id) setState((s) => ({ ...s, tools: s.tools.map((x) => (x.id === t.id ? { ...x, ...t } : x)) }));
      return t || null;
    } catch (e) { setState((s) => ({ ...s, tools: before })); setErr(e?.message || 'Could not save that.'); return null; }
  };
  const flipTool = (t) => patch(t.id, { status: t.status === 'active' ? 'disabled' : 'active' },
    (list) => list.map((x) => (x.id === t.id ? { ...x, status: x.status === 'active' ? 'disabled' : 'active' } : x)));
  const remove = async (t) => {
    const dom = isDomain(t);
    const names = dom ? t.actions.map((a) => actionText(a).label).join(', ') : '';
    if (!(await confirmDialog({
      title: `Delete "${t.label}"?`,
      message: dom
        ? `Deleting this domain removes all ${t.actions.length} of its actions — ${names}. Your agent can build them again if you ask.`
        : 'Your agent will stop using this tool. It can build it again if you ask.',
      confirmLabel: 'Delete', danger: true,
    }))) return;
    await patch(t.id, { delete: true }, (list) => list.filter((x) => x.id !== t.id));
    if (openId === t.id) { setOpenId(null); setSheet(false); }
  };

  const flipAction = (t, a) => {
    const off = (t.disabledActions || []).includes(a);
    patch(t.id, { action: a, actionStatus: off ? 'active' : 'disabled' },
      (list) => list.map((x) => (x.id === t.id
        ? { ...x, disabledActions: off ? (x.disabledActions || []).filter((y) => y !== a) : [...(x.disabledActions || []), a] }
        : x)));
  };
  const removeAction = async (t, a) => {
    const at = actionText(a);
    const last = t.actions.length === 1;
    if (!(await confirmDialog({
      title: `Delete "${at.label}"?`,
      message: last
        ? `This is the domain's last action — deleting it deletes "${t.label}" too. Your agent can build it again if you ask.`
        : 'Your agent will stop using this action. It can build it again if you ask.',
      confirmLabel: 'Delete', danger: true,
    }))) return;
    const t2 = await patch(t.id, { deleteAction: a },
      (list) => list.map((x) => (x.id === t.id
        ? { ...x, actions: x.actions.filter((y) => y !== a), disabledActions: (x.disabledActions || []).filter((y) => y !== a) }
        : x)));
    if (t2?.status === 'archived') { setOpenId(null); setState((s) => ({ ...s, tools: s.tools.filter((x) => x.id !== t.id) })); }
  };

  const withdraw = async (r) => {
    if (!(await confirmDialog({ title: 'Withdraw this request?', message: 'Your agent will stop waiting for permission. You can ask again later.', confirmLabel: 'Withdraw' }))) return;
    try {
      await apiPost(`/api/self-tooling/requests/${r.id}/cancel`, {});
      setRequests((list) => list.map((x) => (x.id === r.id ? { ...x, status: 'declined', note: 'Withdrawn' } : x)));
    } catch (e) { setErr(e?.message || 'Could not withdraw that.'); }
  };

  const open = state.tools.find((t) => t.id === openId && isDomain(t)) || null;

  const trashBtn = (t) => (
    <button type="button" onClick={() => remove(t)} aria-label={`Delete ${t.label}`}
      style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
      <span className="ti ti-trash" style={{ fontSize: 14, color: 'var(--ak-text-muted)' }} />
    </button>
  );

  const viewTool = viewId ? state.tools.find((t) => t.id === viewId) || null : null;
  // A tool tab's call-to-action sends its message in the chat: stash it and
  // go to the agent tab, which sends it as the learner on arrival.
  const sendFromTool = (text) => {
    if (!text) return;
    try { sessionStorage.setItem('akoro_cta_message', text); } catch { /* private mode */ }
    navigate(`${APP_HOME}?tab=agent`);
  };

  return (
    <>
    {viewTool ? (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px 10px' }}>
        <button type="button" onClick={() => setViewId(null)} aria-label="Back to my tools"
          style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}>
          <span className="ti ti-chevron-left" style={{ fontSize: 20, color: 'var(--ak-text)' }} />
        </button>
        <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 900, fontFamily: NUNITO, color: 'var(--ak-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{viewTool.label}</span>
        <Toggle on={viewTool.status === 'active'} onChange={() => flipTool(viewTool)} />
      </div>
      <div style={{ padding: '0 2px 6px' }}>
        {view?.presentation ? (
          <SpecView presentation={view.presentation} state={view.state || null} rows={view.rows || null}
            tool={{ label: view.label || viewTool.label, goal: view.goal || viewTool.goal }} onSend={sendFromTool} />
        ) : (
          <div style={{ padding: '12px 14px', fontSize: 12.5, color: 'var(--ak-text-muted)', fontFamily: NUNITO, lineHeight: 1.5 }}>
            {view ? 'This tool has no page of its own yet — ask your agent in the chat to run it.' : 'Loading…'}
          </div>
        )}
      </div>
      {err && <div style={{ padding: '6px 14px 10px', fontSize: 12, color: '#EF4444', fontFamily: NUNITO }}>{err}</div>}
    </>
    ) : open ? (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px 10px' }}>
        <button type="button" onClick={() => { setOpenId(null); setRenaming(false); }} aria-label="Back to my tools"
          style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}>
          <span className="ti ti-chevron-left" style={{ fontSize: 20, color: 'var(--ak-text)' }} />
        </button>
        {renaming ? (
          <>
            <input value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} autoFocus maxLength={60}
              style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 800, fontFamily: NUNITO, color: 'var(--ak-text)', border: '1.5px solid var(--ak-border2)', borderRadius: 10, padding: '6px 10px', background: 'var(--ak-surface)' }} />
            <button type="button"
              onClick={async () => { const v = draftLabel.trim(); if (v.length >= 2) { await patch(open.id, { label: v }, (list) => list.map((x) => (x.id === open.id ? { ...x, label: v } : x))); } setRenaming(false); }}
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 800, fontFamily: NUNITO, color: 'var(--ak-brand, #6C3BFF)', padding: 4 }}>Save</button>
            <button type="button" onClick={() => setRenaming(false)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: NUNITO, color: 'var(--ak-text-muted)', padding: 4 }}>Cancel</button>
          </>
        ) : (
          <>
            <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 900, fontFamily: NUNITO, color: 'var(--ak-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{open.label}</span>
            <button type="button" onClick={() => setSheet(true)} aria-label={`More options for ${open.label}`}
              style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'var(--ak-surface2, #F1EFF9)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
              <span className="ti ti-dots-vertical" style={{ fontSize: 17, color: 'var(--ak-text-sub)' }} />
            </button>
          </>
        )}
      </div>
      <Section title="Domain">
        <Row icon="ti-tool" label={open.label}
          sub={[`Domain · ${open.actions.length} action${open.actions.length === 1 ? '' : 's'}`, usesLine(open)].filter(Boolean).join(' · ')} noArrow>
          <Toggle on={open.status === 'active'} onChange={() => flipTool(open)} />
        </Row>
      </Section>
      <Section title="Actions">
        {open.actions.map((a) => {
          const at = actionText(a);
          const off = (open.disabledActions || []).includes(a);
          return (
            <Row key={a} icon="ti-tool" label={at.label} sub={at.sub || undefined} noArrow>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: off ? 0.55 : 1 }}>
                <Toggle on={!off} onChange={() => flipAction(open, a)} />
                <button type="button" onClick={() => removeAction(open, a)} aria-label={`Delete ${at.label}`}
                  style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                  <span className="ti ti-trash" style={{ fontSize: 14, color: 'var(--ak-text-muted)' }} />
                </button>
              </div>
            </Row>
          );
        })}
      </Section>
      {err && <div style={{ padding: '6px 14px 10px', fontSize: 12, color: '#EF4444', fontFamily: NUNITO }}>{err}</div>}
      {sheet && (
        <div className="ak-sheet-overlay" onClick={() => setSheet(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(24,20,44,.45)', zIndex: 900, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div className="ak-sheet-panel" onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--ak-surface)', width: '100%', maxWidth: 430, margin: 10, borderRadius: 20, padding: '10px 8px 14px', boxShadow: '0 12px 40px rgba(24,20,44,.25)' }}>
            <div style={{ width: 40, height: 4.5, borderRadius: 99, background: 'var(--ak-border)', margin: '2px auto 6px' }} />
            <button type="button" onClick={() => { setSheet(false); setDraftLabel(open.label); setRenaming(true); }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer', padding: '13px 12px', fontSize: 15, fontWeight: 800, fontFamily: NUNITO, color: 'var(--ak-text)' }}>
              <span className="ti ti-pencil" style={{ fontSize: 17 }} /> Rename domain
            </button>
            <button type="button" onClick={() => { setSheet(false); remove(open); }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer', padding: '13px 12px', fontSize: 15, fontWeight: 800, fontFamily: NUNITO, color: 'var(--ak-text)' }}>
              <span className="ti ti-trash" style={{ fontSize: 17 }} /> Delete domain
            </button>
          </div>
        </div>
      )}
    </>
    ) : (
    <>
    <Section title="My tools">
      {state.tools.length === 0 ? (
        <div style={{ padding: '12px 14px', fontSize: 12.5, color: 'var(--ak-text-muted)', fontFamily: NUNITO, lineHeight: 1.5 }}>
          When you ask your agent something none of its tools can answer, it can build a small tool for you. They'll show up here.
        </div>
      ) : state.tools.map((t) => {
        const dom = isDomain(t);
        return (
        <Row key={t.id} icon="ti-tool" label={t.label}
          sub={dom
            ? [`Domain · ${t.actions.length} action${t.actions.length === 1 ? '' : 's'}`, usesLine(t)].filter(Boolean).join(' · ')
            : [t.mode === 'mode' ? 'Session tool' : null, t.goal, usesLine(t)].filter(Boolean).join(' · ')}
          onClick={dom ? () => setOpenId(t.id) : (t.hasUi ? () => setViewId(t.id) : undefined)} noArrow={!dom && !t.hasUi}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={(e) => e.stopPropagation()}>
            <Toggle on={t.status === 'active'} onChange={() => flipTool(t)} />
            {trashBtn(t)}
          </div>
        </Row>
        );
      })}
      {err && <div style={{ padding: '6px 14px 10px', fontSize: 12, color: '#EF4444', fontFamily: NUNITO }}>{err}</div>}
    </Section>
    {requests.length > 0 && (
      <Section title="Permission requests">
        {requests.map((r) => {
          const s = REQUEST_STATUS[r.status] || REQUEST_STATUS.new;
          const waiting = ['new', 'under_review', 'planned'].includes(r.status);
          return (
            <Row key={r.id} icon={s.icon} label={r.label || r.permission}
              sub={[r.status === 'planned' ? 'Planned by the Akoro team' : s.text, r.note, `asked ${when(r.createdAt)}`].filter(Boolean).join(' · ')} noArrow>
              {waiting && r.status !== 'planned' && (
                <button type="button" onClick={() => withdraw(r)}
                  style={{ fontSize: 12, fontFamily: NUNITO, fontWeight: 700, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text-muted)', cursor: 'pointer' }}>
                  Withdraw
                </button>
              )}
            </Row>
          );
        })}
      </Section>
    )}
    </>
    )}
    </>
  );
}

const REQUEST_STATUS = {
  new:          { icon: 'ti-hourglass', text: 'Waiting for an admin' },
  under_review: { icon: 'ti-hourglass', text: 'Being reviewed' },
  planned:      { icon: 'ti-calendar', text: 'Planned' },
  approved:     { icon: 'ti-circle-check', text: 'Approved — your agent is finishing it' },
  implemented:  { icon: 'ti-circle-check', text: 'Approved — answered in your chat' },
  declined:     { icon: 'ti-circle-x', text: 'Not approved' },
  expired:     { icon: 'ti-clock-x', text: 'Expired without a decision' },
};
