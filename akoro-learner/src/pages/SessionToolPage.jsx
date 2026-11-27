import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../services/api.js';
import { AppShell } from '../components/AppShell.jsx';
import { APP_HOME } from '../config/target.js';
import { BRAND } from '../constants.js';
import SpecView from '../features/agent-chat/components/SpecView.jsx';
import FortizoChatComposer from '../components/common/FortizoChatComposer.jsx';

/*
 * SessionToolPage — a session (mode) tool's own UI (2026-11-27).
 *
 * The learner opens this from their sessions list on the dashboard. The
 * screen is the session's own home: the tool's presentation over its
 * state at the top (the overview — hero, stepper, key points), then a
 * CHAT with the tutor — a real conversation, per the approved planning
 * preview — with the app's composer at the bottom. Each message goes to
 * POST /api/self-tooling/tools/:id/session-turn: the model replies as
 * the tutor under the tool's steer, moves the state through the tool's
 * declared actions, and the exchange is appended to state.transcript so
 * the conversation, like the progress, persists and resumes here. The
 * learning happens in this chat, never in the main Agent chat.
 */
const NUNITO = "'Nunito',sans-serif";

/** { phase, done, total } from the state's largest checklist — mirrors the server's sessionSummary. */
function summarize(state) {
  if (!state || typeof state !== 'object') return null;
  let best = null;
  for (const v of Object.values(state)) {
    if (!Array.isArray(v) || !v.length) continue;
    if (!v.every((i) => i && typeof i === 'object' && typeof i.state === 'string')) continue;
    if (!best || v.length > best.total) {
      best = { total: v.length, done: v.filter((i) => !['todo', 'hidden', 'pending', ''].includes(i.state)).length };
    }
  }
  const phase = typeof state.phase === 'string' && state.phase ? state.phase : null;
  return best || phase ? { phase, ...(best || { done: 0, total: 0 }) } : null;
}

export default function SessionToolPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pending, setPending] = useState('');
  const scrollRef = useRef(null);
  const firstPaint = useRef(true);

  const load = useCallback(async () => {
    try {
      const d = await apiGet(`/api/self-tooling/tools/${id}/view`, { cache: false });
      setView(d?.data || d);
    } catch (e) {
      setLoadErr(e?.message || 'Could not load this session.');
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const state = view?.state || null;
  const ui = state?.ui && typeof state.ui === 'object' ? state.ui : null;
  const finished = ui?.input === 'none';
  const summary = summarize(state);
  const phaseLabel = summary?.phase ? summary.phase.charAt(0).toUpperCase() + summary.phase.slice(1) : null;

  // The conversation: the persisted transcript; tools built before it
  // existed open on their current step's say as the first tutor message.
  const persisted = Array.isArray(state?.transcript) ? state.transcript : null;
  const transcript = persisted && persisted.length
    ? persisted
    : (ui?.say ? [{ role: 'agent', text: ui.say }] : []);
  const shown = pending ? [...transcript, { role: 'learner', text: pending }] : transcript;

  // Keep the newest message in view after a send; the first paint opens
  // at the overview.
  useEffect(() => {
    if (firstPaint.current) { firstPaint.current = false; return; }
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [shown.length, busy]);

  const send = useCallback(async (preset) => {
    const value = (typeof preset === 'string' ? preset : text).trim();
    if (!value || busy || finished) return;
    setBusy(true); setErr(''); setPending(value); setText('');
    try {
      const d = await apiPost(`/api/self-tooling/tools/${id}/session-turn`, { text: value, action: ui?.action || undefined });
      const out = d?.data || d;
      setView((v) => (v ? { ...v, state: out.state } : v));
    } catch (e) {
      setErr(e?.message || 'That message did not go through — try again.');
    } finally {
      setPending(''); setBusy(false);
    }
  }, [busy, finished, id, text, ui?.action]);

  const barText = ui?.bar
    || (phaseLabel ? `${phaseLabel}${summary?.total ? ` · ${summary.done} of ${summary.total}` : ''}` : '');

  return (
    <AppShell>
      <div style={{ width: '100%', height: '100%', fontFamily: NUNITO, background: 'var(--ak-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ background: 'var(--ak-surface)', borderBottom: '1px solid var(--ak-border)', padding: '12px 18px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => navigate(APP_HOME)} aria-label="Back to sessions"
              style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}>
              <span className="ti ti-chevron-left" style={{ fontSize: 22, color: 'var(--ak-text)' }} />
            </button>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 16, fontWeight: 900, color: 'var(--ak-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {view?.label || 'Session'}
              </span>
              {phaseLabel ? (
                <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)' }}>
                  {phaseLabel}{summary?.total ? ` · ${summary.done} of ${summary.total}` : ''}
                </span>
              ) : null}
            </span>
          </div>
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 18px' }}>
          {loadErr ? (
            <div style={{ padding: '16px', fontSize: 13.5, fontWeight: 700, color: 'var(--ak-text-muted)', lineHeight: 1.55 }}>{loadErr}</div>
          ) : !view ? (
            <div style={{ padding: '16px', fontSize: 13.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>Loading…</div>
          ) : (
            <>
              {view.presentation ? (
                <SpecView presentation={view.presentation} state={state} rows={null}
                  tool={{ label: view.label, goal: view.goal }} onSend={(m) => send(m)} />
              ) : null}

              {barText ? (
                <div style={{ marginTop: 14, background: '#F3F1FF', borderRadius: 12, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`ti ${summary?.phase === 'recall' ? 'ti-lock' : 'ti-sparkles'}`} style={{ fontSize: 14, color: BRAND }} />
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#4A2FBF' }}>{barText}</span>
                </div>
              ) : null}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
                {shown.map((m, i) => m.role === 'learner' ? (
                  <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '82%', background: BRAND, color: '#fff', padding: '10px 13px', borderRadius: 18, borderBottomRightRadius: 6, fontSize: 13.5, lineHeight: 1.45, fontWeight: 600, whiteSpace: 'pre-wrap' }}>
                    {m.text}
                  </div>
                ) : (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', maxWidth: '88%' }}>
                    <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#8B5CFF,#6C3BFF)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span className="ti ti-sparkles" style={{ fontSize: 14, color: '#fff' }} />
                    </span>
                    <div style={{ background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', padding: '10px 13px', borderRadius: 18, borderBottomLeftRadius: 6, fontSize: 13.5, lineHeight: 1.45, fontWeight: 600, color: 'var(--ak-text)', whiteSpace: 'pre-wrap' }}>
                      {m.text}
                    </div>
                  </div>
                ))}
                {busy ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#8B5CFF,#6C3BFF)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span className="ti ti-sparkles" style={{ fontSize: 14, color: '#fff' }} />
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>Thinking…</span>
                  </div>
                ) : null}
              </div>

              {err ? <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-muted)', marginTop: 12, lineHeight: 1.5 }}>{err}</div> : null}

              {finished ? (
                <button onClick={() => navigate(APP_HOME)}
                  style={{ display: 'block', width: '100%', marginTop: 16, background: BRAND, color: '#fff', border: 'none', fontFamily: NUNITO, fontWeight: 900, fontSize: 14.5, padding: 14, borderRadius: 16, cursor: 'pointer' }}>
                  Back to sessions
                </button>
              ) : null}
            </>
          )}
        </div>

        {view && !finished ? (
          <div style={{ flexShrink: 0, padding: '8px 12px 12px', background: 'var(--ak-bg)' }}>
            <FortizoChatComposer
              value={text}
              onChange={setText}
              onSend={() => send()}
              placeholder={ui?.prompt || 'Message…'}
              disabled={busy}
              running={busy}
              hideModelMenu
            />
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
