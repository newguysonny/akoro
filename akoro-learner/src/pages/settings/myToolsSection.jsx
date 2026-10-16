/*
 * MyToolsSection — Settings → Agent → My tools: the tools this learner's agent
 * built for them (self-tooling). Shows what each does in plain words, never
 * how it was built. Turn off / on, delete. Hidden when self-tooling is off.
 */
import { useEffect, useState } from 'react';
import { Section, Row, Toggle } from './shared.jsx';
import { apiGet, apiPatch } from '../../services/api.js';
import { confirmDialog } from '../../components/common/ConfirmHost.jsx';

const NUNITO = "'Nunito',sans-serif";
const when = (iso) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' }) : null);

export default function MyToolsSection() {
  const [state, setState] = useState(null);   // { enabled, tools }
  const [err, setErr] = useState('');

  useEffect(() => {
    apiGet('/api/self-tooling/tools').then((d) => setState(d?.data || d)).catch(() => setState({ enabled: false, tools: [] }));
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

  return (
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
  );
}
