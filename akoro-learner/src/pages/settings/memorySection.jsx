/*
 * MemorySection — Settings → Agent → Memory (Grand Plan §7.16.6, D47/D50):
 * what the agent remembers about this learner, each note forgettable, and the
 * "Learn from my conversations" switch. After a chat goes quiet the agent
 * notes what helps it help them next time — never health, feelings, money or
 * contact details. Memory shapes what the agent says; it never moves scores.
 */
import { useEffect, useState } from 'react';
import { Section, Row, Toggle } from './shared.jsx';
import { apiGet, apiPatch, apiDelete } from '../../services/api.js';
import { confirmDialog } from '../../components/common/ConfirmHost.jsx';

const NUNITO = "'Nunito',sans-serif";
const when = (iso) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' }) : null);
const KIND = {
  study_preference: { icon: 'ti-bulb', label: 'How you like to learn' },
  learner_goal: { icon: 'ti-target', label: 'Your goal' },
  fact_about_me: { icon: 'ti-user', label: 'About you' },
  open_thread: { icon: 'ti-clock', label: 'To come back to' },
  learning_summary: { icon: 'ti-notebook', label: 'What you studied' },
};
const SHOWN = 12;

export default function MemorySection() {
  const [settings, setSettings] = useState(null);   // { learnFromChats, agentOnline }
  const [memories, setMemories] = useState(null);
  const [all, setAll] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiGet('/api/agent-memory/v1/settings').then(setSettings).catch(() => setSettings(null));
    apiGet('/api/agent-memory/v1/memories').then((d) => setMemories(d?.memories || [])).catch(() => setMemories([]));
  }, []);

  if (!settings && !memories) return null;

  const toggleLearning = async () => {
    const next = !(settings?.learnFromChats !== false);
    const before = settings;
    setErr('');
    setSettings((s) => ({ ...(s || {}), learnFromChats: next }));
    try { await apiPatch('/api/agent-memory/v1/settings', { learnFromChats: next }); }
    catch (e) { setSettings(before); setErr(e?.message || 'Could not save that.'); }
  };
  const forget = async (m) => {
    const before = memories;
    setErr('');
    setMemories((list) => list.filter((x) => x.id !== m.id));
    try { await apiDelete(`/api/agent-memory/v1/memories/${m.id}`); }
    catch (e) { setMemories(before); setErr(e?.message || 'Could not forget that.'); }
  };
  const forgetAll = async () => {
    if (!(await confirmDialog({ title: 'Forget everything?', message: 'Your agent will forget all of these notes. Your chats stay as they are.', confirmLabel: 'Forget all', danger: true }))) return;
    const before = memories;
    setErr('');
    setMemories([]);
    try { await apiDelete('/api/agent-memory/v1/memories'); }
    catch (e) { setMemories(before); setErr(e?.message || 'Could not forget them.'); }
  };

  const learning = settings?.learnFromChats !== false;
  const list = memories || [];
  const shown = all ? list : list.slice(0, SHOWN);
  return (
    <Section title="Memory">
      {!learning && (
        <div style={{ padding: '10px 14px 0', fontSize: 12, color: 'var(--ak-text-muted)', fontFamily: NUNITO, lineHeight: 1.5 }}>
          Learning from your conversations is off — what's here stays until you forget it.
        </div>
      )}
      {list.length === 0 ? (
        <div style={{ padding: '12px 14px', fontSize: 12.5, color: 'var(--ak-text-muted)', fontFamily: NUNITO, lineHeight: 1.5 }}>
          Nothing remembered yet. What your agent notes about how you learn, your goals and what you meant to come back to shows up here.
        </div>
      ) : shown.map((m) => {
        const k = KIND[m.kind] || KIND.learning_summary;
        return (
          <Row key={m.id} icon={k.icon} label={m.content} sub={[k.label, m.subject, when(m.updatedAt || m.createdAt)].filter(Boolean).join(' · ')} noArrow>
            <button type="button" onClick={() => forget(m)} aria-label={`Forget: ${m.content}`} title="Forget this"
              style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}>
              <span className="ti ti-trash" style={{ fontSize: 14, color: 'var(--ak-text-muted)' }} />
            </button>
          </Row>
        );
      })}
      {list.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px 12px', gap: 8 }}>
          {list.length > SHOWN
            ? <button type="button" onClick={() => setAll((v) => !v)} style={{ fontSize: 12, fontFamily: NUNITO, fontWeight: 700, padding: 0, border: 'none', background: 'none', color: 'var(--ak-text-sub)', cursor: 'pointer' }}>{all ? 'Show fewer' : `Show all (${list.length})`}</button>
            : <span/>}
          <button type="button" onClick={forgetAll}
            style={{ fontSize: 12, fontFamily: NUNITO, fontWeight: 700, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: '#EF4444', cursor: 'pointer' }}>
            Forget everything
          </button>
        </div>
      )}
      {err && <div style={{ padding: '6px 14px 10px', fontSize: 12, color: '#EF4444', fontFamily: NUNITO }}>{err}</div>}
    </Section>
  );
}
