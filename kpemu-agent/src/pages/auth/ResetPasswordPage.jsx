import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { API } from '../../services/api.js';
import { BRAND, INK, MUTED, MUTED2, BORDER, WHITE, GREEN, RED, FONT } from '../../constants.js';
import { Icon } from '../../components/Icons.jsx';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!token) return setErr('Invalid reset link — please request a new one.');
    if (password.length < 8) return setErr('Password must be at least 8 characters');
    if (password !== confirm) return setErr("Passwords don't match");
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/reset-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || 'Something went wrong');
      setDone(true);
    } catch (e2) { setErr(e2.message); } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB', fontFamily: FONT, padding: 18 }}>
      <div style={{ width: '100%', maxWidth: 380, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 26 }}>
        {done ? (
          <>
            <div style={{ fontSize: 22, marginBottom: 10, color: '#059669' }}><Icon name="check-circle" size={22} /></div>
            <div style={{ fontSize: 18, fontWeight: 900, color: INK, marginBottom: 8 }}>Password updated</div>
            <p style={{ fontSize: 13, color: MUTED, marginBottom: 18 }}>You can now sign in with your new password.</p>
            <button onClick={() => navigate('/signin')} style={btn}>Sign in</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <div style={{ fontSize: 20, fontWeight: 900, color: INK, marginBottom: 18 }}>Set a new password</div>
            <label style={lbl}>New password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inp} autoFocus />
            <label style={lbl}>Confirm password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={inp} />
            {err && <div style={{ color: RED, fontSize: 12.5, fontWeight: 700, margin: '10px 0' }}>{err}</div>}
            <button type="submit" disabled={loading} style={{ ...btn, marginTop: 16 }}>{loading ? 'Updating…' : 'Update password'}</button>
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
