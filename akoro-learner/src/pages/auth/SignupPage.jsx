import { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { nextPath } from '../../utils/nextPath.js';
import { useLang } from '../../contexts/LanguageContext.jsx';
import AkoroLogo from '../../components/common/AkoroLogo.jsx';

const BRAND = '#6C3BFF';
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
  const location = useLocation();
  const after = nextPath(location.search) || '/app';   // e.g. back to a /join/:token invite
  const { register, loginWithGoogle, loading, clearError } = useAuth();
  const { t } = useLang();
  const [form,    setForm]   = useState({ fullName:'', username:'', email:'', password:'' });
  const [formErr, setFormErr]= useState('');

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault(); setFormErr(''); clearError();
    const { fullName, username, email, password } = form;
    if (!fullName || !username || !email || !password) { setFormErr(t('auth.fill_all_fields')); return; }
    if (password.length < 8) { setFormErr(t('auth.password_min8')); return; }
    try { await register({ fullName, username, email, password }); navigate(after, { replace:true }); }
    catch (err) { setFormErr(err.message); }
  };

  const inp = {
    width:'100%', padding:'11px 14px', borderRadius:12,
    border:'1.5px solid var(--ak-border2)', outline:'none', fontSize:14,
    fontFamily:"'Nunito',sans-serif", color:'var(--ak-text)',
    background:'var(--ak-input-bg)', boxSizing:'border-box',
  };
  const lbl = { display:'block', fontSize:12, fontWeight:800, color:'var(--ak-text-sec)', marginBottom:6 };

  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center', background:'var(--ak-bg)',
      padding:'24px 20px', fontFamily:"'Nunito',sans-serif" }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:32 }}>
        <AkoroLogo size={38} radius={12}/>
        <span style={{ fontSize:22, fontWeight:900, color:'var(--ak-text)' }}>Akoro</span>
      </div>

      <div style={{ width:'100%', maxWidth:400, background:'var(--ak-surface)', borderRadius:24,
        padding:'32px 28px', boxShadow:'0 4px 32px rgba(0,0,0,.12)',
        border:'1px solid var(--ak-border)' }}>
        <h1 style={{ fontSize:22, fontWeight:900, color:'var(--ak-text)', margin:'0 0 6px' }}>{t('auth.create_account')}</h1>
        <p style={{ fontSize:13, color:'var(--ak-text-sub)', margin:'0 0 24px' }}>{t('auth.start_today')}</p>
        <button onClick={() => loginWithGoogle(after)}
          style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center',
            gap:10, padding:'12px', borderRadius:14, border:'1.5px solid var(--ak-border2)',
            background:'var(--ak-surface)', cursor:'pointer', fontSize:14, fontWeight:700,
            color:'var(--ak-text-sec)', marginBottom:20, fontFamily:"'Nunito',sans-serif" }}>
          <GoogleIcon /> {t('auth.google')}
        </button>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
          <div style={{ flex:1, height:1, background:'var(--ak-border)' }}/>
          <span style={{ fontSize:11, fontWeight:600, color:'var(--ak-text-muted)' }}>{t('auth.or')}</span>
          <div style={{ flex:1, height:1, background:'var(--ak-border)' }}/>
        </div>
        {formErr && (
          <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10,
            padding:'10px 14px', marginBottom:16, fontSize:13, fontWeight:600, color:RED }}>
            {formErr}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
            <div>
              <label style={lbl}>{t('auth.fullname')}</label>
              <input value={form.fullName} onChange={set('fullName')} placeholder={t('auth.fullname_ph')} style={inp}/>
            </div>
            <div>
              <label style={lbl}>{t('auth.username')}</label>
              <input value={form.username} onChange={set('username')} placeholder={t('auth.username_ph')} style={inp}/>
            </div>
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={lbl}>{t('auth.email')}</label>
            <input type="email" value={form.email} onChange={set('email')}
              placeholder={t('auth.email_ph')} style={inp}/>
          </div>
          <div style={{ marginBottom:20 }}>
            <label style={lbl}>{t('auth.password')} <span style={{ fontWeight:500, color:'var(--ak-text-muted)' }}>({t('auth.password_min')})</span></label>
            <input type="password" value={form.password} onChange={set('password')}
              placeholder={t('auth.password_ph')} style={inp}/>
          </div>
          <button type="submit" disabled={loading}
            style={{ width:'100%', padding:'13px', borderRadius:14, border:'none',
              background:loading?'var(--ak-tag-bg)':`linear-gradient(135deg,${BRAND},#4C1DCC)`,
              color:loading?'var(--ak-text-muted)':'#fff', fontSize:14, fontWeight:800,
              cursor:loading?'not-allowed':'pointer', fontFamily:"'Nunito',sans-serif",
              boxShadow:loading?'none':`0 4px 14px ${BRAND}44` }}>
            {loading ? t('common.loading') : t('auth.create_account_btn')}
          </button>
        </form>
        <p style={{ textAlign:'center', fontSize:11.5, color:'var(--ak-text-muted)', marginTop:14, marginBottom:0, lineHeight:1.6 }}>
          By signing up, you agree to our{' '}
          <a href="https://akoro.app/terms" target="_blank" rel="noreferrer" style={{ color:BRAND, fontWeight:700, textDecoration:'none' }}>Terms of Service</a>{' '}and{' '}
          <a href="https://akoro.app/privacy" target="_blank" rel="noreferrer" style={{ color:BRAND, fontWeight:700, textDecoration:'none' }}>Privacy Policy</a>.
        </p>
        <p style={{ textAlign:'center', fontSize:13, color:'var(--ak-text-sub)', marginTop:20, marginBottom:0 }}>
          {t('auth.have_account')}{' '}
          <Link to={after === '/app' ? '/signin' : `/signin?next=${encodeURIComponent(after)}`} style={{ color:BRAND, fontWeight:800, textDecoration:'none' }}>{t('auth.signin')}</Link>
        </p>
      </div>
    </div>
  );
}
