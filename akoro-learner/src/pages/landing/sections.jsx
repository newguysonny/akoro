/**
 * Landing page — content sections.
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
import ProTip from '../../components/ProTip.jsx';
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

/* ── Content sections ── */
function ProblemSolution() {
  const card = (style) => ({ borderRadius: 24, padding: '36px 32px', height: '100%', ...style });
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
          <SL>The problem</SL>
          <h2 className="fs" style={{ fontSize: 'clamp(28px,4vw,48px)', color: '#1A1A2E', letterSpacing: '-0.02em', lineHeight: 1.15, maxWidth: 480 }}>Education is stuck in the wrong century.</h2>
        </div>
        <div className="ak-two-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 20 }}>
          <Reveal>
            <div style={card({ background: '#FAF8F5', border: '1px solid #EDE8E1' })}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 99, background: '#F0ECE6', border: '1px solid #DDD8CF', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9490A0', marginBottom: 20 }}><AlertCircle size={10}/>The old way</div>
              <h3 className="fs" style={{ fontSize: 26, color: '#1A1A2E', lineHeight: 1.25, marginBottom: 24 }}>Passive, forgettable, one-size-fits-all</h3>
              {["Sit through 2-hour video lectures you'll forget by morning", "No feedback loop — you don't know what you don't know", '83% of online learners quit before finishing', "Generic AI tutors that don't know your curriculum", 'Pay for content you never finish'].map(t => row(null, t, false))}
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div style={card({ background: `linear-gradient(140deg,${B}08,${B}03)`, border: `1px solid ${B}25` })}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 99, background: `${B}14`, border: `1px solid ${B}30`, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: B, marginBottom: 20 }}><Sparkles size={10}/>The Akoro way</div>
              <h3 className="fs" style={{ fontSize: 26, color: '#1A1A2E', lineHeight: 1.25, marginBottom: 24 }}>Active, adaptive, deeply personal</h3>
              {['Teach your agent — NaNa Esumai guides every session, then she teaches you back — bidirectional', 'Spaced repetition knows exactly when to re-test you', 'Agent battles turn studying into competitive sport', 'Aligned to your exact school syllabus', '89% retention vs 17% from passive video — proven'].map(t => row(null, t, true))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ══════════════ HOW IT WORKS ══════════════ */
function HowItWorks() {
  const steps = [
    { num: '01', icon: <Target size={28} color={B}/>, title: 'Pick a topic', desc: 'Choose from curriculum subjects or create your own. Set subtopics and learning objectives — your agent starts calibrated, not cold.' },
    { num: '02', icon: <Brain size={28} color={B}/>, title: 'Teach your agent', desc: 'Explain concepts via chat or voice. NaNa Esumai guides every step — she listens, asks probing questions, and flags misconceptions in real time.' },
    { num: '03', icon: <Repeat2 size={28} color={B}/>, title: 'Get assessed by Sargeant', desc: 'Sargeant tests your agent on everything you taught. Your confidence score updates after every assessment — before you forget.' },
    { num: '04', icon: <Trophy size={28} color={B}/>, title: 'Rise the ranks', desc: 'Climb classroom and inter-school leaderboards. Challenge friends, earn XP, and prove your knowledge in live battles.' },
  ];
  return (
    <section id="how-it-works" className="ak-section-pad" style={{ padding: '96px 24px', background: '#FAF8F5', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <SL center>How it works</SL>
          <h2 className="fs" style={{ fontSize: 'clamp(28px,4vw,50px)', color: '#1A1A2E', letterSpacing: '-0.02em' }}>
            From first session to <em style={{ color: B, fontStyle: 'italic' }}>top of class</em>
          </h2>
          <p style={{ fontSize: 17, color: '#6B6B80', maxWidth: 520, margin: '12px auto 0', lineHeight: 1.7 }}>Four simple steps that turn passive studying into active mastery.</p>
        </div>
        <div className="ak-how-card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 20, marginBottom: 36 }}>
          {steps.map(({ num, icon, title, desc }, i) => (
            <Reveal key={num} delay={i * 0.09}>
              <div style={{ background: '#fff', border: '1px solid #EDE8E1', borderRadius: 20, padding: '28px 24px', height: '100%', transition: 'transform .2s,box-shadow .2s', cursor: 'default' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 12px 32px ${B}14`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
                <div className="fsyne" style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: B, marginBottom: 18 }}>STEP {num}</div>
                <div style={{ marginBottom: 16 }}>{icon}</div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1A1A2E', marginBottom: 10, lineHeight: 1.35 }}>{title}</h3>
                <p style={{ fontSize: 14, color: '#6B6B80', lineHeight: 1.7 }}>{desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal>
          <ProTip />
        </Reveal>
      </div>
    </section>
  );
}

/* ══════════════ COURSES (lazy-loaded from backend only) ══════════════ */
function Courses() {
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
          <SL>Courses</SL>
          <h2 className="fs" style={{ fontSize: 'clamp(28px,4vw,50px)', color: '#1A1A2E', letterSpacing: '-0.02em', marginBottom: 10 }}>
            Subjects your agent <em style={{ color: B, fontStyle: 'italic' }}>masters</em> with you
          </h2>
          <p style={{ fontSize: 17, color: '#6B6B80', maxWidth: 500, lineHeight: 1.65 }}>Self-paced courses and live sessions on Zoom, Meet & Teams — one platform for all your learning.</p>
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
                  {t === 'all' ? 'All subjects' : t === 'stem' ? 'STEM' : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            {!loading && displayCourses.length === 0 && (
              <div style={{ textAlign: 'center', padding: '64px 24px', color: '#9490A0' }}>
                <BookOpen size={40} color="#DDD8CF" style={{ marginBottom: 16 }}/>
                <p style={{ fontSize: 16, fontWeight: 600, color: '#6B6B80', marginBottom: 6 }}>No courses yet</p>
                <p style={{ fontSize: 14 }}>Courses will appear here once instructors publish them.</p>
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
                <p style={{ fontSize: 16, fontWeight: 600, color: '#6B6B80', marginBottom: 6 }}>No live classes scheduled</p>
                <p style={{ fontSize: 14 }}>Check back soon — instructors post upcoming sessions here.</p>
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
                      {s.status === 'live'     && <Btn v="green" sz="sm"><Radio size={13}/>Join now</Btn>}
                      {s.status === 'upcoming' && <Btn v="primary" sz="sm"><CalendarDays size={13}/>RSVP</Btn>}
                      {s.status === 'recorded' && <Btn v="outline" sz="sm"><MonitorPlay size={13}/>Watch replay</Btn>}
                      <span style={{ fontSize: 11, color: '#9490A0', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><ExternalLink size={10}/>Open in {s.platform}</span>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
            <Reveal>
              <div style={{ borderRadius: 18, padding: '24px 28px', border: `1.5px dashed ${B}40`, background: `${B}04`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
                <div>
                  <div className="fsyne" style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: B, marginBottom: 4 }}>For teachers</div>
                  <h4 className="fs" style={{ fontSize: 20, color: '#1A1A2E', marginBottom: 4 }}>Want to host a live class?</h4>
                  <p style={{ fontSize: 14, color: '#6B6B80' }}>Schedule on Zoom, Google Meet, or Teams. Your students see it here automatically.</p>
                </div>
                <Btn v="primary">Schedule a class <ArrowRight size={14}/></Btn>
              </div>
            </Reveal>
          </div>
        )}
      </div>
    </section>
  );
}



/* ══════════════ OUTCOMES ══════════════ */
function Outcomes() {
  const metrics = [
    { val: '89%', label: 'knowledge retention rate' },
    { val: '3.4×', label: 'faster exam readiness' },
    { val: '78%', label: 'course completion rate' },
    { val: '₦2M+', label: 'avg salary boost (career learners)' },
  ];
  const testimonials = [
    { stars: 5, quote: 'I failed Further Maths twice before Akoro. The agent battles made me actually want to study. Passed with a B2 at WASSCE.', emoji: '👦🏾', bg: '#D4EAD8', name: 'Chukwuemeka Obi', role: 'SS3 Student, Lagos', result: 'D7 → B2 in 4 months' },
    { stars: 5, quote: 'As a teacher with 60 students, the class dashboard is a game-changer. I know who\'s falling behind before the exam — not after.', emoji: '👩🏾‍🏫', bg: '#E4D4F0', name: 'Mrs. Adaeze Nwosu', role: 'Physics Teacher, Enugu', result: '60% → 91% pass rate' },
    { stars: 5, quote: 'I prepped for IELTS alongside a full-time job. 20 mins a day via spaced repetition got me from 6.0 to 7.5.', emoji: '👨🏾‍💼', bg: '#F0E4C8', name: 'Kofi Mensah', role: 'Engineer, Accra → UK', result: 'IELTS 6.0 → 7.5' },
  ];
  return (
    <section id="outcomes" className="ak-section-pad" style={{ padding: '96px 24px', background: '#fff', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <SL center>Results</SL>
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

/* ══════════════ PRICING ══════════════ */
function Pricing() {
  const [yearly, setYearly]   = useState(false);
  const [tab, setTab]          = useState('individual');

  const indiv = [{
    tier: 'Pro', monthlyPrice: 18000, yearlyPrice: 12960, unit: '/mo', featured: true,
    desc: 'For classrooms, teachers, instructors, and tutors who want real results.',
    badge: 'For educators & classrooms',
    features: [[true,'1 AI agent (NaNa Esumai)'],[true,'1 classroom'],[true,'Up to 20 students / learners'],[true,'Unlimited subjects'],[true,'Unlimited agent battles'],[true,'Full knowledge map'],[true,'WAEC/JAMB/NECO curriculum sync'],[true,'Offline access'],[true,'Verifiable certificates']],
    cta: 'Start 14-day free trial →', v: 'primary',
  }];

  const enterprise = [
    {
      tier: 'Starter', monthlyPrice: 85000, yearlyPrice: 61200, unit: '/mo', featured: false,
      desc: 'For growing schools and tutoring centres.',
      badge: 'Per school · up to 150 students',
      features: [[true,'Everything in Pro'],[true,'3 classrooms'],[true,'Teacher management tools'],[true,'Custom syllabus upload'],[true,'Inter-class battle leagues'],[true,'Dedicated support'],[false,'Custom School Management System'],[false,'API access']],
      cta: 'Get started →', v: 'outline',
    },
    {
      tier: 'Enterprise Pro', monthlyPrice: null, yearlyPrice: null, unit: '', featured: true,
      desc: 'Full institutional deployment for large schools and networks.',
      badge: 'Custom pricing · unlimited students',
      features: [[true,'Everything in Starter'],[true,'Custom School Management System'],[true,'Unlimited classrooms'],[true,'Multi-school / district management'],[true,'Custom branding & white-label'],[true,'Priority SLA & onboarding'],[true,'API access & integrations'],[true,'NDPR / FERPA compliance suite']],
      cta: 'Contact sales →', v: 'dark',
    },
  ];

  const plans = tab === 'individual' ? indiv : enterprise;

  return (
    <section id="pricing" className="ak-section-pad" style={{ padding: '96px 24px', background: '#FAF8F5', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <SL center>Pricing</SL>
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
          <span style={{ color: !yearly ? '#1A1A2E' : '#9490A0' }}>Monthly</span>
          <button onClick={() => setYearly(v => !v)} style={{ width: 46, height: 24, borderRadius: 99, background: yearly ? B : '#DDD8CF', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background .2s' }}>
            <div style={{ position: 'absolute', width: 16, height: 16, background: '#fff', borderRadius: '50%', top: 4, left: yearly ? 26 : 4, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }}/>
          </button>
          <span style={{ color: yearly ? '#1A1A2E' : '#9490A0' }}>Yearly</span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: '#E8F8EE', color: '#2AA76E', opacity: yearly ? 1 : 0.4, transition: 'opacity .2s' }}>Save 28%</span>
        </div>

        {/* Individual — single centred card */}
        {tab === 'individual' && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ maxWidth: 420, width: '100%' }}>
              {indiv.map(plan => (
                <Reveal key={plan.tier}>
                  <div style={{ position: 'relative', borderRadius: 24, padding: '40px 36px', border: `1.5px solid ${B}`, background: '#fff', boxShadow: '0 4px 24px rgba(0,0,0,.06)' }}>
                    <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: B, color: '#fff', fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '4px 16px', borderRadius: 99, whiteSpace: 'nowrap' }}>Most popular</div>
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
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>Enterprise Licensing</div>
                  <p style={{ fontSize: 12.5, color: '#6B6B80', lineHeight: 1.65 }}>License Akoro for your school, tutoring centre, or district. Includes school-wide dashboards, teacher tools, inter-class battles, and optionally a full Custom School Management System.</p>
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
            <Shield size={14} style={{ display: 'inline', marginRight: 6, color: B }}/><strong style={{ color: '#1A1A2E' }}>30-day money-back guarantee</strong> — if Akoro doesn't improve your scores, we'll refund every penny.{' '}
            <span style={{ color: B, cursor: 'pointer', textDecoration: 'underline' }}>Financial aid available</span> for students in need.
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════════════ INSTRUCTORS (lazy-loaded from backend only) ══════════════ */
function Instructors() {
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
          <SL>Instructors</SL>
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
            <p style={{ fontSize: 16, fontWeight: 600, color: '#6B6B80', marginBottom: 6 }}>No instructors yet</p>
            <p style={{ fontSize: 14 }}>Instructors will appear here once they join the platform.</p>
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
            <p style={{ fontSize: 15, color: '#6B6B80', marginBottom: 18 }}>Are you an educator? Join our growing community of instructors.</p>
            <Btn v="outline" onClick={() => { window.location.href = `${INSTRUCTOR_URL}/signup`; }}>Apply as an Instructor <ArrowRight size={14}/></Btn>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ══════════════ FAQ ══════════════ */
function FAQ() {
  const [open, setOpen] = useState(0);
  const faqs = [
    ['How much time per week do I need?', 'As little as 20 minutes a day. Our spaced repetition engine is designed for busy schedules — short daily sessions beat occasional long ones.'],
    ['Do I get a certificate when I finish?', 'Yes — Pro and Enterprise plans include verifiable digital certificates. Free tier earns achievement badges but not formal certificates.'],
    ['Can I switch or cancel my plan anytime?', 'Absolutely. No contracts. Cancel from settings in 30 seconds. You keep access until the end of your billing period.'],
    ['Is this aligned to WAEC, JAMB, NECO?', 'Yes — we support WAEC, JAMB, NECO, Cambridge IGCSE/A-Level, KCSE, and IB. Schools on Enterprise can also upload custom syllabi and past questions.'],
    ['How is my data protected?', 'NDPR, FERPA, and GDPR aligned. We never sell student data. TLS 1.3 in transit, AES-256 at rest.'],
    ['What\'s the difference between Enterprise Starter and Enterprise Pro?', 'Starter gives you up to 3 classrooms and teacher tools. Enterprise Pro adds a Custom School Management System, unlimited classrooms, multi-school management, and white-labelling.'],
    ['Does it work offline?', 'Yes — Pro and Enterprise plans cache lessons on-device and sync when you reconnect. Built for Nigerian students with unreliable internet.'],
    ['How do live classes work?', 'Teachers schedule sessions on Zoom, Google Meet, or Microsoft Teams and link them to Akoro. Students see the schedule, join directly, and recordings are available after.'],
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

/* ══════════════ FINAL CTA ══════════════ */

export { ProblemSolution, HowItWorks, Courses, Outcomes, Pricing, Instructors, FAQ };
