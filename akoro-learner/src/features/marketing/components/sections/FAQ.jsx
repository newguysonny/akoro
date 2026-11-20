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

/* ══════════════ FAQ ══════════════ */
function FAQ() {
  const { t } = useLang();
  const [open, setOpen] = useState(0);
  const faqs = [
    [t('landing.faq_q1'), t('landing.faq_a1')],
    [t('landing.faq_q2'), t('landing.faq_a2')],
    [t('landing.faq_q3'), t('landing.faq_a3')],
    [t('landing.faq_q4'), t('landing.faq_a4')],
    [t('landing.faq_q5'), t('landing.faq_a5')],
    ['What\'s the difference between Enterprise Starter and Enterprise Pro?', 'Starter gives you up to 3 classrooms and teacher tools. Enterprise Pro adds a Custom School Management System, unlimited classrooms, multi-school management, and white-labelling.'],
    [t('landing.faq_q6'), t('landing.faq_a6')],
    [t('landing.faq_q7'), t('landing.faq_a7')],
  ];
  return (
    <section id="faq" className="ak-section-pad" style={{ padding: '96px 24px', background: '#FAF8F5', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 52 }}>
          <SL center>FAQ</SL>
          <h2 className="fs" style={{ fontSize: 'clamp(28px,4vw,50px)', color: '#1A1A2E', letterSpacing: '-0.02em' }}>
            Questions we <em style={{ color: B, fontStyle: 'italic' }}>actually get</em> asked
          </h2>
        </div>
        <div className="ak-faq-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(480px,1fr))', gap: 12 }}>
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

export default FAQ;
