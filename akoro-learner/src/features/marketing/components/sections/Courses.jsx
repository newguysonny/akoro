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

/* ══════════════ COURSES (lazy-loaded from backend only) ══════════════ */
function Courses() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [mainTab, setMainTab] = useState('recorded');
  const [subTab, setSubTab]   = useState('all');
  const [openSyl, setOpenSyl] = useState(null);
  const [courses, setCourses]  = useState([]);
  const [live, setLive]        = useState([]);
  const [loading, setLoading]  = useState(false);
  const [fetched, setFetched]  = useState(false);
  const sectionRef = useRef(null);

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
        fetch(`${API}/api/courses/published`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API}/api/live-sessions`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]).then(([c, l]) => {
        setCourses(Array.isArray(c) ? c : c?.courses || []);
        setLive(Array.isArray(l) ? l : l?.sessions || []);
      }).finally(() => setLoading(false));
    }, { threshold: 0.05 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [fetched]);

  const displayCourses = courses.filter(c => subTab === 'all' || c.cat === subTab);
  const displayLive    = live.filter(s => mainTab === 'live' ? s.status !== 'recorded' : mainTab === 'recorded' ? s.status === 'recorded' : true);

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
    <section id="courses" ref={sectionRef} className="ak-section-pad" style={{ padding: '96px 24px', background: '#fff', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ marginBottom: 36 }}>
          <SL>{t('landing.courses_eyebrow')}</SL>
          <h2 className="fs" style={{ fontSize: 'clamp(28px,4vw,50px)', color: '#1A1A2E', letterSpacing: '-0.02em', marginBottom: 10 }}>
            Subjects your agent <em style={{ color: B, fontStyle: 'italic' }}>masters</em> with you
          </h2>
          <p style={{ fontSize: 17, color: '#6B6B80', maxWidth: 500, lineHeight: 1.65 }}>{t('landing.courses_blurb')}</p>
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
                  {t === 'all' ? t('landing.all_subjects') : t === 'stem' ? 'STEM' : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            {!loading && displayCourses.length === 0 && (
              <div style={{ textAlign: 'center', padding: '64px 24px', color: '#9490A0' }}>
                <BookOpen size={40} color="#DDD8CF" style={{ marginBottom: 16 }}/>
                <p style={{ fontSize: 16, fontWeight: 600, color: '#6B6B80', marginBottom: 6 }}>{t('landing.no_courses')}</p>
                <p style={{ fontSize: 14 }}>{t('landing.no_courses_sub')}</p>
              </div>
            )}
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
                        <button onClick={() => (c.slug || c.id) && navigate(`/course/${c.slug || c.id}`)} style={{ padding: '6px 14px', borderRadius: 99, border: `1.5px solid #DDD8CF`, background: 'transparent', fontSize: 12, fontWeight: 600, color: '#6B6B80', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .2s' }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = B; e.currentTarget.style.color = B; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = '#DDD8CF'; e.currentTarget.style.color = '#6B6B80'; }}>
                          View course
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
            {!loading && displayLive.length === 0 && (
              <div style={{ textAlign: 'center', padding: '64px 24px', color: '#9490A0' }}>
                <Radio size={40} color="#DDD8CF" style={{ marginBottom: 16 }}/>
                <p style={{ fontSize: 16, fontWeight: 600, color: '#6B6B80', marginBottom: 6 }}>{t('landing.no_live')}</p>
                <p style={{ fontSize: 14 }}>{t('landing.no_live_sub')}</p>
              </div>
            )}
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
                      {s.status === 'live'     && <Btn v="green" sz="sm"><Radio size={13}/>{t('landing.join_now')}</Btn>}
                      {s.status === 'upcoming' && <Btn v="primary" sz="sm"><CalendarDays size={13}/>RSVP</Btn>}
                      {s.status === 'recorded' && <Btn v="outline" sz="sm"><MonitorPlay size={13}/>{t('landing.watch_replay')}</Btn>}
                      <span style={{ fontSize: 11, color: '#9490A0', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><ExternalLink size={10}/>Open in {s.platform}</span>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
            <Reveal>
              <div style={{ borderRadius: 18, padding: '24px 28px', border: `1.5px dashed ${B}40`, background: `${B}04`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
                <div>
                  <div className="fsyne" style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: B, marginBottom: 4 }}>{t('landing.for_teachers')}</div>
                  <h4 className="fs" style={{ fontSize: 20, color: '#1A1A2E', marginBottom: 4 }}>{t('landing.host_live')}</h4>
                  <p style={{ fontSize: 14, color: '#6B6B80' }}>{t('landing.host_live_sub')}</p>
                </div>
                <Btn v="primary">{t('landing.schedule_class')} <ArrowRight size={14}/></Btn>
              </div>
            </Reveal>
          </div>
        )}
      </div>
    </section>
  );
}

export default Courses;
