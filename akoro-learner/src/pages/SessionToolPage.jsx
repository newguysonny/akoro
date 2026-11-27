import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../services/api.js';
import { AppShell } from '../components/AppShell.jsx';
import { APP_HOME } from '../config/target.js';
import { BRAND } from '../constants.js';
import SpecView from '../features/agent-chat/components/SpecView.jsx';

/*
 * SessionToolPage — a session (mode) tool's own UI (2026-11-27).
 *
 * The learner opens this from their sessions list on the dashboard. The
 * screen renders the tool's presentation over its live state (SpecView),
 * plus ONE interaction card described by state.ui — what the agent is
 * showing now (say), what it asks (prompt), the input it expects
 * (short | long | none) and the button that submits it. A submission goes
 * to POST /api/self-tooling/tools/:id/session-turn: the model evaluates it
 * under the tool's steer, moves the state through the tool's declared
 * actions, and the reply's state — with the next step's ui — re-renders
 * the screen. The learning happens here, never in the chat.
 */
const NUNITO = "'Nunito',sans-serif";

export default function SessionToolPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const scrollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await apiGet(`/api/self-tooling/tools/${id}/view`, { cache: false });
      setView(d);
    } catch (e) {
      setLoadErr(e?.message || 'Could not load this session.');
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const state = view?.state || null;
  const ui = state?.ui && typeof state.ui === 'object' ? state.ui : null;
  // Tools built before the ui contract have no state.ui — the screen falls
  // back to one generic step card; the session-turn model still drives it.
  const step = ui || { say: '', prompt: 'Continue the session', input: 'long', action: null, button: 'Send' };
  const done = step.input === 'none';

  const submit = useCallback(async (preset) => {
    const value = typeof preset === 'string' ? preset : text;
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const d = await apiPost(`/api/self-tooling/tools/${id}/session-turn`, { text: value, action: step.action || undefined });
      setView((v) => (v ? { ...v, state: d.state } : v));
      setText('');
      requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); });
    } catch (e) {
      setErr(e?.message || 'That step did not go through — try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, done, id, step.action, text]);

  return (
    <AppShell>
      <div style={{ width: '100%', height: '100%', fontFamily: NUNITO, background: 'var(--ak-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ background: 'var(--ak-surface)', borderBottom: '1px solid var(--ak-border)', padding: '14px 18px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => navigate(APP_HOME)} aria-label="Back to sessions"
              style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}>
              <span className="ti ti-chevron-left" style={{ fontSize: 22, color: 'var(--ak-text)' }} />
            </button>
            <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 900, color: 'var(--ak-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {view?.label || 'Session'}
            </span>
          </div>
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 30px' }}>
          {loadErr ? (
            <div style={{ padding: '16px', fontSize: 13.5, fontWeight: 700, color: 'var(--ak-text-muted)', lineHeight: 1.55 }}>{loadErr}</div>
          ) : !view ? (
            <div style={{ padding: '16px', fontSize: 13.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>Loading…</div>
          ) : (
            <>
              {view.presentation ? (
                <SpecView presentation={view.presentation} state={state} rows={null}
                  tool={{ label: view.label, goal: view.goal }} onSend={(m) => submit(m)} />
              ) : null}

              <div style={{ background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 18, padding: 15, marginTop: 12 }}>
                {step.say ? (
                  <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.6, color: 'var(--ak-text)', whiteSpace: 'pre-wrap', marginBottom: step.prompt || !done ? 12 : 0 }}>{step.say}</div>
                ) : null}
                {!done && (
                  <>
                    {step.prompt ? (
                      <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--ak-text)', marginBottom: 8 }}>{step.prompt}</div>
                    ) : null}
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Type here…"
                      rows={step.input === 'short' ? 2 : 6}
                      disabled={busy}
                      style={{ width: '100%', boxSizing: 'border-box', border: '1.5px solid var(--ak-border)', borderRadius: 14, padding: 12, fontFamily: NUNITO, fontSize: 13.5, fontWeight: 600, lineHeight: 1.55, resize: 'vertical', background: 'var(--ak-bg)', color: 'var(--ak-text)' }}
                    />
                  </>
                )}
                {err ? <div style={{ fontSize: 12.5, fontWeight: 700, color: '#B0452F', marginTop: 10, lineHeight: 1.5 }}>{err}</div> : null}
                {done ? (
                  <button onClick={() => navigate(APP_HOME)} disabled={busy}
                    style={{ display: 'block', width: '100%', marginTop: 12, background: BRAND, color: '#fff', border: 'none', fontFamily: NUNITO, fontWeight: 900, fontSize: 14.5, padding: 14, borderRadius: 16, cursor: 'pointer' }}>
                    Back to sessions
                  </button>
                ) : (
                  <button onClick={() => submit()} disabled={busy}
                    style={{ display: 'block', width: '100%', marginTop: 12, background: BRAND, color: '#fff', border: 'none', fontFamily: NUNITO, fontWeight: 900, fontSize: 14.5, padding: 14, borderRadius: 16, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.55 : 1 }}>
                    {busy ? 'Thinking…' : (step.button || 'Send')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
