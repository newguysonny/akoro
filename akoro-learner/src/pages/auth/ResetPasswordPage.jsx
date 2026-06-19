import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { API } from '../../services/api.js';

const BRAND = '#6C3BFF';
const RED   = '#EF4444';
const GREEN = '#10B981';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [showPw,    setShowPw]    = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [done,      setDone]      = useState(false);
  const [err,       setErr]       = useState('');

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
    if (!token)              { setErr('Invalid reset link. Please request a new one.'); return; }
    if (password.length < 8) { setErr('Password must be at least 8 characters'); return; }
    if (password !== confirm) { setErr("Passwords don't match"); return; }

    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/reset-password`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, password }),
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

  if (!token) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--ak-bg)', fontFamily: "'Nunito',sans-serif", padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
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
          fontSize: 24, marginBottom: 20 }}>{done ? '✅' : '🔒'}</div>

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
            <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 8px' }}>Set new password</h1>
            <p style={{ fontSize: 14, color: 'var(--ak-text-sub)', margin: '0 0 24px' }}>
              Choose a strong password of at least 8 characters.
            </p>

            {err && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10,
                padding: '10px 14px', marginBottom: 16, fontSize: 13, fontWeight: 700, color: RED }}>{err}</div>
            )}

            <form onSubmit={handleSubmit}>
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
                      color: 'var(--ak-text-muted)' }}>{showPw ? '🙈' : '👁'}</button>
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
