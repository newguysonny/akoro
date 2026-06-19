import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../../services/api.js';

const BRAND = '#6C3BFF';
const RED   = '#EF4444';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [err,     setErr]     = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) { setErr('Please enter your email address'); return; }
    setLoading(true); setErr('');
    try {
      const res = await fetch(`${API}/api/auth/forgot-password`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || 'Something went wrong');
      setSent(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const inp = {
    width: '100%', padding: '11px 14px', borderRadius: 12,
    border: '1.5px solid var(--ak-border2)', outline: 'none', fontSize: 14,
    fontFamily: "'Nunito',sans-serif", color: 'var(--ak-text)',
    background: 'var(--ak-input-bg)', boxSizing: 'border-box',
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: 'var(--ak-bg)',
      padding: '24px 20px', fontFamily: "'Nunito',sans-serif" }}>

      <div style={{ width: '100%', maxWidth: 420, background: 'var(--ak-surface)',
        borderRadius: 24, padding: '32px 28px', boxShadow: '0 4px 32px rgba(0,0,0,.10)',
        border: '1px solid var(--ak-border)' }}>

        <div style={{ width: 52, height: 52, borderRadius: 16,
          background: `linear-gradient(135deg,${BRAND},#4C1DCC)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, marginBottom: 20 }}>🔑</div>

        {sent ? (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 8px' }}>Check your email</h1>
            <p style={{ fontSize: 14, color: 'var(--ak-text-sub)', margin: '0 0 24px', lineHeight: 1.6 }}>
              We've sent a password reset link to <strong>{email}</strong>. It expires in 1 hour.
            </p>
            <p style={{ fontSize: 13, color: 'var(--ak-text-muted)', margin: '0 0 24px' }}>
              Didn't receive it? Check your spam folder or{' '}
              <button onClick={() => setSent(false)} style={{ background: 'none', border: 'none',
                color: BRAND, fontWeight: 700, cursor: 'pointer', fontSize: 13,
                fontFamily: "'Nunito',sans-serif", padding: 0 }}>try again</button>.
            </p>
            <button onClick={() => navigate('/signin')} style={{ width: '100%', padding: '13px',
              borderRadius: 14, border: 'none', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`,
              color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer',
              fontFamily: "'Nunito',sans-serif" }}>
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 8px' }}>Forgot password?</h1>
            <p style={{ fontSize: 14, color: 'var(--ak-text-sub)', margin: '0 0 24px' }}>
              Enter your email and we'll send you a reset link.
            </p>

            {err && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10,
                padding: '10px 14px', marginBottom: 16, fontSize: 13, fontWeight: 700, color: RED }}>{err}</div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 800,
                  color: 'var(--ak-text-sec)', marginBottom: 6 }}>Email address</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" style={inp} autoFocus />
              </div>
              <button type="submit" disabled={loading} style={{ width: '100%', padding: '13px',
                borderRadius: 14, border: 'none',
                background: loading ? 'var(--ak-tag-bg)' : `linear-gradient(135deg,${BRAND},#4C1DCC)`,
                color: loading ? 'var(--ak-text-muted)' : '#fff', fontSize: 14, fontWeight: 800,
                cursor: loading ? 'not-allowed' : 'pointer', fontFamily: "'Nunito',sans-serif",
                boxShadow: loading ? 'none' : `0 4px 14px ${BRAND}44` }}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>

            <button onClick={() => navigate('/signin')} style={{ width: '100%', marginTop: 14,
              background: 'none', border: 'none', color: 'var(--ak-text-muted)', fontSize: 13,
              fontWeight: 700, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
              ← Back to sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
