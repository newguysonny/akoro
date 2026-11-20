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

/* ══════════════ PRICING ══════════════ */
function Pricing() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [yearly, setYearly]   = useState(false);
  const [tab, setTab]          = useState('individual');

  const indiv = [{
    tier: 'Pro', monthlyPrice: 18000, yearlyPrice: 12960, unit: '/mo', featured: true,
    desc: t('landing.tier_pro_desc'),
    badge: t('landing.tier_pro_unit'),
    features: [[true,t('landing.f_agent')],[true,t('landing.f_classroom1')],[true,t('landing.f_students20')],[true,t('landing.f_subjects')],[true,t('landing.f_battles')],[true,t('landing.f_knowledge_map')],[true,t('landing.f_curriculum')],[true,t('landing.f_offline')],[true,t('landing.f_certificates')]],
    cta: t('landing.start_trial'), v: 'primary',
  }];

  const enterprise = [
    {
      tier: 'Starter', monthlyPrice: 85000, yearlyPrice: 61200, unit: '/mo', featured: false,
      desc: t('landing.tier_starter_desc'),
      badge: t('landing.tier_starter_unit'),
      features: [[true,t('landing.f_everything_pro')],[true,t('landing.f_classrooms3')],[true,t('landing.f_teacher_tools')],[true,t('landing.f_syllabus_upload')],[true,t('landing.f_leagues')],[true,t('landing.f_support')],[false,t('landing.f_sms')],[false,t('landing.f_api')]],
      cta: t('landing.get_started'), v: 'outline',
    },
    {
      tier: 'Enterprise Pro', monthlyPrice: null, yearlyPrice: null, unit: '', featured: true,
      desc: t('landing.tier_ent_desc'),
      badge: t('landing.tier_ent_unit'),
      features: [[true,t('landing.f_everything_starter')],[true,t('landing.f_sms')],[true,'Unlimited classrooms'],[true,'Multi-school / district management'],[true,t('landing.f_whitelabel')],[true,'Priority SLA & onboarding'],[true,t('landing.f_api_integrations')],[true,'NDPR / FERPA compliance suite']],
      cta: t('landing.contact_sales'), v: 'dark',
    },
  ];

  const plans = tab === 'individual' ? indiv : enterprise;

  return (
    <section id="pricing" className="ak-section-pad" style={{ padding: '96px 24px', background: '#FAF8F5', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <SL center>{t('landing.pricing_eyebrow')}</SL>
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
          <span style={{ color: !yearly ? '#1A1A2E' : '#9490A0' }}>{t('landing.monthly')}</span>
          <button onClick={() => setYearly(v => !v)} style={{ width: 46, height: 24, borderRadius: 99, background: yearly ? B : '#DDD8CF', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background .2s' }}>
            <div style={{ position: 'absolute', width: 16, height: 16, background: '#fff', borderRadius: '50%', top: 4, left: yearly ? 26 : 4, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }}/>
          </button>
          <span style={{ color: yearly ? '#1A1A2E' : '#9490A0' }}>{t('landing.yearly')}</span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: '#E8F8EE', color: '#2AA76E', opacity: yearly ? 1 : 0.4, transition: 'opacity .2s' }}>{t('landing.save_28')}</span>
        </div>

        {/* Individual — single centred card */}
        {tab === 'individual' && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ maxWidth: 420, width: '100%' }}>
              {indiv.map(plan => (
                <Reveal key={plan.tier}>
                  <div style={{ position: 'relative', borderRadius: 24, padding: '40px 36px', border: `1.5px solid ${B}`, background: '#fff', boxShadow: '0 4px 24px rgba(0,0,0,.06)' }}>
                    <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: B, color: '#fff', fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '4px 16px', borderRadius: 99, whiteSpace: 'nowrap' }}>{t('landing.most_popular')}</div>
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
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>{t('landing.enterprise_licensing')}</div>
                  <p style={{ fontSize: 12.5, color: '#6B6B80', lineHeight: 1.65 }}>{t('landing.enterprise_blurb')}</p>
                </div>
              </div>
            </Reveal>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20, maxWidth: 720, margin: '0 auto' }}>
              {enterprise.map(plan => (
                <Reveal key={plan.tier}>
                  <div style={{ position: 'relative', borderRadius: 24, padding: '32px 28px', border: plan.featured ? `1.5px solid ${B}` : '1px solid #EDE8E1', background: '#fff', boxShadow: plan.featured ? '0 4px 24px rgba(0,0,0,.06)' : '0 2px 14px rgba(0,0,0,.05)', display: 'flex', flexDirection: 'column', height: '100%' }}>
                    {plan.featured && <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: B, color: '#fff', fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '4px 14px', borderRadius: 99, whiteSpace: 'nowrap' }}>Full Platform</div>}
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
            <Shield size={14} style={{ display: 'inline', marginRight: 6, color: B }}/><strong style={{ color: '#1A1A2E' }}>{t('landing.money_back')}</strong> — if Akoro doesn't improve your scores, we'll refund every penny.{' '}
            <span style={{ color: B, cursor: 'pointer', textDecoration: 'underline' }}>{t('landing.financial_aid')}</span> for students in need.
          </div>
        </Reveal>

        <Reveal>
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <button onClick={() => navigate('/pricing')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, color: B }}>
              Running a school? See school website & AI plans →
            </button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default Pricing;
