/**
 * Landing page — content sections.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLang } from '../../../../contexts/LanguageContext.jsx';
import { flushSync } from 'react-dom';
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
import AkoroLogo from '../../../../components/common/AkoroLogo.jsx';
import ProTip from '../../../../components/ProTip.jsx';
import { SiteNav, SFSHeader, SiteFooter } from '../../../../components/SiteChrome.jsx';
import SFSHero from '../SFSHero.jsx';
import NewsCarousel from '../NewsCarousel.jsx';
import TrustRatings from '../TrustRatings.jsx';
import QuickActions from '../QuickActions.jsx';

import { API } from '../../../../services/api.js';
import {
  FaLinkedin, FaYoutube, FaInstagram, FaFacebook, FaXTwitter,
} from 'react-icons/fa6';
import { INSTRUCTOR_URL, B, B2, G, GL, R, BG, FontStyle, useReveal, Reveal, SL, Btn } from '../shared.jsx';

/* ══════════════ HOW IT WORKS ══════════════ */
const HIW_VT = 'ak-hiw-morph';
function HowItWorks() {
  const { t } = useLang();
  const steps = [
    { num: '01', glyph: '◎', icon: <Target size={26} color={B}/>, title: t('landing.hiw_t1'), desc: t('landing.hiw_d1') },
    { num: '02', glyph: '✦', icon: <Brain size={26} color={B}/>, title: t('landing.hiw_t2'), desc: t('landing.hiw_d2') },
    { num: '03', glyph: '❖', icon: <Repeat2 size={26} color={B}/>, title: t('landing.hiw_t3'), desc: t('landing.hiw_d3') },
    { num: '04', glyph: '▲', icon: <Trophy size={26} color={B}/>, title: t('landing.hiw_t4'), desc: t('landing.hiw_d4') },
  ];
  const [open, setOpen] = useState(null);
  const [slow, setSlow] = useState(false);
  const tiles = useRef({});
  const busy  = useRef(false);

  // Shared-element morph via the View Transition API (adapted from the
  // baseline-2026 "Morph gallery"). Unsupported browsers get a plain cut.
  const withVT = (fn) => (typeof document !== 'undefined' && document.startViewTransition
    ? document.startViewTransition(fn)
    : (fn(), { finished: Promise.resolve() }));

  const openStep = (i) => {
    if (busy.current || open !== null) return;
    busy.current = true;
    const el = tiles.current[i];
    if (el) el.style.viewTransitionName = HIW_VT;        // old snapshot = tile
    const t = withVT(() => {
      if (el) el.style.viewTransitionName = '';          // avoid a duplicate name in the new snapshot
      flushSync(() => setOpen(i));                        // new snapshot = detail panel
    });
    Promise.resolve(t.finished).catch(() => {}).finally(() => { busy.current = false; });
  };

  const closeStep = () => {
    if (busy.current || open === null) return;
    busy.current = true;
    const i = open;
    const t = withVT(() => {
      flushSync(() => setOpen(null));                     // detail (old) → tiles
      const el = tiles.current[i];
      if (el) el.style.viewTransitionName = HIW_VT;       // new snapshot = tile
    });
    Promise.resolve(t.finished).catch(() => {}).finally(() => {
      const el = tiles.current[i];
      if (el) el.style.viewTransitionName = '';
      busy.current = false;
    });
  };

  const toggleSlow = (e) => {
    setSlow(e.target.checked);
    if (typeof document !== 'undefined') document.documentElement.style.setProperty('--ak-vt', e.target.checked ? '2.4s' : '.45s');
  };

  const cur = open !== null ? steps[open] : null;

  return (
    <section id="how-it-works" className="ak-section-pad" style={{ padding: '96px 24px', background: '#FAF8F5', fontFamily: "'DM Sans',sans-serif", position: 'relative', overflow: 'hidden' }}>
      <style>{`
        ::view-transition-group(${HIW_VT}) { animation-duration: var(--ak-vt, .45s); }
        @media (prefers-reduced-motion: reduce) { ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation-duration: .001s !important; } }
        .ak-hiw-tile { text-align: left; cursor: pointer; background: #fff; border: 1px solid #EDE8E1; border-radius: 18px; padding: 22px 20px; display: flex; flex-direction: column; gap: 12px; font-family: inherit; transition: border-color .2s, box-shadow .2s, transform .2s; }
        .ak-hiw-tile:hover { border-color: ${B}55; box-shadow: 0 12px 30px ${B}14; transform: translateY(-3px); }
      `}</style>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <SL center>{t('landing.hiw_eyebrow')}</SL>
          <h2 className="fs" style={{ fontSize: 'clamp(28px,4vw,50px)', color: '#1A1A2E', letterSpacing: '-0.02em' }}>
            From first session to <em style={{ color: B, fontStyle: 'italic' }}>top of class</em>
          </h2>
          <p style={{ fontSize: 17, color: '#6B6B80', maxWidth: 520, margin: '12px auto 0', lineHeight: 1.7 }}>
            Four simple steps that turn passive studying into active mastery. <span style={{ color: '#9490A0' }}>{t('landing.hiw_hint')}</span>
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 14 }}>
          {steps.map(({ num, glyph, icon, title }, i) => (
            <button key={num} ref={(el) => { tiles.current[i] = el; }} className="ak-hiw-tile"
              onClick={() => openStep(i)} aria-expanded={open === i}
              style={{ visibility: open === i ? 'hidden' : 'visible' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ width: 46, height: 46, borderRadius: 13, background: `${B}0D`, border: `1px solid ${B}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
                <span aria-hidden="true" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 30, color: `${B}66`, lineHeight: 1 }}>{glyph}</span>
              </div>
              <div className="fsyne" style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: B }}>STEP {num}</div>
              <h3 style={{ fontSize: 17, fontWeight: 800, color: '#1A1A2E', lineHeight: 1.3 }}>{title}</h3>
              <span style={{ marginTop: 'auto', fontSize: 13, fontWeight: 700, color: B }}>{t('landing.learn_more')}</span>
            </button>
          ))}
        </div>

        {cur && (
          <div style={{ viewTransitionName: HIW_VT, marginTop: 16, background: '#fff', border: `1.5px solid ${B}`, borderRadius: 20, padding: '30px 30px 26px', boxShadow: `0 18px 44px ${B}18` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              <span style={{ width: 56, height: 56, borderRadius: 15, background: `${B}0D`, border: `1px solid ${B}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{cur.icon}</span>
              <div>
                <div className="fsyne" style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: B }}>STEP {cur.num}</div>
                <h3 style={{ fontSize: 'clamp(22px,3vw,28px)', fontWeight: 800, color: '#1A1A2E', lineHeight: 1.2 }}>{cur.title}</h3>
              </div>
            </div>
            <p style={{ fontSize: 16, color: '#4A4658', lineHeight: 1.75, maxWidth: 680 }}>{cur.desc}</p>
            <button onClick={closeStep} style={{ marginTop: 18, background: `${B}0D`, border: `1px solid ${B}22`, color: B, fontWeight: 700, fontSize: 13.5, borderRadius: 100, padding: '9px 18px', cursor: 'pointer', fontFamily: 'inherit' }}>{t('landing.collapse')}</button>
          </div>
        )}

        <Reveal>
          <ProTip />
        </Reveal>
      </div>
    </section>
  );
}

export default HowItWorks;
