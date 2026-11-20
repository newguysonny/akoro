/**
 * NoAgentSheet — what to show instead of "Create your agent first".
 *
 * Battles are agent vs agent, so the API refuses when you don't have one. That
 * message named something a new learner has never seen and pointed nowhere.
 * This explains it, creates the agent in one tap, and then replays whatever
 * they were trying to do.
 */
import React, { useState } from 'react';
import { BRAND, RED } from '../../../constants.js';
import { Icon } from '../../../components/common/Icons.jsx';
import { DrawnAvatar } from '../../../components/common/AgentAvatar.jsx';
import { API } from '../../../config/urls.js';

// settingsApi's putAgent resolves the body even on a 4xx/5xx, so it cannot tell
// us whether the agent was actually created — and here that difference decides
// whether we replay the battle. So do the call directly and check.

async function createAgent(body) {
  const r = await fetch(`${API}/api/user/agent`, {
    method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = `Could not create your agent (${r.status})`;
    try { const j = await r.json(); msg = j.error || j.message || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

/* Avatar choices — stored as emoji keys, drawn via AgentAvatar (never
   rendered as emoji glyphs). */
const EMOJIS = ['🤖', '🦉', '🧠', '📚', '🔬', '🎓', '⚡', '🌟', '🧭', '🐝'];

/** True when a failure means "no agent yet" rather than a real error. */
export function isNoAgentError(err) {
  const m = (err?.message || '').toLowerCase();
  return m.includes('agent') && (m.includes('no agent') || m.includes('create your agent') || m.includes('set up your agent'));
}

const SHEET = {
  position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 2300,
  background: 'var(--ak-surface)', borderRadius: '22px 22px 0 0',
  padding: '0 20px 48px', boxShadow: '0 -8px 40px rgba(0,0,0,.14)',
  animation: 'sheet-up .3s cubic-bezier(.32,1.2,.64,1)',
  fontFamily: "'Nunito',sans-serif", maxHeight: '86vh', overflowY: 'auto',
};
const FIELD = {
  width: '100%', padding: '11px 14px', borderRadius: 12,
  border: '1.5px solid var(--ak-border2)', background: 'var(--ak-surface-hover)',
  fontSize: 13.5, fontWeight: 600, color: 'var(--ak-text)',
  fontFamily: "'Nunito',sans-serif", outline: 'none', boxSizing: 'border-box',
};

export default function NoAgentSheet({ open, onClose, onCreated, defaultName = 'My Agent' }) {
  const [name, setName]   = useState(defaultName);
  const [emoji, setEmoji] = useState('🤖');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const create = async () => {
    setError(''); setBusy(true);
    try {
      await createAgent({ agent_name: name.trim() || 'My Agent', agent_emoji: emoji });
      await onCreated?.();
      onClose();
    } catch (e) {
      setError(e?.message || 'Could not create your agent. Please try again.');
      setBusy(false);
    }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2200, background: 'rgba(6,6,18,.6)', backdropFilter: 'blur(5px)' }} />
      <div className="ak-bottom-sheet" style={SHEET}>
        <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--ak-border3)', margin: '14px auto 20px' }} />
        <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 6px' }}><Icon name="ti-robot" size={16}/> First, meet your agent</p>
        <p style={{ fontSize: 12.5, color: 'var(--ak-text-muted)', margin: '0 0 20px', lineHeight: 1.55 }}>
          Battles are agent vs agent — yours studies what you study and competes for you.
          You don't have one yet, so let's make it now. It takes a second, and you can
          rename it any time.
        </p>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-sub)', display: 'block', marginBottom: 6, letterSpacing: .3 }}>
            Agent name
          </label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="My Agent" style={FIELD} />
        </div>

        <div style={{ marginBottom: 22 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-sub)', display: 'block', marginBottom: 10, letterSpacing: .3 }}>
            Avatar
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {EMOJIS.map(em => (
                <button key={em} onClick={() => setEmoji(em)} aria-label={`Avatar ${em}`} style={{
                  width: 46, height: 46, borderRadius: 12, cursor: 'pointer',
                  border: `2px solid ${emoji === em ? BRAND : 'var(--ak-border2)'}`,
                  background: emoji === em ? `${BRAND}12` : 'var(--ak-surface-hover)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}><DrawnAvatar emoji={em} size={30}/></button>
              ))}
          </div>
        </div>

        {error && <p style={{ fontSize: 12, fontWeight: 800, color: RED, margin: '0 0 12px' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={busy} style={{
            flex: 1, padding: '13px', borderRadius: 14, border: '1.5px solid var(--ak-border2)',
            background: 'var(--ak-surface-hover)', fontSize: 13, fontWeight: 800,
            color: 'var(--ak-text-sub)', cursor: 'pointer', fontFamily: "'Nunito',sans-serif",
          }}>Not now</button>
          <button onClick={create} disabled={busy || !name.trim()} style={{
            flex: 1.6, padding: '13px', borderRadius: 14, border: 'none',
            background: (busy || !name.trim()) ? 'var(--ak-border2)' : `linear-gradient(135deg,${BRAND},#4C1DCC)`,
            fontSize: 13, fontWeight: 800,
            color: (busy || !name.trim()) ? 'var(--ak-text-muted)' : '#fff',
            cursor: (busy || !name.trim()) ? 'default' : 'pointer',
            fontFamily: "'Nunito',sans-serif",
          }}>{busy ? 'Creating…' : <><Icon name="ti-sparkles" size={12}/> Create my agent</>}</button>
        </div>
      </div>
    </>
  );
}
