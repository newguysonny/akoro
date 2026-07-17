/**
 * Landing page — nav/frame chrome (header, drawer, quick info, final CTA,
 * footer, sticky bar).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Brain, Zap, Swords, BarChart3, Mic, School, WifiOff, Trophy,
  Link2, Menu, X, ChevronDown, ChevronLeft, ChevronRight, Star, Check, ArrowRight, Play,
  Shield, Globe, BookOpen, DollarSign, MessageSquare, Cpu, Target,
  Repeat2, Map, Users, Building2, Sparkles, GraduationCap, Clock,
  TrendingUp, Award, Lock, AlertCircle, CheckCircle2, XCircle,
  Video, CalendarDays, UserCheck, MonitorPlay, ExternalLink, Radio,
  Layers, Settings, LayoutDashboard,
} from 'lucide-react';
import AkoroLogo from '../../components/common/AkoroLogo.jsx';
import { SiteNav, SFSHeader, SiteFooter } from '../../components/SiteChrome.jsx';
import SFSHero from '../../components/SFSHero.jsx';
import NewsCarousel from '../../components/NewsCarousel.jsx';
import TrustRatings from '../../components/TrustRatings.jsx';
import QuickActions from '../../components/QuickActions.jsx';

import { API } from '../../services/api.js';
import {
  FaLinkedin, FaYoutube, FaInstagram, FaFacebook, FaXTwitter,
} from 'react-icons/fa6';
import { INSTRUCTOR_URL, B, B2, G, GL, R, BG, FontStyle, useReveal, Reveal, SL, Btn } from './shared.jsx';

/* ── Header ── */
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
      <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <AkoroLogo size={34} radius={10}/>
        <span className="fs" style={{ fontSize: 20, color: '#1A1A2E' }}>Akoro</span>
      </a>
      <nav className="ak-nav-links" style={{ gap: 4, alignItems: 'center' }}>
        {navLinks.map(l => (
          <a key={l.label} href={l.id} onClick={e => scroll(e, l.id)} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 14, fontWeight: 500, color: '#6B6B80', transition: 'all .2s' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#1A1A2E'; e.currentTarget.style.background = '#F5F2EC'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#6B6B80'; e.currentTarget.style.background = 'transparent'; }}>
            {l.label}
          </a>
        ))}
      </nav>
      <div className="ak-header-ctas" style={{ alignItems: 'center', gap: 10 }}>
        <span className="ak-desktop-ctas" style={{ display: 'flex', gap: 10 }}>
          <Btn v="ghost" sz="sm" onClick={() => navigate('/signin')}>Log in</Btn>
          <Btn v="primary" sz="sm" onClick={() => navigate('/signup')}>Start free <ArrowRight size={13}/></Btn>
        </span>
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
            <AkoroLogo size={32} radius={9}/>
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


/* ══════════════ QUICK INFO ══════════════ */
function QuickInfo({ onSignup }) {
  const stats = [
    { icon: <Cpu size={20} color="#C4B5FD"/>, label: 'Active Agents',   val: '12,400+', sub: 'students worldwide' },
    { icon: <Brain size={20} color="#C4B5FD"/>, label: 'Avg Retention', val: '89%',     sub: 'vs 17% passive video' },
    { icon: <Swords size={20} color="#C4B5FD"/>, label: 'Agent Battles',val: '340K+',   sub: 'knowledge duels fought' },
    { icon: <School size={20} color="#C4B5FD"/>, label: 'Partner Schools',val: '280+',  sub: 'across Nigeria & Africa' },
  ];
  return (
    <section style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', background: `linear-gradient(180deg,${B2} 0%,#3A12A8 100%)`, overflow: 'hidden' }}>
      <div className="ak-hero-inner" style={{ position: 'relative', zIndex: 1, maxWidth: 880, width: '100%', padding: '140px 24px 96px' }}>
        
        
        <div className="fu5 ak-stats-grid">
          {stats.map(({ icon, label, val, sub }, i) => (
            <div key={i} className="glass" style={{ borderRadius: 18, padding: '18px 20px', textAlign: 'left', transition: 'transform .2s', cursor: 'default' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}>
              <div style={{ marginBottom: 10 }}>{icon}</div>
              <div className="fsyne" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)', marginBottom: 4 }}>{label}</div>
              <div className="fsyne" style={{ fontSize: 24, fontWeight: 800, color: '#fff', lineHeight: 1.1 }}>{val}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)', marginTop: 3 }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}



/* ══════════════ PROBLEM / SOLUTION ══════════════ */

/* ── Final CTA / Footer / Sticky bar ── */
function FinalCTA({ onSignup }) {
  const navigate = useNavigate();
  return (
    <section style={{ position: 'relative', padding: '96px 24px', textAlign: 'center', overflow: 'hidden', background: `linear-gradient(180deg,${B2} 0%,#3A12A8 100%)`, fontFamily: "'DM Sans',sans-serif" }}>
      <Reveal>
        <div style={{ position: 'relative', zIndex: 1, maxWidth: 640, margin: '0 auto' }}>
          <h2 className="fs" style={{ fontSize: 'clamp(32px,5vw,58px)', color: '#fff', letterSpacing: '-0.03em', lineHeight: 1.08, marginBottom: 14, fontWeight: 800 }}>
            Your agent is waiting.<br/>Start learning for real.
          </h2>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,.8)', marginBottom: 36, lineHeight: 1.65 }}>Free to start. No credit card. Cancel anytime.</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <Btn v="primary" sz="lg" onClick={onSignup} style={{ background: '#fff', color: B2, border: '1.5px solid #fff' }}>🎓 Learner Login <ArrowRight size={16}/></Btn>
            <Btn v="outline" sz="lg" onClick={() => { window.location.href = `${INSTRUCTOR_URL}/signin`; }} style={{ background: 'transparent', color: '#fff', border: '1.5px solid rgba(255,255,255,.4)' }}><School size={16}/> Instructor Login</Btn>
          </div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Shield size={11} color="#C4B5FD"/>30-day money-back</span>
            <span>·</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Lock size={11} color="#C4B5FD"/>NDPR & GDPR compliant</span>
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
    { title: 'Product',     links: [['How it works','#'],['Courses','#'],['Live Classes','#'],['Pricing','#'],['Agent Battles','#'],['Certifications','#']] },
    { title: 'For Schools', links: [['Enterprise Starter','#'],['Enterprise Pro','#'],['School Dashboard','#'],['Pilot Programme','#'],['NDPR Compliance','#'],['Case Studies','#']] },
    { title: 'Company',     links: [['About Us','/about'],['Blog','#'],['Careers','/careers'],['Press','#'],['Contact','/contact'],['Partners','#'],['Privacy Policy','/privacy'],['Terms of Service','/terms']] },
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
        <div className="ak-footer-grid" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 48, marginBottom: 48 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <AkoroLogo size={32} radius={9}/>
              <span className="fs" style={{ fontSize: 19, color: '#1A1A2E' }}>Akoro</span>
            </div>
            <p style={{ fontSize: 13.5, color: '#7A7880', lineHeight: 1.7, maxWidth: 240, marginBottom: 20 }}>AI Learning Agents — teach your agent, NaNa Esumai guides every session and teaches you back.</p>
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
                {links.map(([label, href]) => (
                  <li key={label}><a href={href} style={{ fontSize: 13.5, color: '#7A7880', transition: 'color .18s', textDecoration: 'none' }}
                    onMouseEnter={e => e.target.style.color = B}
                    onMouseLeave={e => e.target.style.color = '#7A7880'}>{label}</a></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div style={{ paddingTop: 24, borderTop: '1px solid #DDD8CF', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#9490A0' }}>© 2025 Akoro Technologies Ltd. All rights reserved.</span>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { label: 'Privacy Policy', href: '/privacy' },
              { label: 'Terms of Service', href: '/terms' },
              { label: 'Cookie Policy', href: '/privacy#cookies' },
              { label: 'Student Data Policy', href: '/privacy#student-data' },
            ].map(({ label, href }) => (
              <a key={label} href={href} style={{ fontSize: 12, color: '#9490A0', transition: 'color .18s', textDecoration: 'none' }}
                onMouseEnter={e => e.target.style.color = B}
                onMouseLeave={e => e.target.style.color = '#9490A0'}>{label}</a>
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



export { Header, Drawer, QuickInfo, FinalCTA, Footer, StickyBar };
