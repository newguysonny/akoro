import { AlertTriangle, CheckCircle2, Lock, EyeOff, Eye } from 'lucide-react';
import AkoroLogo from '../../components/common/AkoroLogo.jsx';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { API } from '../../services/api.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

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
    if (!token)               { setErr('Invalid reset link. Please request a new one.'); return; }
    if (password.length < 8)  { setErr('Password must be at least 8 characters'); return; }
    if (password !== confirm)  { setErr("Passwords don't match"); return; }
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
    border: `1.5px solid ${C.border}`, outline: 'none', fontSize: 14,
    fontFamily: C.font, color: C.ink,
    background: C.surface, boxSizing: 'border-box',
  };

  if (!token) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: C.bg, fontFamily: C.font, padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        <div style={{ marginBottom: 16 }}><Ico lucide={AlertTriangle} ti="ti-alert-triangle" size={40} color="#D97706" /></div>
        <h2 style={{ color: C.ink, marginBottom: 8 }}>Invalid reset link</h2>
        <p style={{ color: C.muted, marginBottom: 24 }}>This link is missing or malformed. Please request a new password reset.</p>
        <button onClick={() => navigate('/forgot-password')} style={{ padding: '12px 28px',
          borderRadius: 14, border: 'none', background: `linear-gradient(135deg,${C.brand},${C.brandDeep})`,
          color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          fontFamily: C.font }}>Request new link</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: C.bg,
      padding: '24px 20px', fontFamily: C.font }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
        <AkoroLogo size={40} radius={12} />
        <div>
          <span style={{ fontSize: 20, fontWeight: 800, color: C.ink, display: 'block' }}>Akoro</span>
          <span style={{ fontSize: 11, color: C.muted2, display: 'block', marginTop: -2 }}>Instructor Portal</span>
        </div>
      </div>

      <div style={{ width: '100%', maxWidth: 420, background: C.surface, borderRadius: 24,
        padding: '32px 28px', boxShadow: '0 4px 32px rgba(0,0,0,.07)',
        border: `1px solid ${C.border}` }}>

        <div style={{ width: 52, height: 52, borderRadius: 16,
          background: done ? `linear-gradient(135deg,${GREEN},#059669)` : `linear-gradient(135deg,${C.brand},${C.brandDeep})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 20 }}>{done ? <Ico lucide={CheckCircle2} ti="ti-circle-check" size={24} color="#10B981" /> : <Ico lucide={Lock} ti="ti-lock" size={24} color={C.ink} />}</div>

        {done ? (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: C.ink, margin: '0 0 8px', fontFamily: "'Instrument Serif', serif" }}>Password updated!</h1>
            <p style={{ fontSize: 14, color: C.muted, margin: '0 0 24px', lineHeight: 1.6 }}>
              Your password has been changed. You've been signed out on all devices — please sign in again.
            </p>
            <button onClick={() => navigate('/signin')} style={{ width: '100%', padding: '13px',
              borderRadius: 14, border: 'none', background: `linear-gradient(135deg,${C.brand},${C.brandDeep})`,
              color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              fontFamily: C.font, boxShadow: `0 4px 14px ${tint(27)}` }}>
              Sign in
            </button>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: C.ink, margin: '0 0 8px', fontFamily: "'Instrument Serif', serif" }}>Set new password</h1>
            <p style={{ fontSize: 14, color: C.muted, margin: '0 0 24px' }}>
              Choose a strong password of at least 8 characters.
            </p>

            {err && (
              <div style={{ background: tint(9, RED), border: `1px solid ${tint(30, RED)}`, borderRadius: 10,
                padding: '10px 14px', marginBottom: 16, fontSize: 13, fontWeight: 600, color: RED }}>{err}</div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 6 }}>New password</label>
                <div style={{ position: 'relative' }}>
                  <input type={showPw ? 'text' : 'password'} value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    style={{ ...inp, paddingRight: 44 }} autoFocus />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: C.muted2 }}>
                    {showPw ? <Ico lucide={EyeOff} ti="ti-eye-off" size={15} /> : <Ico lucide={Eye} ti="ti-eye" size={15} />}
                  </button>
                </div>
                {password && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      {[1,2,3,4].map(i => (
                        <div key={i} style={{ flex: 1, height: 4, borderRadius: 99,
                          background: i <= strength ? strengthColor : C.border,
                          transition: 'background .2s' }} />
                      ))}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: strengthColor }}>{strengthLabel}</span>
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 6 }}>Confirm password</label>
                <input type={showPw ? 'text' : 'password'} value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat your new password"
                  style={{ ...inp, borderColor: confirm && confirm !== password ? RED : confirm && confirm === password ? GREEN : C.border }} />
              </div>

              <button type="submit" disabled={loading} style={{ width: '100%', padding: '13px',
                borderRadius: 14, border: 'none',
                background: loading ? C.border : `linear-gradient(135deg,${C.brand},${C.brandDeep})`,
                color: loading ? C.muted2 : '#fff', fontSize: 14, fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer', fontFamily: C.font,
                boxShadow: loading ? 'none' : `0 4px 14px ${tint(27)}` }}>
                {loading ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
