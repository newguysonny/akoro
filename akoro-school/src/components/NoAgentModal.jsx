/**
 * NoAgentModal — the dead end this replaces.
 *
 * Tasks and battles both run through your AI agent, so both refuse outright
 * when you don't have one ("Create your agent first"). That message named a
 * thing the user had never heard of and pointed nowhere. This explains what an
 * agent is, creates it on the spot, and then retries whatever they were doing —
 * so a first battle or first task doesn't dead-end on setup.
 *
 * Usage:
 *   const [noAgent, setNoAgent] = useState(null);   // holds the retry callback
 *   ...
 *   catch (e) { if (isNoAgentError(e)) setNoAgent(() => retryFn); else showToast(e.message); }
 *   ...
 *   <NoAgentModal open={!!noAgent} onClose={() => setNoAgent(null)} onCreated={noAgent} />
 */
import { useState, useEffect } from 'react';
import { Sparkles , Bot, Bird, Brain, BookOpen, Microscope, GraduationCap, Zap, Compass, Bug } from 'lucide-react';
import { Btn, Modal, Inp } from './Primitives.jsx';
import { apiPut } from '../services/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { RED } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

/* Icons render; the paired emoji is what agent_emoji stores (cross-app compat). */
const AGENT_ICONS = [[Bot, '🤖', 'ti-robot'], [Bird, '🦉', null], [Brain, '🧠', 'ti-brain'], [BookOpen, '📚', 'ti-book'], [Microscope, '🔬', 'ti-microscope'], [GraduationCap, '🎓', 'ti-school'], [Zap, '⚡', 'ti-bolt'], [Sparkles, '🌟', 'ti-sparkles'], [Compass, '🧭', 'ti-compass'], [Bug, '🐝', 'ti-bug']];

/**
 * True when a failure is "you have no agent yet" rather than a real error.
 * The API says it two different ways, from two different modules, so match on
 * the one word both of them agree on rather than on either exact sentence.
 */
export function isNoAgentError(err) {
  const m = (err?.message || '').toLowerCase();
  return m.includes('agent') && (m.includes('no agent') || m.includes('create your agent') || m.includes('set up your agent'));
}

export default function NoAgentModal({ open, onClose, onCreated, context = 'this' }) {
  const { user } = useAuth();
  const [name, setName]   = useState('');
  const [emoji, setEmoji] = useState('🤖');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError(''); setBusy(false); setEmoji('🤖');
    const first = (user?.full_name || '').trim().split(' ')[0];
    setName(first ? `${first}'s Agent` : 'My Agent');
  }, [open, user]);

  const create = async () => {
    setError(''); setBusy(true);
    try {
      await apiPut('/api/user/agent', { agent_name: name.trim() || 'My Agent', agent_emoji: emoji });
      // Hand control back so the caller can finish what it was doing.
      await onCreated?.();
      onClose();
    } catch (e) {
      setError(e?.message || 'Could not create your agent. Please try again.');
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="First, meet your agent" width={460}>
      <div style={{ fontFamily: C.font }}>
        <div style={{
          display: 'flex', gap: 12, alignItems: 'flex-start',
          background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12,
          padding: '13px 14px', marginBottom: 18,
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Ico ti="ti-sparkles" size={18} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, marginBottom: 3 }}>
              You don't have an AI agent yet
            </div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55 }}>
              Your agent is the assistant that does the work — it runs your scheduled
              tasks and competes on your behalf in battles. {context === 'battle'
                ? 'Every battle is agent vs agent, so you need one before you can challenge anybody.'
                : 'Tasks are handed to it to carry out, so you need one before scheduling work.'}
              {' '}It takes a second to create and you can rename it any time.
            </div>
          </div>
        </div>

        <Inp label="Agent name" value={name} onChange={e => setName(e.target.value)} placeholder="My Agent" />

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.ink, marginBottom: 8 }}>Icon</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {AGENT_ICONS.map(([Icon, em, ti]) => (
              <button
                key={em} type="button" onClick={() => setEmoji(em)} aria-label={`Icon ${em}`}
                style={{
                  width: 40, height: 40, borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `2px solid ${emoji === em ? C.brand : C.border}`,
                  background: emoji === em ? tint(7) : C.surface,
                }}
              ><Ico lucide={Icon} ti={ti} size={19} color={emoji === em ? C.brand : C.muted2} /></button>
            ))}
          </div>
        </div>

        {error && <div style={{ fontSize: 12, color: RED, fontWeight: 700, marginTop: 14 }}>{error}</div>}

        <div style={{ fontSize: 11, color: C.muted2, marginTop: 14, lineHeight: 1.5 }}>
          You can change the name, avatar and personality later in Settings.
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <Btn variant="secondary" type="button" onClick={onClose} disabled={busy}>Not now</Btn>
          <Btn type="button" onClick={create} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : <><Ico ti="ti-sparkles" size={14} /> Create my agent</>}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
