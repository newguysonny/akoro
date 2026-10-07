import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { API } from '../../services/api.js';
import { ACCENT as BRAND, INK, MUTED, MUTED2, BORDER, WHITE, RED, FONT } from '../../constants.js';
import { Icon } from '../../components/Icons.jsx';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!email) return setErr('Enter your email address');
    setLoading(true); setErr('');
    try {
      const res = await fetch(`${API}/api/auth/forgot-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || 'Something went wrong');
      setSent(true);
    } catch (e2) { setErr(e2.message); } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB', fontFamily: FONT, padding: 18 }}>
      <div style={{ width: '100%', maxWidth: 380, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 26 }}>
        {sent ? (
          <>
            <div style={{ fontSize: 22, marginBottom: 10, color: BRAND }}><Icon name="mail" size={22} /></div>
            <div style={{ fontSize: 18, fontWeight: 900, color: INK, marginBottom: 8 }}>Check your email</div>
            <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.6, marginBottom: 18 }}>We've sent a reset link to <strong>{email}</strong>. It expires in 1 hour.</p>
            <button onClick={() => navigate('/signin')} style={btn}>Back to sign in</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <div style={{ fontSize: 20, fontWeight: 900, color: INK, marginBottom: 4 }}>Forgot password?</div>
            <div style={{ fontSize: 13, color: MUTED, marginBottom: 18 }}>We'll email you a reset link.</div>
            <label style={lbl}>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoFocus style={inp} />
            {err && <div style={{ color: RED, fontSize: 12.5, fontWeight: 700, margin: '10px 0' }}>{err}</div>}
            <button type="submit" disabled={loading} style={{ ...btn, marginTop: 16 }}>{loading ? 'Sending…' : 'Send reset link'}</button>
            <div style={{ textAlign: 'center', fontSize: 12.5, color: MUTED2, marginTop: 14 }}>
              <Link to="/signin" style={{ color: BRAND, fontWeight: 800, textDecoration: 'none' }}><Icon name="arrow-left" size={12} /> Back to sign in</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', margin: '12px 0 6px' };
const inp = { width: '100%', padding: '11px 13px', borderRadius: 11, border: `1px solid ${BORDER}`, fontSize: 14, outline: 'none', fontFamily: FONT };
const btn = { width: '100%', padding: 13, borderRadius: 13, border: 'none', background: `linear-gradient(135deg, ${BRAND}, #4C1DCC)`, color: '#fff', fontSize: 14.5, fontWeight: 900, cursor: 'pointer', fontFamily: FONT };
