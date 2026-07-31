import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { BRAND, INK, MUTED, MUTED2, BORDER, WHITE, RED, FONT } from '../../constants.js';

export default function SigninPage() {
  const { login, error, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    try { await login({ email, password }); navigate('/'); } catch { /* error shown via context */ }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB', fontFamily: FONT, padding: 18 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 380, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 26 }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: INK, marginBottom: 4 }}>🪙 Akoro Agent</div>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 20 }}>Sign in to your voucher wallet</div>
        <label style={lbl}>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required style={inp} />
        <label style={lbl}>Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required style={inp} />
        {error && <div style={{ color: RED, fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>{error}</div>}
        <button type="submit" disabled={loading} style={btn}>{loading ? 'Signing in…' : 'Sign in'}</button>
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

const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', margin: '12px 0 6px' };
const inp = { width: '100%', padding: '11px 13px', borderRadius: 11, border: `1px solid ${BORDER}`, fontSize: 14, outline: 'none', fontFamily: FONT };
const btn = { width: '100%', marginTop: 18, padding: 13, borderRadius: 13, border: 'none', background: `linear-gradient(135deg, ${BRAND}, #4C1DCC)`, color: '#fff', fontSize: 14.5, fontWeight: 900, cursor: 'pointer', fontFamily: FONT };
