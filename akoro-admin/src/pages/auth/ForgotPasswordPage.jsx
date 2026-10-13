import { KeyRound } from 'lucide-react';
import AkoroLogo from '../../components/common/AkoroLogo.jsx';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../../services/api.js';

const AMBER = '#E8884A';
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
        headers: { 'Content-Type': 'application/json', 'Referer': window.location.href },
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
    border: '1.5px solid #EDE8E1', outline: 'none', fontSize: 14,
    fontFamily: "'DM Sans', sans-serif", color: '#1A1A2E',
    background: '#fff', boxSizing: 'border-box',
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#FAF8F5',
      padding: '24px 20px', fontFamily: "'DM Sans', sans-serif" }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
        <AkoroLogo size={40} radius={12} />
        <div>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#1A1A2E', display: 'block' }}>Akoro</span>
          <span style={{ fontSize: 11, color: '#9490A0', display: 'block', marginTop: -2 }}>Instructor Portal</span>
        </div>
      </div>

      <div style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 24,
        padding: '32px 28px', boxShadow: '0 4px 32px rgba(0,0,0,.07)',
        border: '1px solid #EDE8E1' }}>

        <div style={{ width: 52, height: 52, borderRadius: 16,
          background: `linear-gradient(135deg,${AMBER},#D4651E)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 20 }}><KeyRound size={24} color="#1A1A2E" /></div>

        {sent ? (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1A1A2E', margin: '0 0 8px', fontFamily: "'Instrument Serif', serif" }}>Check your email</h1>
            <p style={{ fontSize: 14, color: '#6B6B80', margin: '0 0 24px', lineHeight: 1.6 }}>
              We've sent a password reset link to <strong>{email}</strong>. It expires in 1 hour.
            </p>
            <p style={{ fontSize: 13, color: '#9490A0', margin: '0 0 24px' }}>
              Didn't receive it? Check your spam folder or{' '}
              <button onClick={() => setSent(false)} style={{ background: 'none', border: 'none',
                color: AMBER, fontWeight: 700, cursor: 'pointer', fontSize: 13,
                fontFamily: "'DM Sans', sans-serif", padding: 0 }}>try again</button>.
            </p>
            <button onClick={() => navigate('/signin')} style={{ width: '100%', padding: '13px',
              borderRadius: 14, border: 'none', background: `linear-gradient(135deg,${AMBER},#D4651E)`,
              color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif", boxShadow: `0 4px 14px ${AMBER}44` }}>
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1A1A2E', margin: '0 0 8px', fontFamily: "'Instrument Serif', serif" }}>Forgot password?</h1>
            <p style={{ fontSize: 14, color: '#6B6B80', margin: '0 0 24px' }}>
              Enter your email and we'll send you a reset link.
            </p>

            {err && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10,
                padding: '10px 14px', marginBottom: 16, fontSize: 13, fontWeight: 600, color: RED }}>{err}</div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700,
                  color: '#1A1A2E', marginBottom: 6 }}>Email address</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@school.edu" style={inp} autoFocus />
              </div>
              <button type="submit" disabled={loading} style={{ width: '100%', padding: '13px',
                borderRadius: 14, border: 'none',
                background: loading ? '#EDE8E1' : `linear-gradient(135deg,${AMBER},#D4651E)`,
                color: loading ? '#9490A0' : '#fff', fontSize: 14, fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif",
                boxShadow: loading ? 'none' : `0 4px 14px ${AMBER}44` }}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>

            <button onClick={() => navigate('/signin')} style={{ width: '100%', marginTop: 14,
              background: 'none', border: 'none', color: '#9490A0', fontSize: 13,
              fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
              ← Back to sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
