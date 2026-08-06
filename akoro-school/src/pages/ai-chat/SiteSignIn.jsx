/**
 * SiteSignIn — sign in to the AI assistant from the chat page itself.
 *
 * The chat is served at /ai-chat on the school's own domain, which SHADOWS the
 * school website's own "AI Chat" page — the one that carried the login widget.
 * Anyone who reaches /ai-chat from the site's menu therefore arrives with no
 * hand-off token and, until now, was told to "open the AI assistant from your
 * school website" while standing on it.
 *
 * So the page signs you in where you are. It calls the same gated endpoint the
 * widget calls, takes the hand-off token out of the redirect it returns, and
 * exchanges it in place — no navigation, so there is no query string for a
 * proxy or a trailing-slash redirect to drop.
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { API } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, RED, FONT } from '../../constants.js';

const ROLES = [
  { key: 'student', label: 'Student' },
  { key: 'parent', label: 'Parent' },
  { key: 'teacher', label: 'Teacher' },
  { key: 'admin', label: 'Admin' },
];

export default function SiteSignIn({ onSignedIn }) {
  const [role, setRole] = useState('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return setError('Enter your email address.');
    if (!password) return setError('Enter your password.');
    setBusy(true); setError('');
    try {
      let res;
      try {
        res = await fetch(`${API}/api/school/site/ai-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: window.location.hostname, email: email.trim(), password, role }),
        });
      } catch (netErr) {
        throw new Error(`Could not reach the API at ${API} (${netErr?.message || 'network error'}).`);
      }
      const d = await res.json().catch(() => ({}));
      if (!d?.success) throw new Error(d?.message || 'Sign-in failed. Please check your details.');

      // The endpoint answers with a redirect carrying the hand-off token. We
      // don't need the redirect — only the token — so pull it out and exchange
      // it here. That removes the whole class of "the query string vanished".
      const token = new URL(d.redirect, window.location.origin).searchParams.get('ai');
      if (!token) throw new Error('Sign-in succeeded but no session token came back.');
      await onSignedIn(token);
    } catch (err) {
      setError(err?.message || 'Could not sign in. Please try again.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={card}>
      <div style={{ fontSize: 34, textAlign: 'center' }}>🤖</div>
      <h1 style={{ fontSize: 18, fontWeight: 800, color: INK, textAlign: 'center', margin: '8px 0 4px' }}>
        AI Study Assistant
      </h1>
      <p style={{ fontSize: 12.5, color: MUTED, textAlign: 'center', margin: '0 0 16px', lineHeight: 1.55 }}>
        Sign in with your school account to start chatting.
      </p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {ROLES.map((r) => (
          <button key={r.key} type="button" onClick={() => setRole(r.key)}
            style={{ flex: 1, padding: '8px 4px', borderRadius: 9, cursor: 'pointer', fontFamily: FONT,
              fontSize: 12, fontWeight: 700,
              border: `1.5px solid ${role === r.key ? AMBER : BORDER}`,
              background: role === r.key ? `${AMBER}14` : WHITE,
              color: role === r.key ? AMBER : MUTED }}>
            {r.label}
          </button>
        ))}
      </div>

      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="Email" autoComplete="email" style={input} />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        placeholder="Password" autoComplete="current-password" style={input} />

      {error && <div style={{ fontSize: 12, color: RED, fontWeight: 700, margin: '2px 0 10px' }}>{error}</div>}

      <button type="submit" disabled={busy} style={{ ...primary, opacity: busy ? .7 : 1 }}>
        {busy ? <><Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> Signing in…</> : 'Sign in'}
      </button>

      <p style={{ fontSize: 11, color: MUTED2, textAlign: 'center', margin: '12px 0 0', lineHeight: 1.5 }}>
        Only students, parents, teachers and staff of this school can use its assistant.
      </p>
    </form>
  );
}

const card = { width: '100%', maxWidth: 360, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 18, padding: '26px 24px', fontFamily: FONT, boxShadow: '0 2px 14px rgba(0,0,0,.05)' };
const input = { width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10, border: `1.5px solid ${BORDER}`, fontSize: 13.5, fontFamily: FONT, color: INK, background: LIGHT, marginBottom: 10, outline: 'none' };
const primary = { width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '12px', borderRadius: 11, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: FONT };
