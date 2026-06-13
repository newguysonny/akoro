import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Brain, Zap, Swords, BarChart3, Mic, School, WifiOff, Trophy,
  Link2, Menu, X, ChevronDown, Star, Check, ArrowRight, Play,
  Shield, Globe, BookOpen, DollarSign, MessageSquare, Cpu, Target,
  Repeat2, Map, Users, Building2, Sparkles, GraduationCap, Clock,
  TrendingUp, Award, Lock, AlertCircle, CheckCircle2, XCircle,
  Video, CalendarDays, UserCheck, MonitorPlay, ExternalLink, Radio,
  Layers, Settings, LayoutDashboard,
} from 'lucide-react';
import {
  FaLinkedin, FaYoutube, FaInstagram, FaFacebook, FaXTwitter,
} from 'react-icons/fa6';

/* ── Brand tokens ── */
const B  = '#6C3BFF';   // primary purple
const B2 = '#4C1DCC';   // darker purple
const G  = '#10B981';   // green
const GL = '#F59E0B';   // gold
const R  = '#EF4444';   // red
const BG = '#F5F3FF';   // light purple tint

/* ── Global styles injected once ── */
const FontStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Syne:wght@400;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html{scroll-behavior:smooth}
    body{font-family:'DM Sans',sans-serif;background:#fff;color:#1A1A2E;overflow-x:hidden}
    .fs{font-family:'Instrument Serif',Georgia,serif}
    .fsyne{font-family:'Syne',sans-serif}
    @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    @keyframes lpulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.78)}}
    @keyframes lspin{to{transform:rotate(360deg)}}
    @keyframes livepulse{0%,100%{opacity:1}50%{opacity:.35}}
    .fu1{animation:fadeUp .6s ease .08s both}
    .fu2{animation:fadeUp .6s ease .2s both}
    .fu3{animation:fadeUp .6s ease .32s both}
    .fu4{animation:fadeUp .6s ease .44s both}
    .fu5{animation:fadeUp .6s ease .56s both}
    .pdot{animation:lpulse 2s ease infinite}
    .ldot{animation:livepulse 1.4s ease infinite}
    .spin{animation:lspin .8s linear infinite}
    .hero-grid{
      background-image:linear-gradient(rgba(108,59,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(108,59,255,.06) 1px,transparent 1px);
      background-size:56px 56px;
      mask-image:radial-gradient(ellipse 80% 65% at 50% 0%,black 0%,transparent 80%);
      -webkit-mask-image:radial-gradient(ellipse 80% 65% at 50% 0%,black 0%,transparent 80%);
    }
    ::-webkit-scrollbar{width:4px}
    ::-webkit-scrollbar-thumb{background:#d1c9ff;border-radius:2px}
    a{text-decoration:none;color:inherit}
  `}</style>
);

/* ── Intersection-observer reveal ── */
function useReveal(threshold = 0.08) {
  const ref = useRef(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVis(true); obs.disconnect(); } }, { threshold });
    obs.observe(el); return () => obs.disconnect();
  }, [threshold]);
  return [ref, vis];
}
function Reveal({ children, delay = 0, style = {} }) {
  const [ref, vis] = useReveal();
  return (
    <div ref={ref} style={{ opacity: vis ? 1 : 0, transform: vis ? 'none' : 'translateY(20px)', transition: `opacity .6s ease ${delay}s, transform .6s ease ${delay}s`, ...style }}>
      {children}
    </div>
  );
}

/* ── Section label ── */
const SL = ({ children, center = false }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, justifyContent: center ? 'center' : 'flex-start' }}>
    <div style={{ width: 20, height: 2, background: B, flexShrink: 0 }} />
    <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: B }}>{children}</span>
  </div>
);

/* ── Button ── */
const Btn = ({ children, v = 'primary', sz = 'md', onClick, style: s = {} }) => {
  const base = { display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: "'DM Sans',sans-serif", fontWeight: 600, borderRadius: 99, cursor: 'pointer', border: 'none', transition: 'all .2s', whiteSpace: 'nowrap' };
  const sizes = { sm: { padding: '9px 20px', fontSize: 13 }, md: { padding: '11px 22px', fontSize: 14 }, lg: { padding: '14px 30px', fontSize: 15 } };
  const variants = {
    primary: { background: `linear-gradient(135deg,${B},${B2})`, color: '#fff', boxShadow: `0 4px 18px ${B}40` },
    outline:  { background: '#fff', color: '#3A3A52', border: `1.5px solid #D4CEC4` },
    ghost:    { background: 'transparent', color: '#7A7880', border: '1.5px solid transparent' },
    dark:     { background: '#1A1A2E', color: '#fff', boxShadow: '0 4px 18px rgba(26,26,46,.2)', border: '1.5px solid #1A1A2E' },
    green:    { background: G, color: '#fff', boxShadow: `0 4px 18px ${G}30`, border: `1.5px solid ${G}` },
  };
  return <button onClick={onClick} style={{ ...base, ...sizes[sz], ...variants[v], ...s }}>{children}</button>;
};

/* ══════════════ HEADER ══════════════ */
function Header({ onDrawer }) {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => { const fn = () => setScrolled(window.scrollY > 30); window.addEventListener('scroll', fn); return () => window.removeEventListener('scroll', fn); }, []);
  const scroll = (e, id) => { e.preventDefault(); document.querySelector(id)?.scrollIntoView({ behavior: 'smooth' }); };
  const navLinks = [
    { label: 'Features',    id: '#features' },
    { label: 'How it Works',id: '#how-it-works' },
    { label: 'Outcomes',    id: '#outcomes' },
    { label: 'Pricing',     id: '#pricing' },
    { label: 'FAQ',         id: '#faq' },
  ];
  return (
    <header style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 900, height: 68, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', background: scrolled ? 'rgba(255,255,255,.97)' : 'rgba(255,255,255,.85)', backdropFilter: 'blur(14px)', borderBottom: scrolled ? '1px solid #EDE8E1' : 'none', transition: 'all .3s', fontFamily: "'DM Sans',sans-serif" }}>
      <a href="#" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: `linear-gradient(135deg,${B},${B2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 14px ${B}40` }}><Brain size={17} color="#fff" strokeWidth={2.5}/></div>
        <span className="fs" style={{ fontSize: 20, color: '#1A1A2E' }}>Akoro</span>
      </a>
      <nav style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {navLinks.map(l => (
          <a key={l.label} href={l.id} onClick={e => scroll(e, l.id)} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 14, fontWeight: 500, color: '#6B6B80', transition: 'all .2s' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#1A1A2E'; e.currentTarget.style.background = '#F5F2EC'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#6B6B80'; e.currentTarget.style.background = 'transparent'; }}>
            {l.label}
          </a>
        ))}
      </nav>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Btn v="ghost" sz="sm" onClick={() => navigate('/signin')}>Log in</Btn>
        <Btn v="primary" sz="sm" onClick={() => navigate('/signup')}>Start free <ArrowRight size={13}/></Btn>
        <button onClick={onDrawer} style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, border: '1.5px solid #E2DDD6', background: 'transparent', cursor: 'pointer', color: '#6B6B80', transition: 'border-color .2s' }}
          onMouseEnter={e => e.currentTarget.style.borderColor = B}
          onMouseLeave={e => e.currentTarget.style.borderColor = '#E2DDD6'}>
          <Menu size={18}/>
        </button>
      </div>
    </header>
  );
}

/* ══════════════ DRAWER ══════════════ */
function Drawer({ open, onClose }) {
  const navigate = useNavigate();
  const nav = [
    { icon: BookOpen,    label: 'Courses',      id: '#courses' },
    { icon: Zap,         label: 'Features',     id: '#features' },
    { icon: Map,         label: 'How It Works', id: '#how-it-works' },
    { icon: TrendingUp,  label: 'Outcomes',     id: '#outcomes' },
    { icon: DollarSign,  label: 'Pricing',      id: '#pricing' },
    { icon: Users,       label: 'Instructors',  id: '#instructors' },
    { icon: MessageSquare, label: 'FAQ',        id: '#faq' },
  ];
  const go = (id) => { onClose(); setTimeout(() => document.querySelector(id)?.scrollIntoView({ behavior: 'smooth' }), 260); };
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 960, background: 'rgba(0,0,0,.28)', backdropFilter: 'blur(4px)', opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity .3s' }}/>
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 961, width: 300, background: '#fff', boxShadow: '-8px 0 40px rgba(0,0,0,.12)', display: 'flex', flexDirection: 'column', padding: 24, overflowY: 'auto', transform: open ? 'translateX(0)' : 'translateX(100%)', transition: 'transform .36s cubic-bezier(.4,0,.2,1)', fontFamily: "'DM Sans',sans-serif" }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: `linear-gradient(135deg,${B},${B2})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Brain size={15} color="#fff" strokeWidth={2.5}/></div>
            <span className="fs" style={{ fontSize: 19, color: '#1A1A2E' }}>Akoro</span>
          </div>
          <button onClick={onClose} style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: '#F5F3EE', border: 'none', cursor: 'pointer', color: '#6B6B80' }}><X size={16}/></button>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          {nav.map(({ icon: Icon, label, id }) => (
            <button key={label} onClick={() => go(id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, fontWeight: 500, color: '#6B6B80', textAlign: 'left', transition: 'all .18s', fontFamily: 'inherit' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#F5F3EE'; e.currentTarget.style.color = '#1A1A2E'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#6B6B80'; }}>
              <Icon size={15}/>{label}
            </button>
          ))}
        </nav>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24, paddingTop: 20, borderTop: '1px solid #EDE8E1' }}>
          <Btn v="outline" onClick={() => { onClose(); navigate('/signin'); }} style={{ width: '100%', justifyContent: 'center' }}>Log in</Btn>
          <Btn v="primary" onClick={() => { onClose(); navigate('/signup'); }} style={{ width: '100%', justifyContent: 'center' }}>Start for free <ArrowRight size={13}/></Btn>
        </div>
      </div>
    </>
  );
}

/* ══════════════ HERO ══════════════ */
function Hero({ onSignup }) {
  const stats = [
    { icon: <Cpu size={20} color={B}/>, label: 'Active Agents',   val: '12,400+', sub: 'students worldwide' },
    { icon: <Brain size={20} color={B}/>, label: 'Avg Retention', val: '89%',     sub: 'vs 17% passive video' },
    { icon: <Swords size={20} color={B}/>, label: 'Agent Battles',val: '340K+',   sub: 'knowledge duels fought' },
    { icon: <School size={20} color={B}/>, label: 'Partner Schools',val: '280+',  sub: 'across Nigeria & Africa' },
  ];
  return (
    <section style={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '120px 24px 80px', textAlign: 'center', background: '#fff', overflow: 'hidden' }}>
      <div className="hero-grid" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}/>
      <div style={{ position: 'absolute', top: -200, left: '50%', transform: 'translateX(-50%)', width: 700, height: 500, borderRadius: '50%', background: `radial-gradient(circle,${B}20 0%,transparent 70%)`, filter: 'blur(60px)', pointerEvents: 'none' }}/>
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 820, width: '100%' }}>
        <div className="fu1" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: `${B}10`, border: `1px solid ${B}30`, borderRadius: 99, padding: '6px 16px', marginBottom: 28 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: B }} className="pdot"/>
          <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 11, fontWeight: 700, color: B, letterSpacing: '0.12em', textTransform: 'uppercase' }}>AI-Powered Adaptive Learning</span>
        </div>
        <h1 className="fu2 fs" style={{ fontSize: 'clamp(38px,6.5vw,72px)', lineHeight: 1.08, color: '#1A1A2E', letterSpacing: '-0.025em', marginBottom: 20 }}>
          Your AI learns <em style={{ color: B, fontStyle: 'italic' }}>everything</em>
          <br/> you teach it —<br/>then teaches you back.
        </h1>
        <p className="fu3" style={{ fontSize: 'clamp(16px,2vw,19px)', color: '#6B6B80', maxWidth: 560, margin: '0 auto 20px', lineHeight: 1.7 }}>
          For students and teachers who want to <strong style={{ color: '#1A1A2E' }}>actually remember</strong> what they learn. Your personal AI agent NaNa studies with you, battles for you, and grows alongside you.
        </p>
        <div className="fu4" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 32, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex' }}>{[...Array(5)].map((_, i) => <Star key={i} size={13} fill={GL} strokeWidth={0}/>)}</div>
          <span style={{ fontSize: 13, color: '#9490A0' }}>Trusted by <strong style={{ color: '#1A1A2E' }}>12,400+</strong> students across <strong style={{ color: '#1A1A2E' }}>38</strong> countries</span>
        </div>
        <div className="fu5" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 64, flexWrap: 'wrap' }}>
          <Btn v="primary" sz="lg" onClick={onSignup}>Get your first lesson free <ArrowRight size={16}/></Btn>
          <Btn v="outline" sz="lg"><Play size={14} fill={B} color={B} style={{ flexShrink: 0 }}/> See how it works</Btn>
        </div>
        <div className="fu5" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, maxWidth: 820 }}>
          {stats.map(({ icon, label, val, sub }, i) => (
            <div key={i} style={{ background: '#fff', border: '1px solid #EDE8E1', borderRadius: 16, padding: '18px 20px', textAlign: 'left', boxShadow: '0 2px 12px rgba(0,0,0,.05)', transition: 'transform .2s,box-shadow .2s', cursor: 'default' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = `0 10px 28px ${B}14`; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,.05)'; }}>
              <div style={{ marginBottom: 10 }}>{icon}</div>
              <div className="fsyne" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9490A0', marginBottom: 4 }}>{label}</div>
              <div className="fsyne" style={{ fontSize: 22, fontWeight: 800, color: '#1A1A2E', lineHeight: 1.1 }}>{val}</div>
              <div style={{ fontSize: 11, color: '#9490A0', marginTop: 3 }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ══════════════ TRUST BAR ══════════════ */
function TrustBar() {
  const logos = ['UNILAG', 'Covenant Uni', 'KNUST Ghana', 'UCT Cape Town', 'British Council', 'TechCabal'];
  const ratings = [{ score: '4.9', p: 'G2' }, { score: '4.8', p: 'Trustpilot' }, { score: '4.9', p: 'Google' }];
  const badges = [{ icon: <Shield size={12}/>, label: 'FERPA' }, { icon: <Lock size={12}/>, label: 'NDPR' }, { icon: <Award size={12}/>, label: 'ISO 27001' }];
  const sep = <div style={{ width: 1, height: 28, background: '#DDD8CF', flexShrink: 0 }}/>;
  return (
    <div style={{ borderTop: '1px solid #EDE8E1', borderBottom: '1px solid #EDE8E1', background: '#FAF8F5', padding: '24px', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
        <span className="fsyne" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9490A0' }}>Trusted by</span>
        {sep}
        <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap', justifyContent: 'center' }}>
          {logos.map(l => <span key={l} className="fsyne" style={{ fontSize: 13, fontWeight: 700, color: '#ACACB8', cursor: 'default' }}>{l}</span>)}
        </div>
        {sep}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', justifyContent: 'center' }}>
          {ratings.map(({ score, p }) => (
            <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ display: 'flex' }}>{[...Array(5)].map((_, i) => <Star key={i} size={11} fill={GL} strokeWidth={0}/>)}</div>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#1A1A2E' }}>{score}</span>
              <span style={{ fontSize: 12, color: '#9490A0' }}>· {p}</span>
            </div>
          ))}
        </div>
        {sep}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {badges.map(({ icon, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, background: '#fff', border: '1px solid #DDD8CF', fontSize: 11, fontWeight: 600, color: '#6B6B80' }}>{icon}{label}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ══════════════ PROBLEM / SOLUTION ══════════════ */
function ProblemSolution() {
  const card = (style) => ({ borderRadius: 24, padding: '36px 32px', height: '100%', ...style });
  const row = (icon, text, good) => (
    <div key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 15, color: good ? '#2A2A3E' : '#6B6B80', marginBottom: 14 }}>
      {good ? <CheckCircle2 size={16} color={B} style={{ flexShrink: 0, marginTop: 2 }}/> : <XCircle size={16} color="#C9C5BE" style={{ flexShrink: 0, marginTop: 2 }}/>}
      {text}
    </div>
  );
  return (
    <section id="problem" style={{ padding: '96px 24px', background: '#fff', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ marginBottom: 48 }}>
          <SL>The problem</SL>
          <h2 className="fs" style={{ fontSize: 'clamp(28px,4vw,48px)', color: '#1A1A2E', letterSpacing: '-0.02em', lineHeight: 1.15, maxWidth: 480 }}>Education is stuck in the wrong century.</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 20 }}>
          <Reveal>
            <div style={card({ background: '#FAF8F5', border: '1px solid #EDE8E1' })}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 99, background: '#F0ECE6', border: '1px solid #DDD8CF', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9490A0', marginBottom: 20 }}><AlertCircle size={10}/>The old way</div>
              <h3 className="fs" style={{ fontSize: 26, color: '#1A1A2E', lineHeight: 1.25, marginBottom: 24 }}>Passive, forgettable, one-size-fits-all</h3>
              {["Sit through 2-hour video lectures you'll forget by morning", "No feedback loop — you don't know what you don't know", '83% of online learners quit before finishing', "Generic AI tutors that don't know your curriculum", 'Pay for content you never finish'].map(t => row(null, t, false))}
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div style={card({ background: `linear-gradient(140deg,${B}08,${B}03)`, border: `1px solid ${B}25` })}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 99, background: `${B}14`, border: `1px solid ${B}30`, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: B, marginBottom: 20 }}><Sparkles size={10}/>The Akoro way</div>
              <h3 className="fs" style={{ fontSize: 26, color: '#1A1A2E', lineHeight: 1.25, marginBottom: 24 }}>Active, adaptive, deeply personal</h3>
              {['Teach NaNa Esumai your AI, then she teaches you back — bidirectional', 'Spaced repetition knows exactly when to re-test you', 'Agent battles turn studying into competitive sport', 'Aligned to your exact school syllabus', '89% retention vs 17% from passive video — proven'].map(t => row(null, t, true))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ══════════════ HOW IT WORKS ══════════════ */
function HowItWorks() {
  const steps = [
    { num: '01', icon: <Target size={28} color={B}/>, title: 'Pick a topic', desc: 'Choose from curriculum subjects or create your own. Set subtopics and learning objectives — your agent starts calibrated, not cold.' },
    { num: '02', icon: <Brain size={28} color={B}/>, title: 'Teach NaNa Esumai', desc: 'Explain concepts to your AI agent via chat or voice. NaNa listens, asks probing questions, and flags any misconceptions in real time.' },
    { num: '03', icon: <Repeat2 size={28} color={B}/>, title: 'Get assessed by Sargeant', desc: 'Sargeant tests your agent on everything you taught. Your confidence score updates after every assessment — before you forget.' },
    { num: '04', icon: <Trophy size={28} color={B}/>, title: 'Rise the ranks', desc: 'Climb classroom and inter-school leaderboards. Challenge friends, earn XP, and prove your knowledge in live battles.' },
  ];
  return (
    <section id="how-it-works" style={{ padding: '96px 24px', background: '#FAF8F5', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <SL center>How it works</SL>
          <h2 className="fs" style={{ fontSize: 'clamp(28px,4vw,50px)', color: '#1A1A2E', letterSpacing: '-0.02em' }}>
            From first session to <em style={{ color: B, fontStyle: 'italic' }}>top of class</em>
          </h2>
          <p style={{ fontSize: 17, color: '#6B6B80', maxWidth: 520, margin: '12px auto 0', lineHeight: 1.7 }}>Four simple steps that turn passive studying into active mastery.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 20, marginBottom: 36 }}>
          {steps.map(({ num, icon, title, desc }, i) => (
            <Reveal key={num} delay={i * 0.09}>
              <div style={{ background: '#fff', border: '1px solid #EDE8E1', borderRadius: 20, padding: '28px 24px', height: '100%', transition: 'transform .2s,box-shadow .2s', cursor: 'default' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 12px 32px ${B}14`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
                <div className="fsyne" style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: B, marginBottom: 18 }}>STEP {num}</div>
                <div style={{ marginBottom: 16 }}>{icon}</div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1A1A2E', marginBottom: 10, lineHeight: 1.35 }}>{title}</h3>
                <p style={{ fontSize: 14, color: '#6B6B80', lineHeight: 1.7 }}>{desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal>
          <div style={{ borderRadius: 24, padding: '32px 36px', border: `1px solid ${B}25`, background: `linear-gradient(140deg,${B}08,${B}03)`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="fsyne" style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: B, marginBottom: 8 }}>Pro tip</div>
              <h3 className="fs" style={{ fontSize: 22, color: '#1A1A2E', marginBottom: 8 }}>Start with a free skill assessment</h3>
              <p style={{ fontSize: 14, color: '#6B6B80', lineHeight: 1.65 }}>5 minutes. Personalises your journey and boosts completion by up to 50%.</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
              {[['50%', 'completion lift'], ['5 min', 'to personalise']].map(([v, l]) => (
                <div key={l} style={{ textAlign: 'center' }}>
                  <div className="fsyne" style={{ fontSize: 26, fontWeight: 800, color: B }}>{v}</div>
                  <div style={{ fontSize: 12, color: '#9490A0', marginTop: 2 }}>{l}</div>
                </div>
              ))}
              <Btn v="primary">Take free assessment <ArrowRight size={14}/></Btn>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════════════ COURSES (lazy-loaded) ══════════════ */
function Courses() {
  const [mainTab, setMainTab] = useState('recorded');
  const [subTab, setSubTab]   = useState('all');
  const [openSyl, setOpenSyl] = useState(null);
  const [courses, setCourses]  = useState([]);
  const [live, setLive]        = useState([]);
  const [loading, setLoading]  = useState(false);
  const [fetched, setFetched]  = useState(false);
  const sectionRef = useRef(null);

  /* ── Fallback static data ── */
  const STATIC_COURSES = [
    { cat: 'stem',     emoji: '🧮', grad: ['#E8F0FF','#D4E4FF'], title: 'Further Mathematics & Calculus', dur: '48h', rating: '4.9', rev: '1.2k', level: 'Advanced',     price: 'Free',         priceNum: 0,     syllabus: ['Limits & continuity','Differentiation rules','Integration techniques','Differential equations'] },
    { cat: 'stem',     emoji: '🔬', grad: ['#E8FFE8','#D4F0D4'], title: 'Organic Chemistry Mastery',      dur: '36h', rating: '4.8', rev: '890',  level: 'Intermediate', price: '₦18,000/mo',   priceNum: 18000, syllabus: ['Functional groups','Reaction mechanisms','Stereochemistry','Lab simulations'] },
    { cat: 'business', emoji: '💰', grad: ['#FFF8E8','#FFE8C0'], title: 'Financial Literacy & Economics', dur: '24h', rating: '4.9', rev: '2.1k', level: 'Beginner',     price: 'Free',         priceNum: 0,     syllabus: ['Supply & demand','Personal finance','Investment basics','African markets'] },
    { cat: 'languages',emoji: '🗣', grad: ['#F8E8FF','#EDD4FF'], title: 'English Language Mastery',       dur: '40h', rating: '4.7', rev: '3.4k', level: 'All levels',   price: '₦13,500/mo',   priceNum: 13500, syllabus: ['Grammar deep-dive','Essay writing','Comprehension','Oral practice'] },
    { cat: 'stem',     emoji: '💻', grad: ['#E8EFFF','#D0DCFF'], title: 'Intro to Computer Science',      dur: '32h', rating: '4.9', rev: '5.6k', level: 'Beginner',     price: 'Free',         priceNum: 0,     syllabus: ['Algorithms','Python basics','Web fundamentals','Build a project'] },
    { cat: 'arts',     emoji: '📜', grad: ['#FFF3E8','#FFE0C0'], title: 'African History & Civilisations',dur: '28h', rating: '4.8', rev: '780',  level: 'Intermediate', price: '₦13,500/mo',   priceNum: 13500, syllabus: ['Ancient civilisations','Colonial era','Modern politics','Source analysis'] },
  ];
  const STATIC_LIVE = [
    { id: 1, status: 'live',     platform: 'Zoom',        subject: 'Further Mathematics', course: 'Differentiation & Calculus',   teacher: 'Dr. Amara Diallo',   teacherEmoji: '👩🏾‍💻', date: 'Today',    time: '2:00 PM – 3:30 PM WAT', desc: 'Live session covering Chain Rule, Product Rule, and exam-style differentiation questions. Students should complete Modules 1–3 first.', enrolled: 42, present: 38 },
    { id: 2, status: 'upcoming', platform: 'Google Meet', subject: 'Organic Chemistry',   course: 'Reaction Mechanisms',          teacher: 'Prof. Segun Adesanya',teacherEmoji: '👨🏾‍🔬', date: 'Thu 19 Jun',time: '10:00 AM – 11:30 AM WAT', desc: 'SN1 vs SN2 mechanisms with molecular models. Bring past paper questions from 2020–2022.', enrolled: 55, present: null },
    { id: 3, status: 'upcoming', platform: 'MS Teams',    subject: 'English Language',    course: 'Essay Writing Masterclass',    teacher: 'Ms. Priya Krishnan', teacherEmoji: '👩🏻‍🏫', date: 'Fri 20 Jun',time: '4:00 PM – 5:00 PM WAT', desc: 'Intensive WAEC essay writing clinic. We\'ll analyse 5 past paper prompts and peer-review openings live.', enrolled: 60, present: null },
    { id: 4, status: 'recorded', platform: 'Zoom',        subject: 'Computer Science',    course: 'Python Fundamentals',          teacher: 'Dr. Amara Diallo',   teacherEmoji: '👩🏾‍💻', date: 'Mon 9 Jun', time: 'Recorded · 1h 20m', desc: 'Introduction to variables, loops, and functions. Includes live coding exercises and Q&A.', enrolled: 120, present: 98 },
  ];

  /* Lazy load when section enters view */
  useEffect(() => {
    if (fetched) return;
    const el = sectionRef.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      obs.disconnect();
      setFetched(true);
      setLoading(true);
      Promise.all([
        fetch('/api/courses/published').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/live-sessions').then(r => r.ok ? r.json() : null).catch(() => null),
      ]).then(([c, l]) => {
        setCourses(c?.length ? c : STATIC_COURSES);
        setLive(l?.length ? l : STATIC_LIVE);
      }).finally(() => setLoading(false));
    }, { threshold: 0.05 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [fetched]);

  const displayCourses = (courses.length ? courses : STATIC_COURSES).filter(c => subTab === 'all' || c.cat === subTab);
  const displayLive    = (live.length ? live : STATIC_LIVE).filter(s => mainTab === 'live' ? s.status !== 'recorded' : mainTab === 'recorded' ? s.status === 'recorded' : true);

  const StatusBadge = ({ status }) => {
    if (status === 'live') return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 99, background: R, color: '#fff', fontSize: 10, fontWeight: 800 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} className="ldot"/>LIVE
      </span>
    );
    if (status === 'upcoming') return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 99, background: `${B}12`, border: `1px solid ${B}30`, color: B, fontSize: 10, fontWeight: 800 }}>
        <Clock size={9}/>Upcoming
      </span>
    );
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 99, background: '#F0ECE6', color: '#9490A0', fontSize: 10, fontWeight: 800 }}>
        <MonitorPlay size={9}/>Recorded
      </span>
    );
  };

  const PlatBadge = ({ p }) => {
    const cfg = { 'Zoom': '#2D8CFF', 'Google Meet': '#34A853', 'MS Teams': '#5B5EA6' }[p] || B;
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 99, background: cfg, color: '#fff', fontSize: 10, fontWeight: 700 }}><Video size={10}/>{p}</span>;
  };

  const tabBtn = (key, label, active, dot) => (
    <button key={key} onClick={() => setMainTab(key)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontSize: 14, fontWeight: 600, transition: 'all .2s', background: active ? '#fff' : 'transparent', color: active ? '#1A1A2E' : '#6B6B80', boxShadow: active ? '0 1px 6px rgba(0,0,0,.08)' : 'none' }}>
      {key === 'recorded' ? <BookOpen size={14}/> : <Radio size={14}/>}{label}{dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: R, flexShrink: 0 }} className="ldot"/>}
    </button>
  );

  return (
    <section id="courses" ref={sectionRef} style={{ padding: '96px 24px', background: '#fff', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ marginBottom: 36 }}>
          <SL>Courses</SL>
          <h2 className="fs" style={{ fontSize: 'clamp(28px,4vw,50px)', color: '#1A1A2E', letterSpacing: '-0.02em', marginBottom: 10 }}>
            Subjects your agent <em style={{ color: B, fontStyle: 'italic' }}>masters</em> with you
          </h2>
          <p style={{ fontSize: 17, color: '#6B6B80', maxWidth: 500, lineHeight: 1.65 }}>Self-paced courses and live sessions on Zoom, Meet & Teams — one platform for all your learning.</p>
        </div>

        {/* Main tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, padding: 4, background: '#F5F2EC', borderRadius: 14, width: 'fit-content' }}>
          {tabBtn('recorded', 'Self-paced', mainTab === 'recorded', false)}
          {tabBtn('live', 'Live Classes', mainTab === 'live', true)}
        </div>

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#9490A0', fontSize: 14, marginBottom: 24 }}>
            <div style={{ width: 18, height: 18, border: `2px solid ${B}22`, borderTop: `2px solid ${B}`, borderRadius: '50%' }} className="spin"/>
            Loading courses…
          </div>
        )}

        {/* Self-paced */}
        {mainTab === 'recorded' && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28 }}>
              {['all','stem','languages','business','arts'].map(t => (
                <button key={t} onClick={() => setSubTab(t)} style={{ padding: '7px 16px', borderRadius: 99, border: `1.5px solid ${subTab === t ? B : '#DDD8CF'}`, background: subTab === t ? B : '#fff', color: subTab === t ? '#fff' : '#6B6B80', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .2s' }}>
                  {t === 'all' ? 'All subjects' : t === 'stem' ? 'STEM' : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 20 }}>
              {displayCourses.map((c, i) => (
                <Reveal key={c.title} delay={i * 0.07}>
                  <div style={{ background: '#fff', border: '1px solid #EDE8E1', borderRadius: 18, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 2px 12px rgba(0,0,0,.05)', transition: 'transform .2s,box-shadow .2s', cursor: 'default' }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 12px 32px ${B}12`; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,.05)'; }}>
                    <div style={{ height: 130, background: `linear-gradient(135deg,${c.grad[0]},${c.grad[1]})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48, position: 'relative', flexShrink: 0 }}>
                      {c.emoji}
                      <span style={{ position: 'absolute', top: 10, right: 10, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: 'rgba(255,255,255,.8)', color: '#3A3A52' }}>{c.level}</span>
                    </div>
                    <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1A1A2E', marginBottom: 10, lineHeight: 1.4 }}>{c.title}</h3>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: '#9490A0', marginBottom: 14, flexWrap: 'wrap' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={11}/>{c.dur}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Star size={11} fill={GL} strokeWidth={0}/>{c.rating} ({c.rev})</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 12, borderTop: '1px solid #EDE8E1' }}>
                        <span className="fsyne" style={{ fontSize: 17, fontWeight: 800, color: c.priceNum === 0 ? B : '#1A1A2E' }}>{c.price}</span>
                        <button style={{ padding: '6px 14px', borderRadius: 99, border: `1.5px solid #DDD8CF`, background: 'transparent', fontSize: 12, fontWeight: 600, color: '#6B6B80', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .2s' }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = B; e.currentTarget.style.color = B; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = '#DDD8CF'; e.currentTarget.style.color = '#6B6B80'; }}>
                          Enrol now
                        </button>
                      </div>
                      <button onClick={() => setOpenSyl(openSyl === i ? null : i)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: 12, paddingTop: 10, borderTop: '1px solid #EDE8E1', border: 'none', background: 'transparent', fontSize: 12, color: '#9490A0', cursor: 'pointer', fontFamily: 'inherit', transition: 'color .18s' }}
                        onMouseEnter={e => e.currentTarget.style.color = B}
                        onMouseLeave={e => e.currentTarget.style.color = '#9490A0'}>
                        Preview syllabus
                        <ChevronDown size={12} style={{ transform: openSyl === i ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}/>
                      </button>
                      {openSyl === i && (
                        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
                          {c.syllabus.map(s => (
                            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6B6B80' }}>
                              <div style={{ width: 5, height: 5, borderRadius: '50%', background: B, opacity: .7, flexShrink: 0 }}/>{s}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </>
        )}

        {/* Live classes */}
        {mainTab === 'live' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {displayLive.map((s, i) => (
              <Reveal key={s.id} delay={i * 0.06}>
                <div style={{ background: '#fff', border: `1px solid ${s.status === 'live' ? '#FECACA' : '#EDE8E1'}`, borderRadius: 18, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,.05)' }}>
                  <div style={{ padding: '14px 20px', borderBottom: `1px solid ${s.status === 'live' ? '#FEE2E2' : '#EDE8E1'}`, background: s.status === 'live' ? '#FFF5F5' : '#FAF8F5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <StatusBadge status={s.status}/>
                      <PlatBadge p={s.platform}/>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#6B6B80' }}>{s.subject}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9490A0' }}>
                      <CalendarDays size={12}/>{s.date} · {s.time}
                    </div>
                  </div>
                  <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <h3 style={{ fontSize: 17, fontWeight: 700, color: '#1A1A2E', marginBottom: 6 }}>{s.course}</h3>
                      <p style={{ fontSize: 14, color: '#6B6B80', lineHeight: 1.65, marginBottom: 14 }}>{s.desc}</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', fontSize: 12, color: '#9490A0' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#EDE8E1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{s.teacherEmoji}</div>
                          <span style={{ fontWeight: 600, color: '#3A3A52' }}>{s.teacher}</span>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><UserCheck size={12}/>{s.enrolled} enrolled</span>
                        {s.present !== null && <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: s.status === 'live' ? G : '#9490A0', fontWeight: 600 }}><Users size={12}/>{s.present} {s.status === 'live' ? 'online' : 'attended'}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
                      {s.status === 'live'     && <Btn v="green" sz="sm"><Radio size={13}/>Join now</Btn>}
                      {s.status === 'upcoming' && <Btn v="primary" sz="sm"><CalendarDays size={13}/>RSVP</Btn>}
                      {s.status === 'recorded' && <Btn v="outline" sz="sm"><MonitorPlay size={13}/>Watch replay</Btn>}
                      <span style={{ fontSize: 11, color: '#9490A0', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><ExternalLink size={10}/>Open in {s.platform}</span>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
            <Reveal>
              <div style={{ borderRadius: 18, padding: '24px 28px', border: `1.5px dashed ${B}40`, background: `${B}04`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
                <div>
                  <div className="fsyne" style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: B, marginBottom: 4 }}>For teachers</div>
                  <h4 className="fs" style={{ fontSize: 20, color: '#1A1A2E', marginBottom: 4 }}>Want to host a live class?</h4>
                  <p style={{ fontSize: 14, color: '#6B6B80' }}>Schedule on Zoom, Google Meet, or Teams. Your students see it here automatically.</p>
                </div>
                <Btn v="primary">Schedule a class <ArrowRight size={14}/></Btn>
              </div>
            </Reveal>
          </div>
        )}
      </div>
    </section>
  );
}

/* ══════════════ FEATURES ══════════════ */
function Features() {
  const feats = [
    { icon: <Brain size={18}/>, title: 'Bidirectional AI Learning',    desc: 'Teach NaNa Esumai, then she quizzes you back at the exact forgetting-curve moment.', badge: 'Core feature' },
    { icon: <Swords size={18}/>, title: 'Agent Battles',               desc: 'Your AI competes against other agents — inter-school, inter-class, 1v1. Revision becomes sport.', badge: 'Gamification' },
    { icon: <Repeat2 size={18}/>, title: 'Spaced Repetition Engine',   desc: 'Sargeant tracks every concept and resurfaces it at exactly the right time — before you forget.', badge: 'Science-backed' },
    { icon: <BarChart3 size={18}/>, title: 'Knowledge Progress Map',   desc: 'Visual map of every concept taught. See what you know, what\'s shaky, and what\'s next.', badge: 'Progress tracking' },
    { icon: <Mic size={18}/>, title: 'Multi-modal Input',              desc: 'Teach via chat, voice, or whiteboard. NaNa understands all three.', badge: 'Accessibility' },
    { icon: <School size={18}/>, title: 'School Dashboard',            desc: 'Teachers see class-wide agent performance, knowledge gaps, and battle rankings. NDPR-compliant.', badge: 'B2B / Schools' },
    { icon: <WifiOff size={18}/>, title: 'Offline Access',             desc: 'Built for students across Nigeria and Africa. Sync when you reconnect.', badge: 'Offline-first' },
    { icon: <Trophy size={18}/>, title: 'XP, Badges & Leaderboards',   desc: 'Every lesson, battle, and streak earns XP. Climb school and inter-school leaderboards.', badge: 'Gamification' },
    { icon: <Link2 size={18}/>, title: 'Curriculum Partners',          desc: 'Connected to WAEC, JAMB, NECO — and aligned to your school\'s exact syllabus.', badge: 'Integrations' },
  ];
  return (
    <section id="features" style={{ padding: '96px 24px', background: '#FAF8F5', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ marginBottom: 52 }}>
          <SL>Features</SL>
          <h2 className="fs" style={{ fontSize: 'clamp(28px,4vw,50px)', color: '#1A1A2E', letterSpacing: '-0.02em', marginBottom: 10 }}>
            Built for how brains <em style={{ color: B, fontStyle: 'italic' }}>actually</em> work
          </h2>
          <p style={{ fontSize: 17, color: '#6B6B80', maxWidth: 500, lineHeight: 1.65 }}>Every feature is grounded in cognitive science — not just engagement metrics.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 18 }}>
          {feats.map(({ icon, title, desc, badge }, i) => (
            <Reveal key={title} delay={i * 0.06}>
              <div style={{ background: '#fff', border: '1px solid #EDE8E1', borderRadius: 18, padding: '26px 24px', height: '100%', transition: 'transform .2s,box-shadow .2s', cursor: 'default' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 12px 32px ${B}12`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: `${B}10`, border: `1px solid ${B}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: B, marginBottom: 18 }}>{icon}</div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1A1A2E', marginBottom: 8 }}>{title}</h3>
                <p style={{ fontSize: 13.5, color: '#6B6B80', lineHeight: 1.7, marginBottom: 14 }}>{desc}</p>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, background: `${B}10`, color: B }}>{badge}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ══════════════ OUTCOMES ══════════════ */
function Outcomes() {
  const metrics = [
    { val: '89%', label: 'knowledge retention rate' },
    { val: '3.4×', label: 'faster exam readiness' },
    { val: '78%', label: 'course completion rate' },
    { val: '₦2M+', label: 'avg salary boost (career learners)' },
  ];
  const testimonials = [
    { stars: 5, quote: 'I failed Further Maths twice before Akoro. The agent battles made me actually want to study. Passed with a B2 at WASSCE.', emoji: '👦🏾', bg: '#D4EAD8', name: 'Chukwuemeka Obi', role: 'SS3 Student, Lagos', result: 'D7 → B2 in 4 months' },
    { stars: 5, quote: 'As a teacher with 60 students, the class dashboard is a game-changer. I know who\'s falling behind before the exam — not after.', emoji: '👩🏾‍🏫', bg: '#E4D4F0', name: 'Mrs. Adaeze Nwosu', role: 'Physics Teacher, Enugu', result: '60% → 91% pass rate' },
    { stars: 5, quote: 'I prepped for IELTS alongside a full-time job. 20 mins a day via spaced repetition got me from 6.0 to 7.5.', emoji: '👨🏾‍💼', bg: '#F0E4C8', name: 'Kofi Mensah', role: 'Engineer, Accra → UK', result: 'IELTS 6.0 → 7.5' },
  ];
  return (
    <section id="outcomes" style={{ padding: '96px 24px', background: '#fff', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <SL center>Results</SL>
          <h2 className="fs" style={{ fontSize: 'clamp(28px,4vw,50px)', color: '#1A1A2E', letterSpacing: '-0.02em' }}>
            Numbers that matter, not <em style={{ color: B, fontStyle: 'italic' }}>vanity metrics</em>
          </h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16, marginBottom: 36 }}>
          {metrics.map(({ val, label }, i) => (
            <Reveal key={i} delay={i * 0.08}>
              <div style={{ background: '#FAF8F5', border: '1px solid #EDE8E1', borderRadius: 18, padding: '28px 24px', textAlign: 'center', transition: 'transform .2s', cursor: 'default' }}
                onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-3px)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'none'}>
                <div className="fsyne" style={{ fontSize: 40, fontWeight: 800, color: B, marginBottom: 8 }}>{val}</div>
                <div style={{ fontSize: 13, color: '#6B6B80', lineHeight: 1.5 }}>{label}</div>
              </div>
            </Reveal>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 18 }}>
          {testimonials.map(({ stars, quote, emoji, bg, name, role, result }, i) => (
            <Reveal key={i} delay={i * 0.1}>
              <div style={{ background: '#fff', border: '1px solid #EDE8E1', borderRadius: 18, padding: '28px 24px', display: 'flex', flexDirection: 'column', height: '100%', boxShadow: '0 2px 12px rgba(0,0,0,.05)' }}>
                <div style={{ display: 'flex', marginBottom: 12 }}>{[...Array(stars)].map((_, j) => <Star key={j} size={13} fill={GL} strokeWidth={0}/>)}</div>
                <p style={{ fontSize: 15, color: '#3A3A52', lineHeight: 1.75, fontStyle: 'italic', marginBottom: 20, flex: 1 }}>"{quote}"</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{emoji}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#1A1A2E' }}>{name}</div>
                    <div style={{ fontSize: 12, color: '#9490A0' }}>{role}</div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, padding: '2px 8px', borderRadius: 99, background: '#E8F8EE', color: '#2AA76E', fontSize: 10, fontWeight: 700 }}><TrendingUp size={9}/>{result}</div>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ══════════════ PRICING ══════════════ */
function Pricing() {
  const [yearly, setYearly]   = useState(false);
  const [tab, setTab]          = useState('individual');

  const indiv = [{
    tier: 'Pro', monthlyPrice: 18000, yearlyPrice: 12960, unit: '/mo', featured: true,
    desc: 'For classrooms, teachers, instructors, and tutors who want real results.',
    badge: 'For educators & classrooms',
    features: [[true,'1 AI agent (NaNa Esumai)'],[true,'1 classroom'],[true,'Up to 20 students / learners'],[true,'Unlimited subjects'],[true,'Unlimited agent battles'],[true,'Full knowledge map'],[true,'WAEC/JAMB/NECO curriculum sync'],[true,'Offline access'],[true,'Verifiable certificates']],
    cta: 'Start 14-day free trial →', v: 'primary',
  }];

  const enterprise = [
    {
      tier: 'Starter', monthlyPrice: 85000, yearlyPrice: 61200, unit: '/mo', featured: false,
      desc: 'For growing schools and tutoring centres.',
      badge: 'Per school · up to 150 students',
      features: [[true,'Everything in Pro'],[true,'3 classrooms'],[true,'Teacher management tools'],[true,'Custom syllabus upload'],[true,'Inter-class battle leagues'],[true,'Dedicated support'],[false,'Custom School Management System'],[false,'API access']],
      cta: 'Get started →', v: 'outline',
    },
    {
      tier: 'Enterprise Pro', monthlyPrice: null, yearlyPrice: null, unit: '', featured: true,
      desc: 'Full institutional deployment for large schools and networks.',
      badge: 'Custom pricing · unlimited students',
      features: [[true,'Everything in Starter'],[true,'Custom School Management System'],[true,'Unlimited classrooms'],[true,'Multi-school / district management'],[true,'Custom branding & white-label'],[true,'Priority SLA & onboarding'],[true,'API access & integrations'],[true,'NDPR / FERPA compliance suite']],
      cta: 'Contact sales →', v: 'dark',
    },
  ];

  const plans = tab === 'individual' ? indiv : enterprise;

  return (
    <section id="pricing" style={{ padding: '96px 24px', background: '#FAF8F5', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <SL center>Pricing</SL>
          <h2 className="fs" style={{ fontSize: 'clamp(28px,4vw,50px)', color: '#1A1A2E', letterSpacing: '-0.02em' }}>
            Honest pricing. No <em style={{ color: B, fontStyle: 'italic' }}>surprises.</em>
          </h2>
        </div>

        {/* Tab toggle */}
        <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 28, padding: 4, background: '#F0ECE6', borderRadius: 14, width: 'fit-content', margin: '0 auto 28px' }}>
          {[{ key: 'individual', icon: <Users size={14}/>, label: 'Individual' }, { key: 'enterprise', icon: <Building2 size={14}/>, label: 'Enterprise (Licensing)' }].map(({ key, icon, label }) => (
            <button key={key} onClick={() => setTab(key)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, transition: 'all .2s', background: tab === key ? '#fff' : 'transparent', color: tab === key ? '#1A1A2E' : '#6B6B80', boxShadow: tab === key ? '0 1px 6px rgba(0,0,0,.08)' : 'none' }}>
              {icon}{label}
            </button>
          ))}
        </div>

        {/* Yearly toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 36, fontSize: 14, fontWeight: 500 }}>
          <span style={{ color: !yearly ? '#1A1A2E' : '#9490A0' }}>Monthly</span>
          <button onClick={() => setYearly(v => !v)} style={{ width: 46, height: 24, borderRadius: 99, background: yearly ? B : '#DDD8CF', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background .2s' }}>
            <div style={{ position: 'absolute', width: 16, height: 16, background: '#fff', borderRadius: '50%', top: 4, left: yearly ? 26 : 4, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }}/>
          </button>
          <span style={{ color: yearly ? '#1A1A2E' : '#9490A0' }}>Yearly</span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: '#E8F8EE', color: '#2AA76E', opacity: yearly ? 1 : 0.4, transition: 'opacity .2s' }}>Save 28%</span>
        </div>

        {/* Individual — single centred card */}
        {tab === 'individual' && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ maxWidth: 420, width: '100%' }}>
              {indiv.map(plan => (
                <Reveal key={plan.tier}>
                  <div style={{ position: 'relative', borderRadius: 24, padding: '40px 36px', border: `1px solid ${B}30`, background: `linear-gradient(150deg,${B}06,${B}02)`, boxShadow: `0 6px 36px ${B}18` }}>
                    <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: `linear-gradient(135deg,${B},${B2})`, color: '#fff', fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '4px 16px', borderRadius: 99, boxShadow: `0 4px 14px ${B}40`, whiteSpace: 'nowrap' }}>Most popular</div>
                    <div className="fsyne" style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9490A0', marginBottom: 8 }}>{plan.tier}</div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, background: '#F0ECE6', fontSize: 10, fontWeight: 600, color: '#6B6B80', marginBottom: 12 }}><School size={10}/>{plan.badge}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, marginBottom: 6 }}>
                      <span style={{ fontSize: 18, fontWeight: 700, color: '#1A1A2E', alignSelf: 'flex-start', marginTop: 8 }}>₦</span>
                      <span className="fsyne" style={{ fontSize: 48, fontWeight: 800, color: '#1A1A2E', lineHeight: 1 }}>{(yearly ? plan.yearlyPrice : plan.monthlyPrice).toLocaleString('en-NG')}</span>
                      <span style={{ fontSize: 13, color: '#9490A0' }}>{plan.unit}</span>
                    </div>
                    <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 28, lineHeight: 1.65 }}>{plan.desc}</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
                      {plan.features.map(([on, label], j) => (
                        <div key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, color: on ? '#2A2A3E' : '#B8B2C8', textDecoration: on ? 'none' : 'line-through' }}>
                          <Check size={14} color={on ? B : '#C9C5BE'} style={{ flexShrink: 0, marginTop: 2 }} strokeWidth={2.5}/>{label}
                        </div>
                      ))}
                    </div>
                    <Btn v={plan.v} style={{ width: '100%', justifyContent: 'center' }}>{plan.cta}</Btn>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        )}

        {/* Enterprise — 2 cards */}
        {tab === 'enterprise' && (
          <>
            <Reveal>
              <div style={{ borderRadius: 16, padding: '18px 20px', border: `1px solid ${B}25`, background: `${B}06`, display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 24 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: `${B}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Building2 size={15} color={B}/></div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>Enterprise Licensing</div>
                  <p style={{ fontSize: 12.5, color: '#6B6B80', lineHeight: 1.65 }}>License Akoro for your school, tutoring centre, or district. Includes school-wide dashboards, teacher tools, inter-class battles, and optionally a full Custom School Management System.</p>
                </div>
              </div>
            </Reveal>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20, maxWidth: 720, margin: '0 auto' }}>
              {enterprise.map(plan => (
                <Reveal key={plan.tier}>
                  <div style={{ position: 'relative', borderRadius: 24, padding: '32px 28px', border: plan.featured ? `1px solid ${B}30` : '1px solid #EDE8E1', background: plan.featured ? `linear-gradient(150deg,${B}06,${B}02)` : '#fff', boxShadow: plan.featured ? `0 6px 36px ${B}18` : '0 2px 14px rgba(0,0,0,.05)', display: 'flex', flexDirection: 'column', height: '100%' }}>
                    {plan.featured && <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: `linear-gradient(135deg,${B},${B2})`, color: '#fff', fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '4px 14px', borderRadius: 99, whiteSpace: 'nowrap' }}>Full Platform</div>}
                    <div className="fsyne" style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9490A0', marginBottom: 8 }}>{plan.tier}</div>
                    {plan.monthlyPrice === null
                      ? <div className="fsyne" style={{ fontSize: 40, fontWeight: 800, color: '#1A1A2E', lineHeight: 1, marginBottom: 6 }}>Custom</div>
                      : <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, marginBottom: 6 }}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: '#1A1A2E', alignSelf: 'flex-start', marginTop: 6 }}>₦</span>
                          <span className="fsyne" style={{ fontSize: 40, fontWeight: 800, color: '#1A1A2E', lineHeight: 1 }}>{(yearly ? plan.yearlyPrice : plan.monthlyPrice).toLocaleString('en-NG')}</span>
                          <span style={{ fontSize: 13, color: '#9490A0' }}>{plan.unit}</span>
                        </div>
                    }
                    <p style={{ fontSize: 13.5, color: '#6B6B80', marginBottom: 24, lineHeight: 1.65 }}>{plan.desc}</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 24, flex: 1 }}>
                      {plan.features.map(([on, label], j) => (
                        <div key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5, color: on ? '#2A2A3E' : '#B8B2C8', textDecoration: on ? 'none' : 'line-through' }}>
                          <Check size={13} color={on ? B : '#C9C5BE'} style={{ flexShrink: 0, marginTop: 2 }} strokeWidth={2.5}/>{label}
                        </div>
                      ))}
                    </div>
                    <Btn v={plan.v} style={{ width: '100%', justifyContent: 'center' }}>{plan.cta}</Btn>
                  </div>
                </Reveal>
              ))}
            </div>
          </>
        )}

        <Reveal>
          <div style={{ marginTop: 24, textAlign: 'center', padding: '16px 20px', borderRadius: 16, background: '#fff', border: '1px solid #EDE8E1', fontSize: 14, color: '#6B6B80' }}>
            <Shield size={14} style={{ display: 'inline', marginRight: 6, color: B }}/><strong style={{ color: '#1A1A2E' }}>30-day money-back guarantee</strong> — if Akoro doesn't improve your scores, we'll refund every penny.{' '}
            <span style={{ color: B, cursor: 'pointer', textDecoration: 'underline' }}>Financial aid available</span> for students in need.
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════════════ INSTRUCTORS (lazy-loaded) ══════════════ */
function Instructors() {
  const [instructors, setInstructors] = useState([]);
  const [loading, setLoading]         = useState(false);
  const [fetched, setFetched]         = useState(false);
  const sectionRef = useRef(null);

  const STATIC = [
    { emoji: '👩🏾‍💻', bg: '#C8E8D4', name: 'Dr. Amara Diallo',    subject: 'Mathematics & Statistics', score: '4.9', rev: '2.4k', bio: 'PhD from Cape Town. Former WAEC examiner. 14 years teaching Further Maths.' },
    { emoji: '👨🏾‍🔬', bg: '#D4C8E8', name: 'Prof. Segun Adesanya', subject: 'Chemistry & Biology',      score: '4.8', rev: '1.8k', bio: 'Oxford-trained biochemist. Published in Nature. IGCSE specialist.' },
    { emoji: '👩🏻‍🏫', bg: '#F0E4C8', name: 'Ms. Priya Krishnan',  subject: 'English & Language Arts',  score: '4.9', rev: '3.1k', bio: 'Cambridge-certified IELTS trainer. Helps 500+ students/year hit 7.0+.' },
    { emoji: '👨🏾‍💼', bg: '#C8D8E8', name: 'Kwame Asante',        subject: 'Economics & Finance',       score: '4.8', rev: '1.2k', bio: 'LSE grad, former World Bank economist. Makes macro econ make sense.' },
  ];

  useEffect(() => {
    if (fetched) return;
    const el = sectionRef.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      obs.disconnect(); setFetched(true); setLoading(true);
      fetch('/api/instructors/featured')
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
        .then(data => setInstructors(data?.length ? data : STATIC))
        .finally(() => setLoading(false));
    }, { threshold: 0.05 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [fetched]);

  const display = instructors.length ? instructors : STATIC;

  return (
    <section id="instructors" ref={sectionRef} style={{ padding: '96px 24px', background: '#fff', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ marginBottom: 48 }}>
          <SL>Instructors</SL>
          <h2 className="fs" style={{ fontSize: 'clamp(28px,4vw,50px)', color: '#1A1A2E', letterSpacing: '-0.02em' }}>
            Taught by people who <em style={{ color: B, fontStyle: 'italic' }}>actually know</em> their subject
          </h2>
        </div>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#9490A0', fontSize: 14, marginBottom: 24 }}>
            <div style={{ width: 18, height: 18, border: `2px solid ${B}22`, borderTop: `2px solid ${B}`, borderRadius: '50%' }} className="spin"/>
            Loading instructors…
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 18 }}>
          {display.map(({ emoji, bg, name, subject, score, rev, bio }, i) => (
            <Reveal key={name} delay={i * 0.1}>
              <div style={{ background: '#FAF8F5', border: '1px solid #EDE8E1', borderRadius: 18, padding: '28px 22px', textAlign: 'center', transition: 'transform .2s,box-shadow .2s', cursor: 'default' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 12px 32px ${B}12`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, margin: '0 auto 16px' }}>{emoji}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>{name}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: B, marginBottom: 10 }}>{subject}</div>
                <p style={{ fontSize: 12.5, color: '#6B6B80', lineHeight: 1.65, marginBottom: 14 }}>{bio}</p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12 }}>
                  <div style={{ display: 'flex' }}>{[...Array(5)].map((_, j) => <Star key={j} size={11} fill={GL} strokeWidth={0}/>)}</div>
                  <span style={{ fontWeight: 700, color: '#1A1A2E' }}>{score}</span>
                  <span style={{ color: '#9490A0' }}>({rev})</span>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.3}>
          <div style={{ textAlign: 'center', marginTop: 44 }}>
            <p style={{ fontSize: 15, color: '#6B6B80', marginBottom: 18 }}>Are you an educator? Join our growing community of instructors.</p>
            <Btn v="outline">Apply as an Instructor <ArrowRight size={14}/></Btn>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════════════ FAQ ══════════════ */
function FAQ() {
  const [open, setOpen] = useState(0);
  const faqs = [
    ['How much time per week do I need?', 'As little as 20 minutes a day. Our spaced repetition engine is designed for busy schedules — short daily sessions beat occasional long ones.'],
    ['Do I get a certificate when I finish?', 'Yes — Pro and Enterprise plans include verifiable digital certificates. Free tier earns achievement badges but not formal certificates.'],
    ['Can I switch or cancel my plan anytime?', 'Absolutely. No contracts. Cancel from settings in 30 seconds. You keep access until the end of your billing period.'],
    ['Is this aligned to WAEC, JAMB, NECO?', 'Yes — we support WAEC, JAMB, NECO, Cambridge IGCSE/A-Level, KCSE, and IB. Schools on Enterprise can also upload custom syllabi and past questions.'],
    ['How is my data protected?', 'NDPR, FERPA, and GDPR aligned. We never sell student data. TLS 1.3 in transit, AES-256 at rest.'],
    ['What\'s the difference between Enterprise Starter and Enterprise Pro?', 'Starter gives you up to 3 classrooms and teacher tools. Enterprise Pro adds a Custom School Management System, unlimited classrooms, multi-school management, and white-labelling.'],
    ['Does it work offline?', 'Yes — Pro and Enterprise plans cache lessons on-device and sync when you reconnect. Built for Nigerian students with unreliable internet.'],
    ['How do live classes work?', 'Teachers schedule sessions on Zoom, Google Meet, or Microsoft Teams and link them to Akoro. Students see the schedule, join directly, and recordings are available after.'],
  ];
  return (
    <section id="faq" style={{ padding: '96px 24px', background: '#FAF8F5', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 52 }}>
          <SL center>FAQ</SL>
          <h2 className="fs" style={{ fontSize: 'clamp(28px,4vw,50px)', color: '#1A1A2E', letterSpacing: '-0.02em' }}>
            Questions we <em style={{ color: B, fontStyle: 'italic' }}>actually get</em> asked
          </h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(480px,1fr))', gap: 12 }}>
          {faqs.map(([q, a], i) => (
            <Reveal key={i} delay={(i % 2) * 0.08}>
              <div style={{ background: '#fff', border: `1px solid ${open === i ? `${B}30` : '#EDE8E1'}`, borderRadius: 14, overflow: 'hidden', transition: 'border-color .2s' }}>
                <button onClick={() => setOpen(open === i ? null : i)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '20px 22px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', fontSize: 15, fontWeight: 600, color: open === i ? B : '#1A1A2E', transition: 'color .18s' }}>
                  {q}
                  <ChevronDown size={14} color={open === i ? B : '#9490A0'} style={{ flexShrink: 0, transform: open === i ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}/>
                </button>
                {open === i && <p style={{ fontSize: 14, color: '#6B6B80', lineHeight: 1.75, padding: '0 22px 20px', borderTop: '1px solid #EDE8E1', paddingTop: 16 }}>{a}</p>}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ══════════════ FINAL CTA ══════════════ */
function FinalCTA({ onSignup }) {
  const navigate = useNavigate();
  return (
    <section style={{ position: 'relative', padding: '96px 24px', textAlign: 'center', overflow: 'hidden', background: `linear-gradient(160deg,${B}08,${B}03,${B}06)`, fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 55% 55% at 50% 50%,${B}18 0%,transparent 70%)`, pointerEvents: 'none' }}/>
      <Reveal>
        <div style={{ position: 'relative', zIndex: 1, maxWidth: 640, margin: '0 auto' }}>
          <SL center>Get started</SL>
          <h2 className="fs" style={{ fontSize: 'clamp(32px,5vw,58px)', color: '#1A1A2E', letterSpacing: '-0.025em', lineHeight: 1.1, marginBottom: 14 }}>
            Your agent is waiting.<br/>Start learning <em style={{ color: B, fontStyle: 'italic' }}>for real.</em>
          </h2>
          <p style={{ fontSize: 17, color: '#6B6B80', marginBottom: 36, lineHeight: 1.65 }}>Free to start. No credit card. Cancel anytime.</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <Btn v="primary" sz="lg" onClick={onSignup}>🎓 Learner Login <ArrowRight size={16}/></Btn>
            <Btn v="dark" sz="lg" onClick={() => navigate('/signin?role=instructor')}><School size={16}/> Instructor Login</Btn>
          </div>
          <p style={{ fontSize: 12, color: '#9490A0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Shield size={11} color={B}/>30-day money-back</span>
            <span>·</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Lock size={11} color={B}/>NDPR & GDPR compliant</span>
            <span>·</span>
            <span>Cancel anytime</span>
          </p>
        </div>
      </Reveal>
    </section>
  );
}

/* ══════════════ FOOTER ══════════════ */
function Footer() {
  const cols = [
    { title: 'Product',     links: ['How it works','Courses','Live Classes','Pricing','Agent Battles','Certifications'] },
    { title: 'For Schools', links: ['Enterprise Starter','Enterprise Pro','School Dashboard','Pilot Programme','NDPR Compliance','Case Studies'] },
    { title: 'Company',     links: ['About Us','Blog','Careers','Press','Contact','Partners'] },
  ];
  const socials = [
    { icon: <FaXTwitter size={14}/>,   label: 'X' },
    { icon: <FaLinkedin size={14}/>,   label: 'LinkedIn' },
    { icon: <FaYoutube size={14}/>,    label: 'YouTube' },
    { icon: <FaInstagram size={14}/>,  label: 'Instagram' },
    { icon: <FaFacebook size={14}/>,   label: 'Facebook' },
  ];
  return (
    <footer style={{ background: '#F5F2EC', borderTop: '1px solid #E2DDD6', padding: '56px 24px 32px', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 48, marginBottom: 48 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: `linear-gradient(135deg,${B},${B2})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Brain size={15} color="#fff" strokeWidth={2.5}/></div>
              <span className="fs" style={{ fontSize: 19, color: '#1A1A2E' }}>Akoro</span>
            </div>
            <p style={{ fontSize: 13.5, color: '#7A7880', lineHeight: 1.7, maxWidth: 240, marginBottom: 20 }}>AI Learning Agents — where NaNa Esumai learns everything you teach her, then teaches you back.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {socials.map(({ icon, label }) => (
                <button key={label} style={{ width: 34, height: 34, borderRadius: 8, background: '#fff', border: '1px solid #DDD8CF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#7A7880', transition: 'all .18s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = B; e.currentTarget.style.color = B; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#DDD8CF'; e.currentTarget.style.color = '#7A7880'; }}>
                  {icon}
                </button>
              ))}
            </div>
          </div>
          {cols.map(({ title, links }) => (
            <div key={title}>
              <h4 className="fsyne" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#1A1A2E', marginBottom: 16 }}>{title}</h4>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {links.map(l => (
                  <li key={l}><a href="#" style={{ fontSize: 13.5, color: '#7A7880', transition: 'color .18s' }}
                    onMouseEnter={e => e.target.style.color = B}
                    onMouseLeave={e => e.target.style.color = '#7A7880'}>{l}</a></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div style={{ paddingTop: 24, borderTop: '1px solid #DDD8CF', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#9490A0' }}>© 2025 Akoro Technologies Ltd. All rights reserved.</span>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {['Privacy Policy','Terms of Service','Cookie Policy','Student Data Policy'].map(l => (
              <a key={l} href="#" style={{ fontSize: 12, color: '#9490A0', transition: 'color .18s' }}
                onMouseEnter={e => e.target.style.color = B}
                onMouseLeave={e => e.target.style.color = '#9490A0'}>{l}</a>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['NDPR','FERPA','GDPR','ISO 27001'].map(b => (
              <span key={b} style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: '#fff', border: '1px solid #DDD8CF', color: '#9490A0' }}>{b}</span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ══════════════ STICKY BAR ══════════════ */
function StickyBar({ onSignup }) {
  const [visible, setVisible] = useState(false);
  const [gone, setGone]       = useState(false);
  useEffect(() => { const fn = () => { if (!gone) setVisible(window.scrollY > 600); }; window.addEventListener('scroll', fn); return () => window.removeEventListener('scroll', fn); }, [gone]);
  if (gone) return null;
  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 800, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 24px', background: '#fff', borderTop: '1px solid #E2DDD6', boxShadow: '0 -4px 20px rgba(0,0,0,.08)', transform: visible ? 'translateY(0)' : 'translateY(100%)', transition: 'transform .3s', flexWrap: 'wrap', fontFamily: "'DM Sans',sans-serif" }}>
      <p style={{ fontSize: 14, color: '#3A3A52', fontWeight: 500 }}><span style={{ color: B, fontWeight: 700 }}>14-day free trial</span> — no credit card. 30-day money-back guarantee.</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Btn v="ghost" sz="sm" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Learn more</Btn>
        <Btn v="primary" sz="sm" onClick={onSignup}>Start for free <ArrowRight size={13}/></Btn>
        <button onClick={() => setGone(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9490A0', padding: 4, display: 'flex', alignItems: 'center' }}><X size={15}/></button>
      </div>
    </div>
  );
}

/* ══════════════ ROOT ══════════════ */
export default function LandingPage() {
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const goSignup = () => navigate('/signup');

  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: '#1A1A2E', overflowX: 'hidden' }}>
      <FontStyle/>
      <Header onDrawer={() => setDrawer(true)}/>
      <Drawer open={drawer} onClose={() => setDrawer(false)}/>
      <main>
        <Hero onSignup={goSignup}/>
        <TrustBar/>
        <ProblemSolution/>
        <HowItWorks/>
        <Courses/>
        <Features/>
        <Outcomes/>
        <Pricing/>
        <Instructors/>
        <FAQ/>
        <FinalCTA onSignup={goSignup}/>
      </main>
      <Footer/>
      <StickyBar onSignup={goSignup}/>
    </div>
  );
}
