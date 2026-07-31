import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { BRAND, INK, MUTED, MUTED2, BORDER, WHITE, RED, FONT } from '../../constants.js';

export default function SignupPage() {
  const { register, loginWithGoogle, error, loading } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    try { await register(form); navigate('/'); } catch { /* error shown via context */ }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB', fontFamily: FONT, padding: 18 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 380, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 26 }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: INK, marginBottom: 4 }}>🏢 Akoro Business</div>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 20 }}>Register your business</div>
        <label style={lbl}>Full name</label>
        <input value={form.fullName} onChange={set('fullName')} required style={inp} />
        <label style={lbl}>Email</label>
        <input value={form.email} onChange={set('email')} type="email" required style={inp} />
        <label style={lbl}>Password</label>
        <input value={form.password} onChange={set('password')} type="password" minLength={8} required style={inp} />
        {error && <div style={{ color: RED, fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>{error}</div>}
        <button type="submit" disabled={loading} style={btn}>{loading ? 'Creating…' : 'Create account'}</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 12px' }}>
          <div style={{ flex: 1, height: 1, background: BORDER }} />
          <span style={{ fontSize: 11, color: MUTED2, fontWeight: 700 }}>OR</span>
          <div style={{ flex: 1, height: 1, background: BORDER }} />
        </div>
        <button type="button" onClick={() => loginWithGoogle('/')} style={googleBtn}>
          <GoogleIcon /> Continue with Google
        </button>
        <div style={{ textAlign: 'center', fontSize: 12.5, color: MUTED2, marginTop: 14 }}>
          Have an account? <Link to="/signin" style={{ color: BRAND, fontWeight: 800, textDecoration: 'none' }}>Sign in</Link>
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
