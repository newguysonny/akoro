import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/common/Icons.jsx';
import { API } from '../../services/api.js';

const BRAND = '#6C3BFF';
const RED   = '#EF4444';
const GREEN = '#10B981';
const mmss  = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const emailParam = params.get('email') || '';
  const resendParam = Number(params.get('resend')) || 0;
  const codeFlow = !token && !!emailParam;
  const [email, setEmail] = useState(emailParam);
  const [code, setCode] = useState('');

  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [showPw,    setShowPw]    = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [resending, setResending] = useState(false);
  const [done,      setDone]      = useState(false);
  const [err,       setErr]       = useState('');
  const [notice,    setNotice]    = useState('');
  // A code was just emailed before landing here, so start the resend window.
  const [cooldown,  setCooldown]  = useState(codeFlow ? (resendParam || 60) : 0);

  // Tick the resend countdown down to zero.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown(c => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [cooldown <= 0]);

  const resendCode = async () => {
    setErr(''); setNotice('');
    if (!email) { setErr('Enter your email first.'); return; }
    setResending(true);
    try {
      const res = await fetch(`${API}/api/auth/resend-code`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, purpose: 'reset' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || 'Could not resend the code.');
      setNotice('A new code is on its way.');
      setCooldown(json.data?.resendSeconds || 60);
    } catch (e) {
      setErr(e.message);
    } finally {
      setResending(false);
    }
  };

  const strength = (() => {
    if (!password) return 0;
    let s = 0;
    if (password.length >= 8)                     s++;
    if (/[A-Z]/.test(password))                   s++;
    if (/[0-9]/.test(password))                   s++;
    if (/[^A-Za-z0-9]/.test(password))            s++;
    return s;
  })();
  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong'][strength];
  const strengthColor = ['', RED, '#F59E0B', '#3B82F6', GREEN][strength];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!token && !codeFlow) { setErr('Invalid reset link. Please request a new one.'); return; }
    if (!token && (!email || !/^\d{6}$/.test(code))) { setErr('Enter your email and the 6-digit code.'); return; }
    if (password.length < 8) { setErr('Password must be at least 8 characters'); return; }
    if (password !== confirm) { setErr("Passwords don't match"); return; }

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
    border: '1.5px solid var(--ak-border2)', outline: 'none', fontSize: 14,
    fontFamily: "'Nunito',sans-serif", color: 'var(--ak-text)',
    background: 'var(--ak-input-bg)', boxSizing: 'border-box',
  };

  if (!token && !codeFlow) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--ak-bg)', fontFamily: "'Nunito',sans-serif", padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}><Icon name="ti-alert-triangle" size={48} color="#F59E0B"/></div>
        <h2 style={{ color: 'var(--ak-text)', marginBottom: 8 }}>Invalid reset link</h2>
        <p style={{ color: 'var(--ak-text-sub)', marginBottom: 24 }}>
          This link is missing or malformed. Please request a new password reset.
        </p>
        <button onClick={() => navigate('/forgot-password')} style={{ padding: '12px 28px',
          borderRadius: 14, border: 'none', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`,
          color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer',
          fontFamily: "'Nunito',sans-serif" }}>Request new link</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: 'var(--ak-bg)',
      padding: '24px 20px', fontFamily: "'Nunito',sans-serif" }}>

      <div style={{ width: '100%', maxWidth: 420, background: 'var(--ak-surface)',
        borderRadius: 24, padding: '32px 28px', boxShadow: '0 4px 32px rgba(0,0,0,.10)',
        border: '1px solid var(--ak-border)' }}>

        <div style={{ width: 52, height: 52, borderRadius: 16,
          background: done ? `linear-gradient(135deg,${GREEN},#059669)` : `linear-gradient(135deg,${BRAND},#4C1DCC)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, marginBottom: 20 }}><Icon name={done ? "ti-circle-check" : "ti-lock"} size={24} color={done ? GREEN : BRAND}/></div>

        {done ? (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 8px' }}>Password updated!</h1>
            <p style={{ fontSize: 14, color: 'var(--ak-text-sub)', margin: '0 0 24px', lineHeight: 1.6 }}>
              Your password has been changed. You've been signed out on all devices — please sign in again.
            </p>
            <button onClick={() => navigate('/signin')} style={{ width: '100%', padding: '13px',
              borderRadius: 14, border: 'none', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`,
              color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer',
              fontFamily: "'Nunito',sans-serif", boxShadow: `0 4px 14px ${BRAND}44` }}>
              Sign in
            </button>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 8px' }}>{codeFlow ? 'Enter your code' : 'Set new password'}</h1>
            <p style={{ fontSize: 14, color: 'var(--ak-text-sub)', margin: '0 0 24px' }}>
              {codeFlow ? 'Enter the 6-digit code we emailed you, then choose a new password.' : 'Choose a strong password of at least 8 characters.'}
            </p>

            {notice && (
              <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 10,
                padding: '10px 14px', marginBottom: 16, fontSize: 13, fontWeight: 700, color: '#059669' }}>{notice}</div>
            )}
            {err && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10,
                padding: '10px 14px', marginBottom: 16, fontSize: 13, fontWeight: 700, color: RED }}>{err}</div>
            )}

            <form onSubmit={handleSubmit}>
              {codeFlow && (
                <>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: 'var(--ak-text-sec)', marginBottom: 6 }}>Email</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={inp}/>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: 'var(--ak-text-sec)', marginBottom: 6 }}>Code from the email</label>
                    <input type="text" inputMode="numeric" maxLength={6} value={code}
                      onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000"
                      style={{ ...inp, textAlign: 'center', letterSpacing: 8, fontSize: 20, fontWeight: 800 }}/>
                  </div>
                  <div style={{ textAlign: 'center', marginTop: -4, marginBottom: 16 }}>
                    <div style={{ fontSize: 12, color: 'var(--ak-text-muted)', marginBottom: 6 }}>Didn't receive code?</div>
                    <button type="button" onClick={resendCode} disabled={resending || cooldown > 0} style={{
                      background: 'none', border: 'none', fontFamily: "'Nunito',sans-serif",
                      fontSize: 12.5, fontWeight: 800, padding: 0,
                      color: cooldown > 0 ? 'var(--ak-text-muted)' : BRAND,
                      cursor: cooldown > 0 ? 'default' : 'pointer',
                    }}>
                      Resend code{cooldown > 0 ? ` · ${mmss(cooldown)}` : ''}
                    </button>
                  </div>
                </>
              )}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 800,
                  color: 'var(--ak-text-sec)', marginBottom: 6 }}>New password</label>
                <div style={{ position: 'relative' }}>
                  <input type={showPw ? 'text' : 'password'} value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 8 characters" style={{ ...inp, paddingRight: 44 }} autoFocus />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', fontSize: 16,
                      color: 'var(--ak-text-muted)' }}><Icon name={showPw ? 'ti-eye-off' : 'ti-eye'} size={16} color="var(--ak-text-muted)"/></button>
                </div>
                {password && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      {[1,2,3,4].map(i => (
                        <div key={i} style={{ flex: 1, height: 4, borderRadius: 99,
                          background: i <= strength ? strengthColor : 'var(--ak-border2)',
                          transition: 'background .2s' }} />
                      ))}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: strengthColor }}>{strengthLabel}</span>
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 800,
                  color: 'var(--ak-text-sec)', marginBottom: 6 }}>Confirm password</label>
                <input type={showPw ? 'text' : 'password'} value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat your new password" style={{
                    ...inp,
                    borderColor: confirm && confirm !== password ? RED : confirm && confirm === password ? GREEN : 'var(--ak-border2)',
                  }} />
              </div>

              <button type="submit" disabled={loading} style={{ width: '100%', padding: '13px',
                borderRadius: 14, border: 'none',
                background: loading ? 'var(--ak-tag-bg)' : `linear-gradient(135deg,${BRAND},#4C1DCC)`,
                color: loading ? 'var(--ak-text-muted)' : '#fff', fontSize: 14, fontWeight: 800,
                cursor: loading ? 'not-allowed' : 'pointer', fontFamily: "'Nunito',sans-serif",
                boxShadow: loading ? 'none' : `0 4px 14px ${BRAND}44` }}>
                {loading ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
