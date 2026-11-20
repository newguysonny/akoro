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

/* ══════════════ INSTRUCTORS (lazy-loaded from backend only) ══════════════ */
function Instructors() {
  const { t } = useLang();
  const [instructors, setInstructors] = useState([]);
  const [loading, setLoading]         = useState(false);
  const [fetched, setFetched]         = useState(false);
  const sectionRef = useRef(null);

  useEffect(() => {
    if (fetched) return;
    const el = sectionRef.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      obs.disconnect(); setFetched(true); setLoading(true);
      fetch(`${API}/api/instructors/featured`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
        .then(data => setInstructors(Array.isArray(data) ? data : data?.instructors || []))
        .finally(() => setLoading(false));
    }, { threshold: 0.05 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [fetched]);

  return (
    <section id="instructors" ref={sectionRef} className="ak-section-pad" style={{ padding: '96px 24px', background: '#fff', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ marginBottom: 48 }}>
          <SL>{t('landing.instructors_eyebrow')}</SL>
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
        {!loading && instructors.length === 0 && fetched && (
          <div style={{ textAlign: 'center', padding: '64px 24px', color: '#9490A0' }}>
            <GraduationCap size={40} color="#DDD8CF" style={{ marginBottom: 16 }}/>
            <p style={{ fontSize: 16, fontWeight: 600, color: '#6B6B80', marginBottom: 6 }}>{t('landing.no_instructors')}</p>
            <p style={{ fontSize: 14 }}>{t('landing.no_instructors_sub')}</p>
          </div>
        )}
        <div className="ak-four-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 18 }}>
          {instructors.map(({ emoji, bg, name, subject, score, rev, bio }, i) => (
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
            <p style={{ fontSize: 15, color: '#6B6B80', marginBottom: 18 }}>{t('landing.educator_cta')}</p>
            <Btn v="outline" onClick={() => { window.location.href = `${INSTRUCTOR_URL}/signup`; }}>{t('landing.apply_instructor')} <ArrowRight size={14}/></Btn>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default Instructors;
