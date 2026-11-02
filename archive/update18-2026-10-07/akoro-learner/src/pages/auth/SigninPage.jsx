import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';

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

export default function SigninPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { login, loginWithGoogle, loading, clearError } = useAuth();
  const [email,    setEmail]   = useState('');
  const [password, setPassword]= useState('');
  const [formErr,  setFormErr] = useState('');
  const urlError = params.get('error');

  const handleSubmit = async (e) => {
    e.preventDefault(); setFormErr(''); clearError();
    if (!email || !password) { setFormErr('Please fill in all fields'); return; }
    try { await login({ email, password }); navigate('/', { replace:true }); }
    catch (err) { setFormErr(err.message); }
  };

  const inp = { width:'100%', padding:'11px 14px', borderRadius:12,
    border:'1.5px solid #E5E7EB', outline:'none', fontSize:14,
    fontFamily:"'Nunito',sans-serif", color:'#111827', boxSizing:'border-box' };

  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center', background:'#F9FAFB',
      padding:'24px 20px', fontFamily:"'Nunito',sans-serif" }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:32 }}>
        <div style={{ width:38, height:38, borderRadius:12, background:BRAND,
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:`0 4px 14px ${BRAND}44` }}>
          <span style={{ fontSize:18 }}>🧠</span>
        </div>
        <span style={{ fontSize:22, fontWeight:900, color:'#111827' }}>Akoro</span>
      </div>
      <div style={{ width:'100%', maxWidth:400, background:'#fff', borderRadius:24,
        padding:'32px 28px', boxShadow:'0 4px 32px rgba(0,0,0,.08)' }}>
        <h1 style={{ fontSize:22, fontWeight:900, color:'#111827', margin:'0 0 6px' }}>Welcome back</h1>
        <p style={{ fontSize:13, color:'#6B7280', margin:'0 0 24px' }}>Sign in to continue learning</p>
        <button onClick={() => loginWithGoogle('/')}
          style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center',
            gap:10, padding:'12px', borderRadius:14, border:`1.5px solid #E5E7EB`,
            background:'#fff', cursor:'pointer', fontSize:14, fontWeight:700,
            color:'#374151', marginBottom:20, fontFamily:"'Nunito',sans-serif" }}>
          <GoogleIcon /> Continue with Google
        </button>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
          <div style={{ flex:1, height:1, background:'#F3F4F6' }}/>
          <span style={{ fontSize:11, fontWeight:600, color:'#9CA3AF' }}>or</span>
          <div style={{ flex:1, height:1, background:'#F3F4F6' }}/>
        </div>
        {(formErr || urlError) && (
          <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10,
            padding:'10px 14px', marginBottom:16, fontSize:13, fontWeight:600, color:RED }}>
            {formErr || (urlError==='google_failed'?'Google sign-in failed. Try again.':urlError)}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom:14 }}>
            <label style={{ display:'block', fontSize:12, fontWeight:800, color:'#374151', marginBottom:6 }}>Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
              placeholder="you@example.com" style={inp}/>
          </div>
          <div style={{ marginBottom:20 }}>
            <label style={{ display:'block', fontSize:12, fontWeight:800, color:'#374151', marginBottom:6 }}>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
              placeholder="••••••••" style={inp}/>
          </div>
          <button type="submit" disabled={loading}
            style={{ width:'100%', padding:'13px', borderRadius:14, border:'none',
              background:loading?'#E5E7EB':`linear-gradient(135deg,${BRAND},#4C1DCC)`,
              color:loading?'#9CA3AF':'#fff', fontSize:14, fontWeight:800,
              cursor:loading?'not-allowed':'pointer', fontFamily:"'Nunito',sans-serif",
              boxShadow:loading?'none':`0 4px 14px ${BRAND}44` }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p style={{ textAlign:'center', fontSize:13, color:'#6B7280', marginTop:20, marginBottom:0 }}>
          Don't have an account?{' '}
          <Link to="/signup" style={{ color:BRAND, fontWeight:800, textDecoration:'none' }}>Sign up</Link>
        </p>
      </div>
    </div>
  );
}
