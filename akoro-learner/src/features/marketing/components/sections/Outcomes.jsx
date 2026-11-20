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

/* ══════════════ OUTCOMES ══════════════ */
function Outcomes() {
  const { t } = useLang();
  const metrics = [
    { val: '89%', label: t('landing.stat_retention') },
    { val: '3.4×', label: t('landing.stat_exam') },
    { val: '78%', label: t('landing.stat_completion') },
    { val: '₦2M+', label: t('landing.stat_salary') },
  ];
  const testimonials = [
    { stars: 5, quote: t('landing.quote_1'), emoji: '👦🏾', bg: '#D4EAD8', name: 'Chukwuemeka Obi', role: t('landing.role_1'), result: t('landing.result_1') },
    { stars: 5, quote: t('landing.quote_2'), emoji: '👩🏾‍🏫', bg: '#E4D4F0', name: 'Mrs. Adaeze Nwosu', role: t('landing.role_2'), result: t('landing.result_2') },
    { stars: 5, quote: t('landing.quote_3'), emoji: '👨🏾‍💼', bg: '#F0E4C8', name: 'Kofi Mensah', role: t('landing.role_3'), result: 'IELTS 6.0 → 7.5' },
  ];
  return (
    <section id="outcomes" className="ak-section-pad" style={{ padding: '96px 24px', background: '#fff', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <SL center>{t('landing.results_eyebrow')}</SL>
          <h2 className="fs" style={{ fontSize: 'clamp(28px,4vw,50px)', color: '#1A1A2E', letterSpacing: '-0.02em' }}>
            Numbers that matter, not <em style={{ color: B, fontStyle: 'italic' }}>vanity metrics</em>
          </h2>
        </div>
        <div className="ak-four-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16, marginBottom: 36 }}>
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

export default Outcomes;
