import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { BRAND, INK, MUTED, MUTED2, BORDER, WHITE, RED, FONT } from '../../constants.js';

export default function SigninPage() {
  const { login, loginWithGoogle, error, loading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Google sign-in failures come back as ?error= on a full-page redirect, so
  // they can't surface through the context's error state.
  const urlError = params.get('error');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    try { await login({ email, password }); navigate('/'); } catch { /* error shown via context */ }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB', fontFamily: FONT, padding: 18 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 380, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 26 }}>
        <img src="/kpemu-mark.svg" alt="Kpemu" width={40} height={40} style={{ display: 'block', marginBottom: 10 }} />
        <div style={{ fontSize: 22, fontWeight: 900, color: INK, marginBottom: 4 }}>Kpemu Agent Demo</div>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 20 }}>Sign in to your voucher wallet</div>
        <label style={lbl}>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required style={inp} />
        <label style={lbl}>Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required style={inp} />
        {(error || urlError) && <div style={{ color: RED, fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>{error || (urlError === 'session_expired' ? 'Your session timed out for security. Please sign in again.'
              : urlError === 'google_failed' ? 'Google sign-in failed. Please try again.' : urlError)}</div>}
        <button type="submit" disabled={loading} style={btn}>{loading ? 'Signing in…' : 'Sign in'}</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 12px' }}>
          <div style={{ flex: 1, height: 1, background: BORDER }} />
          <span style={{ fontSize: 11, color: MUTED2, fontWeight: 700 }}>OR</span>
          <div style={{ flex: 1, height: 1, background: BORDER }} />
        </div>
        <button type="button" onClick={() => loginWithGoogle('/')} style={googleBtn}>
          <GoogleIcon /> Continue with Google
        </button>

        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Link to="/forgot-password" style={{ fontSize: 12, color: MUTED2, textDecoration: 'none', fontWeight: 700 }}>Forgot password?</Link>
        </div>
        <div style={{ textAlign: 'center', fontSize: 12.5, color: MUTED2, marginTop: 10 }}>
          No account? <Link to="/signup" style={{ color: BRAND, fontWeight: 800, textDecoration: 'none' }}>Sign up</Link>
        </div>
      </form>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l6.9 5.3c4.1-3.8 6.6-9.4 6.6-15.6z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.3c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8.1 41.1 15.5 46 24 46z" />
      <path fill="#FBBC05" d="M11.5 28.5c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 10l7.1-5.5z" />
      <path fill="#EA4335" d="M24 10.7c3.2 0 5.4 1.4 6.7 2.5l6.1-6C33.1 3.9 28.1 2 24 2 15.5 2 8.1 6.9 4.4 14l7.1 5.5c1.8-5.3 6.7-8.8 12.5-8.8z" />
    </svg>
  );
}

const googleBtn = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: 12, borderRadius: 13, border: `1px solid ${BORDER}`, background: '#fff', color: '#374151', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: FONT };
const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', margin: '12px 0 6px' };
const inp = { width: '100%', padding: '11px 13px', borderRadius: 11, border: `1px solid ${BORDER}`, fontSize: 14, outline: 'none', fontFamily: FONT };
const btn = { width: '100%', marginTop: 18, padding: 13, borderRadius: 13, border: 'none', background: `linear-gradient(135deg, ${BRAND}, #4C1DCC)`, color: '#fff', fontSize: 14.5, fontWeight: 900, cursor: 'pointer', fontFamily: FONT };
