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

function ProblemSolution() {
  const { t } = useLang();
  const card = (style) => ({ borderRadius: 24, padding: '36px 32px', height: '100%', ...style });
  // `line` — NOT `t`. The map callback was named `t`, which shadows the
  // translator the moment this component starts using one.
  const row = (icon, text, good) => (
    <div key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 15, color: good ? '#2A2A3E' : '#6B6B80', marginBottom: 14 }}>
      {good ? <CheckCircle2 size={16} color={B} style={{ flexShrink: 0, marginTop: 2 }}/> : <XCircle size={16} color="#C9C5BE" style={{ flexShrink: 0, marginTop: 2 }}/>}
      {text}
    </div>
  );
  return (
    <section id="problem" className="ak-section-pad" style={{ padding: '96px 24px', background: '#fff', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ marginBottom: 48 }}>
          <SL>{t('landing.problem_eyebrow')}</SL>
          <h2 className="fs" style={{ fontSize: 'clamp(28px,4vw,48px)', color: '#1A1A2E', letterSpacing: '-0.02em', lineHeight: 1.15, maxWidth: 480 }}>{t('landing.problem_title')}</h2>
        </div>
        <div className="ak-two-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 20 }}>
          <Reveal>
            <div style={card({ background: '#FAF8F5', border: '1px solid #EDE8E1' })}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 99, background: '#F0ECE6', border: '1px solid #DDD8CF', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9490A0', marginBottom: 20 }}><AlertCircle size={10}/>{t('landing.old_way')}</div>
              <h3 className="fs" style={{ fontSize: 26, color: '#1A1A2E', lineHeight: 1.25, marginBottom: 24 }}>{t('landing.old_way_sub')}</h3>
              {['landing.old_1','landing.old_2','landing.old_3','landing.old_4','landing.old_5'].map(k => row(null, t(k), false))}
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div style={card({ background: `linear-gradient(140deg,${B}08,${B}03)`, border: `1px solid ${B}25` })}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 99, background: `${B}14`, border: `1px solid ${B}30`, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: B, marginBottom: 20 }}><Sparkles size={10}/>{t('landing.akoro_way')}</div>
              <h3 className="fs" style={{ fontSize: 26, color: '#1A1A2E', lineHeight: 1.25, marginBottom: 24 }}>{t('landing.akoro_way_sub')}</h3>
              {['landing.new_1','landing.new_2','landing.new_3','landing.new_4','landing.new_5'].map(k => row(null, t(k), true))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export default ProblemSolution;
