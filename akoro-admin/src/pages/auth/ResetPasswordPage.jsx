import AkoroLogo from '../../components/common/AkoroLogo.jsx';
import { AlertTriangle, CheckCircle2, Lock, EyeOff, Eye } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { API } from '../../services/api.js';

const AMBER = '#E8884A';
const RED   = '#EF4444';
const GREEN = '#10B981';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const emailParam = params.get('email') || '';
  const codeFlow = !token && !!emailParam;
  const [email, setEmail] = useState(emailParam);
  const [code, setCode] = useState('');

  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [showPw,    setShowPw]    = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [done,      setDone]      = useState(false);
  const [err,       setErr]       = useState('');

  const strength = (() => {
    if (!password) return 0;
    let s = 0;
    if (password.length >= 8)          s++;
    if (/[A-Z]/.test(password))        s++;
    if (/[0-9]/.test(password))        s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s;
  })();
  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong'][strength];
  const strengthColor = ['', RED, '#F59E0B', '#3B82F6', GREEN][strength];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!token && !codeFlow) { setErr('Invalid reset link. Please request a new one.'); return; }
    if (!token && (!email || !/^\d{6}$/.test(code))) { setErr('Enter your email and the 6-digit code.'); return; }
    if (password.length < 8)  { setErr('Password must be at least 8 characters'); return; }
    if (password !== confirm)  { setErr("Passwords don't match"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/reset-password`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(token ? { token, password } : { email, code, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || 'Something went wrong');
      setDone(true);
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

  if (!token && !codeFlow) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#FAF8F5', fontFamily: "'DM Sans', sans-serif", padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        <div style={{ marginBottom: 16 }}><AlertTriangle size={40} color="#D97706" /></div>
        <h2 style={{ color: '#1A1A2E', marginBottom: 8 }}>Invalid reset link</h2>
        <p style={{ color: '#6B6B80', marginBottom: 24 }}>This link is missing or malformed. Please request a new password reset.</p>
        <button onClick={() => navigate('/forgot-password')} style={{ padding: '12px 28px',
          borderRadius: 14, border: 'none', background: `linear-gradient(135deg,${AMBER},#D4651E)`,
          color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          fontFamily: "'DM Sans', sans-serif" }}>Request new link</button>
      </div>
    </div>
  );

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
          background: done ? `linear-gradient(135deg,${GREEN},#059669)` : `linear-gradient(135deg,${AMBER},#D4651E)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 20 }}>{done ? <CheckCircle2 size={24} color="#10B981" /> : <Lock size={24} color="#1A1A2E" />}</div>

        {done ? (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1A1A2E', margin: '0 0 8px', fontFamily: "'Instrument Serif', serif" }}>Password updated!</h1>
            <p style={{ fontSize: 14, color: '#6B6B80', margin: '0 0 24px', lineHeight: 1.6 }}>
              Your password has been changed. You've been signed out on all devices — please sign in again.
            </p>
            <button onClick={() => navigate('/signin')} style={{ width: '100%', padding: '13px',
              borderRadius: 14, border: 'none', background: `linear-gradient(135deg,${AMBER},#D4651E)`,
              color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif", boxShadow: `0 4px 14px ${AMBER}44` }}>
              Sign in
            </button>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1A1A2E', margin: '0 0 8px', fontFamily: "'Instrument Serif', serif" }}>Set new password</h1>
            <p style={{ fontSize: 14, color: '#6B6B80', margin: '0 0 24px' }}>
              Choose a strong password of at least 8 characters.
            </p>

            {err && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10,
                padding: '10px 14px', marginBottom: 16, fontSize: 13, fontWeight: 600, color: RED }}>{err}</div>
            )}

            <form onSubmit={handleSubmit}>
              {codeFlow && (
                <>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--ak-text-sec, #1A1A2E)', marginBottom: 6 }}>Email</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={inp}/>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--ak-text-sec, #1A1A2E)', marginBottom: 6 }}>Code from the email</label>
                    <input type="text" inputMode="numeric" maxLength={6} value={code}
                      onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000"
                      style={{ ...inp, textAlign: 'center', letterSpacing: 8, fontSize: 20, fontWeight: 800 }}/>
                  </div>
                </>
              )}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#1A1A2E', marginBottom: 6 }}>New password</label>
                <div style={{ position: 'relative' }}>
                  <input type={showPw ? 'text' : 'password'} value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    style={{ ...inp, paddingRight: 44 }} autoFocus />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#9490A0' }}>
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {password && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      {[1,2,3,4].map(i => (
                        <div key={i} style={{ flex: 1, height: 4, borderRadius: 99,
                          background: i <= strength ? strengthColor : '#EDE8E1',
                          transition: 'background .2s' }} />
                      ))}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: strengthColor }}>{strengthLabel}</span>
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#1A1A2E', marginBottom: 6 }}>Confirm password</label>
                <input type={showPw ? 'text' : 'password'} value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat your new password"
                  style={{ ...inp, borderColor: confirm && confirm !== password ? RED : confirm && confirm === password ? GREEN : '#EDE8E1' }} />
              </div>

              <button type="submit" disabled={loading} style={{ width: '100%', padding: '13px',
                borderRadius: 14, border: 'none',
                background: loading ? '#EDE8E1' : `linear-gradient(135deg,${AMBER},#D4651E)`,
                color: loading ? '#9490A0' : '#fff', fontSize: 14, fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif",
                boxShadow: loading ? 'none' : `0 4px 14px ${AMBER}44` }}>
                {loading ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
