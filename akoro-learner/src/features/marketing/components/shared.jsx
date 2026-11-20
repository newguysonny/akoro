/**
 * Landing page — brand tokens, global font style, reveal-on-scroll, and the
 * shared section-label / button primitives.
 */
import { useState, useEffect, useRef } from 'react';
import { INSTRUCTOR_URL } from '../../../config/urls.js';

/* ── Instructor portal (separate deployment) ── */


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
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html{scroll-behavior:smooth}
    body{font-family:'DM Sans',sans-serif;background:#fff;color:#1A1A2E;overflow-x:hidden}
    .fs{font-family:'Poppins',sans-serif;font-weight:700;letter-spacing:-0.02em}
    .fs em{font-style:normal!important}
    .fsyne{font-family:'Poppins',sans-serif}
    @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    @keyframes lspin{to{transform:rotate(360deg)}}
    @keyframes livepulse{0%,100%{opacity:1}50%{opacity:.35}}
    .fu1{animation:fadeUp .6s ease .08s both}
    .fu2{animation:fadeUp .6s ease .2s both}
    .fu3{animation:fadeUp .6s ease .32s both}
    .fu4{animation:fadeUp .6s ease .44s both}
    .fu5{animation:fadeUp .6s ease .56s both}
    .ldot{animation:livepulse 1.4s ease infinite}
    .spin{animation:lspin .8s linear infinite}
    /* Frosted-glass surface — used on the solid colour hero/CTA blocks */
    .glass{background:rgba(255,255,255,.10);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.20)}
    .glass-light{background:rgba(255,255,255,.7);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.65)}
    ::-webkit-scrollbar{width:4px}
    ::-webkit-scrollbar-thumb{background:#d1c9ff;border-radius:2px}
    a{text-decoration:none;color:inherit}
    /* ── Responsive helpers ── */
    .ak-nav-links{display:flex}
    .ak-header-ctas{display:flex}
    .ak-menu-btn{display:flex}
    .ak-hero-btns{display:flex;flex-wrap:wrap}
    .ak-stats-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;max-width:560px;margin:0 auto}
    @media(max-width:768px){
      .ak-nav-links{display:none!important}
      .ak-header-ctas .ak-desktop-ctas{display:none!important}
      .ak-section-pad{padding:64px 18px!important}
      .ak-two-col{grid-template-columns:1fr!important}
      .ak-four-col{grid-template-columns:1fr 1fr!important}
      .ak-three-col{grid-template-columns:1fr!important}
      .ak-how-card-grid{grid-template-columns:1fr 1fr!important}
      .ak-pricing-grid{grid-template-columns:1fr!important}
      .ak-footer-grid{grid-template-columns:1fr 1fr!important}
      .ak-faq-grid{grid-template-columns:1fr!important}
      .ak-hero-inner{padding:100px 18px 64px!important}
    }
    @media(max-width:480px){
      .ak-four-col{grid-template-columns:1fr!important}
      .ak-how-card-grid{grid-template-columns:1fr!important}
      .ak-footer-grid{grid-template-columns:1fr!important}
      .ak-stats-grid{grid-template-columns:repeat(2,1fr)!important;max-width:100%!important}
      .ak-hero-btns{flex-direction:column;align-items:stretch}
      .ak-hero-btns button{width:100%;justify-content:center}
    }
    /* ── Agent spotlight ── */
    .ak-agent-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
    .ak-agent-arrows{display:none}
    @media(max-width:900px){
      .ak-agent-grid{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:16px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
      .ak-agent-grid::-webkit-scrollbar{display:none}
      .ak-agent-card{flex:0 0 88%;scroll-snap-align:center}
      .ak-agent-arrows{display:flex}
    }
    @keyframes ak-orbit{to{transform:rotate(360deg)}}
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
    <span style={{ fontFamily: "'Poppins',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: B }}>{children}</span>
  </div>
);

/* ── Button ── */
const Btn = ({ children, v = 'primary', sz = 'md', onClick, style: s = {} }) => {
  const base = { display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: "'DM Sans',sans-serif", fontWeight: 600, borderRadius: 99, cursor: 'pointer', border: 'none', transition: 'all .2s', whiteSpace: 'nowrap' };
  const sizes = { sm: { padding: '9px 20px', fontSize: 13 }, md: { padding: '11px 22px', fontSize: 14 }, lg: { padding: '14px 30px', fontSize: 15 } };
  const variants = {
    primary: { background: B, color: '#fff', border: `1.5px solid ${B}` },
    outline:  { background: '#fff', color: '#3A3A52', border: `1.5px solid #D4CEC4` },
    ghost:    { background: 'transparent', color: '#7A7880', border: '1.5px solid transparent' },
    dark:     { background: '#1A1A2E', color: '#fff', border: '1.5px solid #1A1A2E' },
    green:    { background: G, color: '#fff', border: `1.5px solid ${G}` },
  };
  return <button onClick={onClick} style={{ ...base, ...sizes[sz], ...variants[v], ...s }}>{children}</button>;
};

/* ══════════════ HEADER ══════════════ */

export { INSTRUCTOR_URL, B, B2, G, GL, R, BG, FontStyle, useReveal, Reveal, SL, Btn };
