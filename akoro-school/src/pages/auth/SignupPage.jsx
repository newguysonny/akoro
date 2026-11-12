import AkoroLogo from '../../components/common/AkoroLogo.jsx';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { SITE_URL } from '../../config/urls.js';

const AMBER = '#E8884A';
const RED   = '#EF4444';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

export default function SignupPage() {
  const navigate = useNavigate();
  const { register, verifyEmail, resendCode, loginWithGoogle, loading, clearError } = useAuth();
  const [form, setForm]   = useState({ fullName: '', email: '', password: '' });
  const [formErr, setFormErr] = useState('');
  const [emailStep, setEmailStep] = useState(null);
  const [code, setCode] = useState('');

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormErr('');
    clearError();
    const { fullName, email, password } = form;
    if (!fullName || !email || !password) { setFormErr('Please fill in all fields'); return; }
    if (password.length < 8) { setFormErr('Password must be at least 8 characters'); return; }
    try {
      // School accounts register directly as school_admin (no username — the
      // full name IS the school name); onboarding then creates the profile.
      const data = await register({ fullName, email, password, role: 'school_admin' });
      if (data?.verificationRequired) {
        if (data.challengeId) setEmailStep({ challengeId: data.challengeId, email: data.email || email, retryAfter: data.retryAfter || 0 });
        else setFormErr(data.retryAfter ? `A code was sent recently — try again in ${data.retryAfter}s.` : 'Check your email for the code.');
        return;
      }
      if (!data?.user) { setFormErr(data?.message || 'Check your email to continue.'); return; }
      navigate('/', { replace: true });
    } catch (err) {
      setFormErr(err.message);
    }
  };

  const handleEmailCode = async (e) => {
    e.preventDefault(); setFormErr('');
    if (!/^\d{6}$/.test(code)) { setFormErr('Enter the 6-digit code'); return; }
    try { await verifyEmail({ challengeId: emailStep.challengeId, code }); navigate('/', { replace: true }); }
    catch (err) { setFormErr(err.message); }
  };
  const resendEmailCode = async () => {
    setFormErr('');
    try {
      const d = await resendCode({ challengeId: emailStep.challengeId });
      setEmailStep(s => ({ ...s, challengeId: d?.challengeId || s.challengeId, retryAfter: d?.retryAfter || 0 }));
      setFormErr(d?.codeSent ? 'A new code is on its way.' : `Try again in ${d?.retryAfter || 60}s.`);
    } catch (err) { setFormErr(err.message); }
  };

  const inp = {
    width: '100%', padding: '11px 14px', borderRadius: 12,
    border: '1.5px solid #EDE8E1', outline: 'none', fontSize: 14,
    fontFamily: "'DM Sans', sans-serif", color: '#1A1A2E', boxSizing: 'border-box',
    background: '#fff',
  };
  const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: '#1A1A2E', marginBottom: 6 };


  if (emailStep) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#FAF8F5', padding: 24, fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 24,
          padding: '32px 28px', boxShadow: '0 4px 32px rgba(0,0,0,.08)', border: '1px solid #EDE8E1' }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1A1A2E', margin: '0 0 6px' }}>Check your email</h1>
          <p style={{ fontSize: 14, color: '#6B6B80', margin: '0 0 20px' }}>
            Enter the 6-digit code we sent to <strong>emailStep.email</strong>.
          </p>
          {formErr && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10,
              padding: '10px 14px', marginBottom: 16, fontSize: 13, fontWeight: 600, color: '#EF4444' }}>{formErr}</div>
          )}
          <form onSubmit={handleEmailCode}>
            <input type="text" inputMode="numeric" autoFocus maxLength={6} value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000"
              style={{ ...inp, textAlign: 'center', letterSpacing: 8, fontSize: 22, fontWeight: 800, marginBottom: 18 }}/>
            <button type="submit" disabled={loading} style={{ width: '100%', padding: '13px', borderRadius: 14,
              border: 'none', background: loading ? '#EDE8E1' : '#6C3BFF', color: loading ? '#9490A0' : '#fff',
              fontSize: 14, fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
              {loading ? 'Verifying…' : 'Verify code'}
            </button>
          </form>
          <button onClick={resendEmailCode} style={{ width: '100%', marginTop: 12, background: 'none', border: 'none',
            color: '#6C3BFF', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>Resend code</button>
          <button onClick={() => { setEmailStep(null); setCode(''); setFormErr(''); }} style={{ width: '100%',
            marginTop: 8, background: 'none', border: 'none', color: '#9490A0', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            ← Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#FAF8F5',
      padding: '24px 20px', fontFamily: "'DM Sans', sans-serif",
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
        <AkoroLogo size={40} radius={12} />
        <div>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#1A1A2E', display: 'block' }}>Akoro</span>
          <span style={{ fontSize: 11, color: '#9490A0', display: 'block', marginTop: -2 }}>School Portal</span>
        </div>
      </div>

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: 420, background: '#fff', borderRadius: 24,
        padding: '32px 28px', boxShadow: '0 4px 32px rgba(0,0,0,.07)',
        border: '1px solid #EDE8E1',
      }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1A1A2E', margin: '0 0 4px', fontFamily: "'Instrument Serif', serif" }}>
          Register your school
        </h1>
        <p style={{ fontSize: 14, color: '#6B6B80', margin: '0 0 24px' }}>
          Create your school account to manage teachers, classes and students
        </p>

        {/* Google */}
        <button
          onClick={() => loginWithGoogle('/')}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 10, padding: '12px', borderRadius: 14, border: '1.5px solid #EDE8E1',
            background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600,
            color: '#1A1A2E', marginBottom: 20, fontFamily: "'DM Sans', sans-serif",
          }}
        >
          <GoogleIcon /> Continue with Google
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{ flex: 1, height: 1, background: '#EDE8E1' }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#9490A0' }}>or</span>
          <div style={{ flex: 1, height: 1, background: '#EDE8E1' }} />
        </div>

        {/* Error */}
        {formErr && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10,
            padding: '10px 14px', marginBottom: 16, fontSize: 13, fontWeight: 600, color: RED,
          }}>
            {formErr}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>School name</label>
            <input value={form.fullName} onChange={set('fullName')} placeholder="Akoro International School" style={inp} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Email</label>
            <input type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" style={inp} />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={lbl}>Password <span style={{ fontWeight: 500, color: '#9490A0' }}>(min 8 chars)</span></label>
            <input type="password" value={form.password} onChange={set('password')} placeholder="••••••••" style={inp} />
          </div>
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '13px', borderRadius: 14, border: 'none',
              background: loading ? '#EDE8E1' : `linear-gradient(135deg, ${AMBER}, #D4651E)`,
              color: loading ? '#9490A0' : '#fff', fontSize: 14, fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: "'DM Sans', sans-serif",
              boxShadow: loading ? 'none' : `0 4px 14px ${AMBER}44`,
            }}
          >
            {loading ? 'Creating account…' : 'Create school account'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: 11.5, color: '#9490A0', marginTop: 14, marginBottom: 0, lineHeight: 1.6 }}>
          By signing up, you agree to our{' '}
          <a href={`${SITE_URL}/terms`} target="_blank" rel="noreferrer" style={{ color: AMBER, fontWeight: 700, textDecoration: 'none' }}>Terms of Service</a>{' '}and{' '}
          <a href={`${SITE_URL}/privacy`} target="_blank" rel="noreferrer" style={{ color: AMBER, fontWeight: 700, textDecoration: 'none' }}>Privacy Policy</a>.
        </p>

        <p style={{ textAlign: 'center', fontSize: 13, color: '#6B6B80', marginTop: 16, marginBottom: 0 }}>
          Already have an account?{' '}
          <button
            onClick={() => navigate('/signin')}
            style={{ background: 'none', border: 'none', color: AMBER, fontWeight: 700, cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans', sans-serif", padding: 0 }}
          >
            Sign in
          </button>
        </p>
      </div>

      <p style={{ fontSize: 12, color: '#9490A0', marginTop: 20, textAlign: 'center', maxWidth: 360 }}>
        By creating an account you agree to Akoro's school partner guidelines.
      </p>
    </div>
  );
}
