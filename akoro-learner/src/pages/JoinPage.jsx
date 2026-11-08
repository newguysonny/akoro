import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { apiGet, apiPost } from '../services/api.js';
import AkoroLogo from '../components/common/AkoroLogo.jsx';
import { APP_HOME } from '../config/target.js';

const BRAND = '#6C3BFF';
const RED   = '#EF4444';

/* /join/:token — a teacher's course invite (POST /api/profiles/teacher/invite).
   Shows what the link is for, sends a signed-out visitor to sign in or up and
   back here, then joins the courses (POST /api/profiles/invite/redeem). */
export default function JoinPage() {
  const { token } = useParams();
  const { isAuthenticated } = useAuth();
  const [invite, setInvite] = useState(null);
  const [error,  setError]  = useState('');
  const [result, setResult] = useState(null);
  const [joining, setJoining] = useState(false);
  const tried = useRef(false);
  const enc = encodeURIComponent(token || '');
  const next = encodeURIComponent(`/join/${enc}`);

  useEffect(() => {
    apiGet(`/api/profiles/invite/${enc}`, { cache: false })
      .then((r) => setInvite(r.data))
      .catch((e) => setError(e.message || 'This invite link is invalid or has expired.'));
  }, [enc]);

  useEffect(() => {
    if (!invite || !isAuthenticated || tried.current) return;
    tried.current = true;
    setJoining(true);
    apiPost('/api/profiles/invite/redeem', { token })
      .then((r) => setResult(r.data))
      .catch((e) => setError(e.message || 'Could not join. Please try again.'))
      .finally(() => setJoining(false));
  }, [invite, isAuthenticated, token]);

  const titles = (invite?.courses || []).map((c) => c.title);
  const btn = { display:'block', width:'100%', padding:'13px', borderRadius:14, border:'none', boxSizing:'border-box',
    background:`linear-gradient(135deg,${BRAND},#4C1DCC)`, color:'#fff', fontSize:14, fontWeight:800,
    textAlign:'center', textDecoration:'none', fontFamily:"'Nunito',sans-serif" };
  const btn2 = { ...btn, background:'none', color:BRAND, border:`1.5px solid ${BRAND}`, marginTop:10 };

  let body;
  if (error) {
    body = (<>
      <h1 style={h1}>Invite link</h1>
      <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10, padding:'10px 14px',
        marginBottom:16, fontSize:13, fontWeight:600, color:RED }}>{error}</div>
      <Link to={isAuthenticated ? APP_HOME : '/'} style={btn}>{isAuthenticated ? 'Go to Akoro' : 'Back to Akoro'}</Link>
    </>);
  } else if (!invite || joining) {
    body = <p style={sub}>{joining ? 'Joining…' : 'Opening your invite…'}</p>;
  } else if (result) {
    const joined = result.course_titles || [];
    const already = result.already_enrolled || [];
    body = (<>
      <h1 style={h1}>{joined.length ? "You're in!" : 'Already joined'}</h1>
      {joined.length > 0 && <p style={sub}>You joined {list(joined)}.</p>}
      {already.length > 0 && <p style={sub}>You were already in {list(already)}.</p>}
      <Link to={APP_HOME} style={btn}>Go to my courses</Link>
    </>);
  } else {
    body = (<>
      <h1 style={h1}>You're invited</h1>
      <p style={sub}>
        {invite.teacher_name ? <strong>{invite.teacher_name}</strong> : 'Your teacher'} invited you to join {list(titles)} on Akoro.
      </p>
      <Link to={`/signin?next=${next}`} style={btn}>Sign in to join</Link>
      <Link to={`/signup?next=${next}`} style={btn2}>Create an account</Link>
    </>);
  }

  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      background:'var(--ak-bg)', padding:'24px 16px', fontFamily:"'Nunito',sans-serif" }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:32 }}>
        <AkoroLogo size={38} radius={12}/>
        <span style={{ fontSize:22, fontWeight:900, color:'var(--ak-text)' }}>Akoro</span>
      </div>
      <div style={{ width:'100%', maxWidth:400, background:'var(--ak-surface)', borderRadius:24, padding:'32px 28px',
        boxShadow:'0 4px 32px rgba(0,0,0,.12)', border:'1px solid var(--ak-border)', boxSizing:'border-box' }}>
        {body}
      </div>
    </div>
  );
}

const h1  = { fontSize:22, fontWeight:900, color:'var(--ak-text)', margin:'0 0 6px' };
const sub = { fontSize:14, color:'var(--ak-text-sub)', margin:'0 0 20px', lineHeight:1.5 };
const list = (titles) => titles.length === 1 ? <strong>{titles[0]}</strong>
  : <><strong>{titles.length} courses</strong> ({titles.join(', ')})</>;
