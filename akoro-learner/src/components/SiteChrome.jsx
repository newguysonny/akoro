/**
 * SiteChrome.jsx — Shared marketing navbar + footer
 *
 * Reusable across the public pages (landing, about, contact, careers,
 * privacy, terms) so they all share one consistent header and footer.
 *
 * Exports: SiteNav, SFSHeader, SiteFooter, Btn, SITE_B
 */
import { useState, useEffect } from 'react';
import LanguageMenu from './LanguageMenu.jsx';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { SOCIALS, ENTITY } from '../seo/site.js';
import { Menu, X, ArrowRight, BookOpen, Zap, Map, TrendingUp, DollarSign, Users, MessageSquare, Download } from 'lucide-react';
import { FaLinkedin, FaYoutube, FaInstagram, FaFacebook, FaXTwitter } from 'react-icons/fa6';
import AkoroLogo from './common/AkoroLogo.jsx';
import InstallInstructionsSheet from './common/InstallInstructionsSheet.jsx';
import { usePwaInstall } from '../hooks/usePwaInstall.js';
import { TARGET, APP_URL } from '../config/target.js';

/* ── Brand tokens (match landing page) ── */
const B  = '#6C3BFF';
const B2 = '#4C1DCC';
const G  = '#10B981';
export const SITE_B = B;

/* ── Shared button ── */
export const Btn = ({ children, v = 'primary', sz = 'md', onClick, style: s = {} }) => {
  const base = { display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: "'DM Sans',sans-serif", fontWeight: 600, borderRadius: 99, cursor: 'pointer', border: 'none', transition: 'all .2s', whiteSpace: 'nowrap' };
  const sizes = { sm: { padding: '9px 20px', fontSize: 13 }, md: { padding: '11px 22px', fontSize: 14 }, lg: { padding: '14px 30px', fontSize: 15 } };
  const variants = {
    primary: { background: `linear-gradient(135deg,${B},${B2})`, color: '#fff', boxShadow: `0 4px 18px ${B}40` },
    outline: { background: '#fff', color: '#3A3A52', border: `1.5px solid #D4CEC4` },
    ghost:   { background: 'transparent', color: '#7A7880', border: '1.5px solid transparent' },
  };
  return <button onClick={onClick} style={{ ...base, ...sizes[sz], ...variants[v], ...s }}>{children}</button>;
};

/* ── Styles injected by the chrome (fonts + responsive helpers) ── */
const ChromeStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Syne:wght@400;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&display=swap');
    .sc-fs{font-family:'Instrument Serif',Georgia,serif}
    .sc-fsyne{font-family:'Syne',sans-serif}
    .sc-nav-links{display:flex}
    .sc-desktop-ctas{display:flex}
    .sc-footer-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:48px}
    @media(max-width:768px){
      .sc-nav-links{display:none!important}
      .sc-desktop-ctas{display:none!important}
      .sc-footer-grid{grid-template-columns:1fr 1fr!important}
    }
    @media(max-width:480px){
      .sc-footer-grid{grid-template-columns:1fr!important}
    }
  `}</style>
);

/* ── Mobile drawer ── */
function Drawer({ open, onClose, onNavLink }) {
  const navigate = useNavigate();
  const nav = [
    { icon: BookOpen,      label: 'Features',     id: '#features' },
    { icon: Map,           label: 'How It Works', id: '#how-it-works' },
    { icon: TrendingUp,    label: 'Why Akoro',    to: '/compare' },
    { icon: DollarSign,    label: 'Pricing',      to: '/pricing' },
    { icon: Users,         label: 'Instructors',  id: '#instructors' },
    { icon: MessageSquare, label: 'FAQ',          id: '#faq' },
  ];
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 960, background: 'rgba(0,0,0,.28)', backdropFilter: 'blur(4px)', opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity .3s' }}/>
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 961, width: 300, background: '#fff', boxShadow: '-8px 0 40px rgba(0,0,0,.12)', display: 'flex', flexDirection: 'column', padding: 24, overflowY: 'auto', transform: open ? 'translateX(0)' : 'translateX(100%)', transition: 'transform .36s cubic-bezier(.4,0,.2,1)', fontFamily: "'DM Sans',sans-serif" }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => { onClose(); navigate('/'); }}>
            <AkoroLogo size={32} radius={9}/>
            <span className="sc-fs" style={{ fontSize: 19, color: '#1A1A2E' }}>Akoro</span>
          </div>
          <button onClick={onClose} style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: '#F5F3EE', border: 'none', cursor: 'pointer', color: '#6B6B80' }}><X size={16}/></button>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          {nav.map(({ icon: Icon, label, id, to }) => (
            <button key={label} onClick={() => { onClose(); to ? navigate(to) : onNavLink(id); }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, fontWeight: 500, color: '#6B6B80', textAlign: 'left', transition: 'all .18s', fontFamily: 'inherit' }}
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

/* ── Navbar ── */
export function SiteNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 30);
    fn();
    window.addEventListener('scroll', fn);
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const goSection = (hash) => {
    if (location.pathname === '/') {
      document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate('/');
      setTimeout(() => document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' }), 350);
    }
  };

  const navLinks = [
    { label: 'Features',     id: '#features' },
    { label: 'How it Works', id: '#how-it-works' },
    { label: 'Why Akoro',    to: '/compare' },
    { label: 'Pricing',      to: '/pricing' },
    { label: 'FAQ',          id: '#faq' },
  ];

  return (
    <>
      <ChromeStyles/>
      <header style={{ position: 'sticky', top: 0, zIndex: 900, height: 68, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 clamp(18px,5vw,24px)', background: scrolled ? 'rgba(255,255,255,.97)' : 'rgba(255,255,255,.9)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderBottom: '1px solid #EDE8E1', transition: 'all .3s', fontFamily: "'DM Sans',sans-serif" }}>
        <div onClick={() => navigate('/')} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <AkoroLogo size={34} radius={10}/>
          <span className="sc-fs" style={{ fontSize: 20, color: '#1A1A2E' }}>Akoro</span>
        </div>
        <nav className="sc-nav-links" style={{ gap: 4, alignItems: 'center' }}>
          {navLinks.map(l => (
            <button key={l.label} onClick={() => l.to ? navigate(l.to) : goSection(l.id)} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 14, fontWeight: 500, color: '#6B6B80', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", transition: 'all .2s' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#1A1A2E'; e.currentTarget.style.background = '#F5F2EC'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#6B6B80'; e.currentTarget.style.background = 'transparent'; }}>
              {l.label}
            </button>
          ))}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="sc-desktop-ctas" style={{ gap: 10 }}>
            <Btn v="ghost" sz="sm" onClick={() => navigate('/signin')}>Log in</Btn>
            <Btn v="primary" sz="sm" onClick={() => navigate('/signup')}>Start free <ArrowRight size={13}/></Btn>
          </span>
          <button onClick={() => setDrawer(true)} style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, border: '1.5px solid #E2DDD6', background: 'transparent', cursor: 'pointer', color: '#6B6B80', transition: 'border-color .2s' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = B}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#E2DDD6'}>
            <Menu size={18}/>
          </button>
        </div>
      </header>
      <Drawer open={drawer} onClose={() => setDrawer(false)} onNavLink={goSection}/>
    </>
  );
}

/* ── Second Header and Nav Type ──────────────────────────────
 * SFSHeader: utility bar + main nav + logo panel that overlaps
 * down into a page-provided hero. Fixed to the top of the
 * viewport (like SiteNav), with the same scroll-triggered
 * background treatment, and wired to the same Drawer component
 * SiteNav uses.
 *
 * NOTE: because this is now `position: fixed`, pages using
 * SFSHeader need top padding equal to its total height
 * (utility bar + main nav) so page content doesn't render
 * underneath it — roughly 116px on mobile (40 + 76), 128px
 * on desktop (40 + 88).
 * ────────────────────────────────────────────────────────────── */
export function SFSHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const { hidden: installHidden, canPrompt, platform, promptInstall } = usePwaInstall();
  const [sheetOpen, setSheetOpen] = useState(false);

  // The landing is a plain website (no manifest, no service worker): the app is installed from the app's own host.
  const toApp = TARGET === 'landing';
  const onInstallClick = async () => {
    if (toApp) { window.location.assign(`${APP_URL}/`); return; }
    if (canPrompt) { await promptInstall(); return; }   // Android/desktop: native dialog
    setSheetOpen(true);                                 // no native prompt on this browser — its exact steps
  };

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 30);
    fn();
    window.addEventListener('scroll', fn);
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const goSection = (hash) => {
    if (location.pathname === '/') {
      document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate('/');
      setTimeout(() => document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' }), 350);
    }
  };

  return (
    <div className="font-sans text-[#333]" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 900 }}>
      {/* ---------- UTILITY BAR (unchanged) ---------- */}
      <div className="flex items-center h-10 bg-[#2D2D2D] px-4">
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-xs text-gray-300 font-medium">
            Translate
          </span>
          <LanguageMenu/>
        </div>
        <div className="flex-1" />
        <button className="h-10 px-5 text-xs font-bold tracking-wide text-white bg-[#F5A623]">
          Inquire
        </button>
        {!installHidden && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={onInstallClick}
              className="h-10 px-5 text-xs font-bold tracking-wide text-white bg-[#0D9488] flex items-center gap-1.5"
            >
              <Download size={14} /> Install app
            </button>
          </div>
        )}
      </div>

      {/* Manual install steps for prompt-less browsers — the SAME sheet the
          in-app InstallBanner uses (exact steps for this browser/platform). */}
      {!installHidden && !toApp && (
        <InstallInstructionsSheet open={sheetOpen} onClose={() => setSheetOpen(false)} platform={platform} />
      )}

      {/* ---------- HEADER (nav + logo) ---------- */}
      <div className="relative">
        <nav
          className="flex items-center justify-end h-[76px] sm:h-[88px] gap-[10px] pr-4 sm:pr-6"
          style={{
            paddingLeft: "calc(38% + 6px)",
            background: scrolled ? 'rgba(255,255,255,.97)' : '#fff',
            backdropFilter: scrolled ? 'blur(14px)' : 'none',
            boxShadow: scrolled ? '0 2px 14px rgba(0,0,0,.06)' : 'none',
            transition: 'all .3s',
          }}
        >
          {/* Search icon – stroke now uses B */}
          <button aria-label="Search" className="p-1">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth={2.2}
              strokeLinecap="round"
              className="w-[22px] h-[22px]"
              style={{ stroke: B }}   // <-- changed to B
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>

          {/* Apply button – uses the same gradient as primary buttons */}
          <button
            onClick={() => navigate('/apply')}
            style={{
              background: `linear-gradient(135deg, ${B}, ${B2})`,
              color: '#fff',
              borderRadius: 9999,
              padding: '11px 24px',
              fontSize: '13px',
              fontWeight: 'bold',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              border: 'none',
              cursor: 'pointer',
              boxShadow: `0 4px 18px ${B}40`,
              whiteSpace: 'nowrap',
            }}
          >
            Apply Now
          </button>

          {/* Hamburger menu – spans now use B as background */}
          <button
            aria-label="Menu"
            onClick={() => setDrawer(true)}
            className="flex flex-col gap-[5px] p-1.5"
          >
            <span className="block w-[26px] h-[3px] rounded" style={{ background: B }} />
            <span className="block w-[26px] h-[3px] rounded" style={{ background: B }} />
            <span className="block w-[26px] h-[3px] rounded" style={{ background: B }} />
          </button>
        </nav>

        {/* Logo panel (unchanged) */}
        <div
          className="absolute top-0 left-0 z-20 flex flex-col items-center justify-center bg-white px-1.5 py-2.5"
          style={{
            width: "calc(34% + 6px)",
            height: "clamp(130px, 32vw, 180px)",
            borderRadius: "0 0 32px 0",
            boxShadow: "2px 2px 10px rgba(0,0,0,0.06)",
          }}
        >
          <AkoroLogo size={34} radius={10}/>
          <div className="text-center leading-[1.25]">
            <div className="text-[9px] font-bold text-[#2D2D2D] tracking-wide">
              AI POWERED
            </div>
            <div className="text-[11px] font-extrabold text-[#2D2D2D] tracking-wide">
              ADAPTIVE LEARNING
            </div>
            <div className="text-[9px] font-bold text-[#2D2D2D] tracking-wide">
              PLATFORM
            </div>
          </div>
        </div>
      </div>

      <Drawer open={drawer} onClose={() => setDrawer(false)} onNavLink={goSection}/>
    </div>
  );
}

/* ── Footer ── */
export function SiteFooter() {
  const navigate = useNavigate();
  const go = (href) => { if (href.startsWith('/')) navigate(href); };
  const cols = [
    { title: 'Product',     links: [['What is an AI protege?','/ai-protege'],['How Akoro works','/how-it-works'],['Akoro for students','/for-students'],['Akoro for teachers','/for-teachers'],['Exam preparation','/exam-prep'],['Pricing','/pricing']] },
    { title: 'For Schools', links: [['Akoro for schools','/for-schools'],['Pricing','/pricing'],['Why Akoro','/compare'],['Pilot programme','/for-schools'],['Talk to sales','/contact'],['Become a partner','/partners']] },
    { title: 'Company',     links: [['About Us','/about'],['Blog','/blog'],['Careers','/careers'],['Press','/contact'],['Contact','/contact'],['Partners','/partners'],['Privacy Policy','/privacy'],['Terms of Service','/terms']] },
  ];
  const socials = [
    { icon: <FaXTwitter size={14}/>,  label: 'X' },
    { icon: <FaLinkedin size={14}/>,  label: 'LinkedIn' },
    { icon: <FaYoutube size={14}/>,   label: 'YouTube' },
    { icon: <FaInstagram size={14}/>, label: 'Instagram' },
    { icon: <FaFacebook size={14}/>,  label: 'Facebook' },
  ].map((x) => ({ ...x, href: SOCIALS.find((c) => c.label === x.label)?.href }));
  const legal = [
    { label: 'Privacy Policy', href: '/privacy' },
    { label: 'Terms of Service', href: '/terms' },
    { label: 'Cookie Policy', href: '/privacy#cookies' },
    { label: 'Student Data Policy', href: '/privacy#student-data' },
  ];
  return (
    <footer style={{ background: '#F5F2EC', borderTop: '1px solid #E2DDD6', padding: '56px 24px 32px', fontFamily: "'DM Sans',sans-serif" }}>
      <ChromeStyles/>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div className="sc-footer-grid" style={{ marginBottom: 48 }}>
          <div>
            <div onClick={() => navigate('/')} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, cursor: 'pointer' }}>
              <AkoroLogo size={32} radius={9}/>
              <span className="sc-fs" style={{ fontSize: 19, color: '#1A1A2E' }}>Akoro</span>
            </div>
            <p style={{ fontSize: 13.5, color: '#7A7880', lineHeight: 1.7, maxWidth: 240, marginBottom: 20 }}>{ENTITY} Teach your AI protege, and learn by teaching.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {socials.map(({ icon, label, href }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer me" aria-label={`Akoro on ${label}`} style={{ textDecoration: 'none', width: 34, height: 34, borderRadius: 8, background: '#fff', border: '1px solid #DDD8CF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#7A7880', transition: 'all .18s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = B; e.currentTarget.style.color = B; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#DDD8CF'; e.currentTarget.style.color = '#7A7880'; }}>
                  {icon}
                </a>
              ))}
            </div>
          </div>
          {cols.map(({ title, links }) => (
            <div key={title}>
              <h4 className="sc-fsyne" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#1A1A2E', marginBottom: 16 }}>{title}</h4>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, margin: 0, padding: 0 }}>
                {links.map(([label, href]) => (
                  <li key={label}>
                    {href.startsWith('/') ? (
                      <Link to={href} style={{ fontSize: 13.5, color: '#7A7880', transition: 'color .18s', textDecoration: 'none' }}
                        onMouseEnter={e => e.target.style.color = B}
                        onMouseLeave={e => e.target.style.color = '#7A7880'}>{label}</Link>
                    ) : (
                      <a href={href} style={{ fontSize: 13.5, color: '#7A7880', transition: 'color .18s', textDecoration: 'none' }}
                        onMouseEnter={e => e.target.style.color = B}
                        onMouseLeave={e => e.target.style.color = '#7A7880'}>{label}</a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div style={{ paddingTop: 24, borderTop: '1px solid #DDD8CF', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#9490A0' }}>© 2025 Akoro Technologies Ltd. All rights reserved.</span>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {legal.map(({ label, href }) => (
              href.startsWith('/') ? (
                <Link key={label} to={href} style={{ fontSize: 12, color: '#9490A0', transition: 'color .18s', textDecoration: 'none' }}
                  onMouseEnter={e => e.target.style.color = B}
                  onMouseLeave={e => e.target.style.color = '#9490A0'}>{label}</Link>
              ) : (
                <a key={label} href={href} style={{ fontSize: 12, color: '#9490A0', transition: 'color .18s', textDecoration: 'none' }}
                  onMouseEnter={e => e.target.style.color = B}
                  onMouseLeave={e => e.target.style.color = '#9490A0'}>{label}</a>
              )
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
