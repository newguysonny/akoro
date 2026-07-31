import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { BRAND, INK, MUTED, MUTED2, BORDER, WHITE, RED, FONT } from '../../constants.js';

export default function SignupPage() {
  const { register, error, loading } = useAuth();
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
        <div style={{ fontSize: 22, fontWeight: 900, color: INK, marginBottom: 4 }}>🪙 Akoro Agent</div>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 20 }}>Create your agent account</div>
        <label style={lbl}>Full name</label>
        <input value={form.fullName} onChange={set('fullName')} required style={inp} />
        <label style={lbl}>Email</label>
        <input value={form.email} onChange={set('email')} type="email" required style={inp} />
        <label style={lbl}>Password</label>
        <input value={form.password} onChange={set('password')} type="password" minLength={8} required style={inp} />
        {error && <div style={{ color: RED, fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>{error}</div>}
        <button type="submit" disabled={loading} style={btn}>{loading ? 'Creating…' : 'Create account'}</button>
        <div style={{ textAlign: 'center', fontSize: 12.5, color: MUTED2, marginTop: 14 }}>
          Have an account? <Link to="/signin" style={{ color: BRAND, fontWeight: 800, textDecoration: 'none' }}>Sign in</Link>
        </div>
      </form>
    </div>
  );
}

const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', margin: '12px 0 6px' };
const inp = { width: '100%', padding: '11px 13px', borderRadius: 11, border: `1px solid ${BORDER}`, fontSize: 14, outline: 'none', fontFamily: FONT };
const btn = { width: '100%', marginTop: 18, padding: 13, borderRadius: 13, border: 'none', background: `linear-gradient(135deg, ${BRAND}, #4C1DCC)`, color: '#fff', fontSize: 14.5, fontWeight: 900, cursor: 'pointer', fontFamily: FONT };
