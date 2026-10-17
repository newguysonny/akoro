/*
 * MyToolsSection — Settings → Agent → My tools: the tools this learner's agent
 * built for them (self-tooling). Shows what each does in plain words, never
 * how it was built. Turn off / on, delete. Below them, permissions the agent
 * asked an admin for (and can withdraw while they wait). Hidden when
 * self-tooling is off.
 */
import { useEffect, useState } from 'react';
import { Section, Row, Toggle } from './shared.jsx';
import { apiGet, apiPatch, apiPost } from '../../services/api.js';
import { confirmDialog } from '../../components/common/ConfirmHost.jsx';

const NUNITO = "'Nunito',sans-serif";
const when = (iso) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' }) : null);

export default function MyToolsSection() {
  const [state, setState] = useState(null);   // { enabled, tools }
  const [err, setErr] = useState('');
  const [requests, setRequests] = useState([]);

  useEffect(() => {
    apiGet('/api/self-tooling/tools').then((d) => setState(d?.data || d)).catch(() => setState({ enabled: false, tools: [] }));
    apiGet('/api/self-tooling/requests').then((d) => setRequests((d?.data || d)?.requests || [])).catch(() => {});
  }, []);

  if (!state?.enabled) return null;

  const patch = async (id, body, optimistic) => {
    const before = state.tools;
    setErr('');
    setState((s) => ({ ...s, tools: optimistic(s.tools) }));
    try { await apiPatch(`/api/self-tooling/tools/${id}`, body); }
    catch (e) { setState((s) => ({ ...s, tools: before })); setErr(e?.message || 'Could not save that.'); }
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

  return (
    <>
    <Section title="My tools">
      {state.tools.length === 0 ? (
        <div style={{ padding: '12px 14px', fontSize: 12.5, color: 'var(--ak-text-muted)', fontFamily: NUNITO, lineHeight: 1.5 }}>
          When you ask your agent something none of its tools can answer, it can build a small tool for you. They'll show up here.
        </div>
      ) : state.tools.map((t) => (
        <Row key={t.id} icon="ti-tool" label={t.label}
          sub={[t.goal, t.uses ? `used ${t.uses}×` : null, t.lastUsedAt ? `last ${when(t.lastUsedAt)}` : null].filter(Boolean).join(' · ')} noArrow>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Toggle on={t.status === 'active'} onChange={() => patch(t.id, { status: t.status === 'active' ? 'disabled' : 'active' },
              (list) => list.map((x) => (x.id === t.id ? { ...x, status: x.status === 'active' ? 'disabled' : 'active' } : x)))} />
            <button type="button" onClick={() => remove(t)} aria-label={`Delete ${t.label}`}
              style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
              <span className="ti ti-trash" style={{ fontSize: 14, color: 'var(--ak-text-muted)' }} />
            </button>
          </div>
        </Row>
      ))}
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
  );
}

const REQUEST_STATUS = {
  new:          { icon: 'ti-hourglass', text: 'Waiting for an admin' },
  under_review: { icon: 'ti-hourglass', text: 'Being reviewed' },
  planned:      { icon: 'ti-calendar', text: 'Planned' },
  approved:     { icon: 'ti-circle-check', text: 'Approved — your agent is finishing it' },
  implemented:  { icon: 'ti-circle-check', text: 'Approved — answered in your chat' },
  declined:     { icon: 'ti-circle-x', text: 'Not approved' },
  expired:      { icon: 'ti-clock-x', text: 'Expired without a decision' },
};
