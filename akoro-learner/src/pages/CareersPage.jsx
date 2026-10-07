import { useState, useEffect } from 'react';
import { SiteNav, SiteFooter } from '../components/SiteChrome.jsx';
import {
  Globe, BookOpen, Coins, HeartPulse, TrendingUp, Clock, Brain, Baby,
  MapPin, ChevronDown, ArrowDown, ArrowRight, Mail, Loader2,
} from 'lucide-react';
import { listJobs, applyToJob } from '../services/contentApi.js';

const B      = '#6C3BFF';
const B2     = '#4C1DCC';
const INK    = '#0F0A1E';
const TEXT   = '#3F3A52';
const MUTED  = '#7A7588';
const BORDER = '#ECEAF4';
const SURFACE = '#FAFAFB';
const TINT   = '#F6F4FF';
const GREEN  = '#10B981';

const PERKS = [
  { Icon: Globe, title: 'Remote-first', desc: 'Work from anywhere in Africa. Quarterly team gatherings in Lagos.' },
  { Icon: BookOpen, title: 'Learning budget', desc: '₦500,000/year for courses, books, and conferences of your choice.' },
  { Icon: Coins, title: 'Competitive pay', desc: 'Market-rate salaries benchmarked to local and global standards, paid in your local currency.' },
  { Icon: HeartPulse, title: 'Health cover', desc: 'Full HMO coverage for you and your immediate family from day one.' },
  { Icon: TrendingUp, title: 'Equity', desc: 'All full-time employees receive stock options. We build this together.' },
  { Icon: Clock, title: 'Flexible hours', desc: 'Core hours 10 AM – 3 PM WAT. Outside that, work when you do your best thinking.' },
  { Icon: Brain, title: 'Mission-driven', desc: 'Your work directly improves learning outcomes for tens of thousands of students.' },
  { Icon: Baby, title: 'Parental leave', desc: '16 weeks fully paid for primary carers, 6 weeks for secondary carers.' },
];

const ROLES = [
  {
    dept: 'Engineering',
    color: '#6366F1',
    jobs: [
      { title: 'Senior Full-Stack Engineer', location: 'Remote (Africa)', type: 'Full-time', summary: 'Build the core learning platform — from AI session flows to real-time battle systems. React, Node.js, Supabase.' },
      { title: 'ML Engineer — Knowledge Models', location: 'Remote (Africa)', type: 'Full-time', summary: 'Train and evaluate our knowledge decay engine and bidirectional learning models. Python, PyTorch, experience with RAG systems.' },
      { title: 'Mobile Engineer (React Native)', location: 'Remote (Africa)', type: 'Full-time', summary: 'Own the offline-first mobile experience for learners across Nigeria and beyond.' },
    ],
  },
  {
    dept: 'Product & Design',
    color: '#7C3AED',
    jobs: [
      { title: 'Product Manager — Learner Experience', location: 'Remote (Africa)', type: 'Full-time', summary: 'Drive the roadmap for the student-facing platform. Own the metrics that matter: retention, session completion, XP earned.' },
      { title: 'Senior Product Designer', location: 'Remote (Africa)', type: 'Full-time', summary: 'Shape how 40,000+ students experience learning. From information architecture to polished micro-interactions.' },
    ],
  },
  {
    dept: 'AI & Research',
    color: '#059669',
    jobs: [
      { title: 'AI Curriculum Researcher', location: 'Lagos or Remote', type: 'Full-time', summary: 'Align AI assessments to WAEC, NECO, JAMB, and IGCSE syllabi. Bridge between cognitive science and AI implementation.' },
      { title: 'Prompt Engineer', location: 'Remote (Africa)', type: 'Full-time', summary: 'Design and optimise the prompts that power NaNa Esumai\'s teaching conversations and Sargeant\'s assessments.' },
    ],
  },
  {
    dept: 'Growth & Schools',
    color: '#D97706',
    jobs: [
      { title: 'School Partnerships Lead', location: 'Lagos / Abuja', type: 'Full-time', summary: 'Bring Akoro into classrooms across Nigeria. Build relationships with school administrators, state education boards, and parent associations.' },
      { title: 'Content Marketing Manager', location: 'Remote (Africa)', type: 'Full-time', summary: 'Own the Akoro blog, social channels, and newsletter. Tell our story in a way that resonates with students, parents, and teachers.' },
    ],
  },
  {
    dept: 'Operations',
    color: '#6B7280',
    jobs: [
      { title: 'Customer Success Manager', location: 'Remote (Africa)', type: 'Full-time', summary: 'Ensure instructors and schools get maximum value from the platform. Run onboarding, training sessions, and retention programmes.' },
    ],
  },
];

const PROCESS = [
  { step: '01', title: 'Apply', desc: 'Send your CV and a short note on why Akoro resonates with you. No cover letter required — just be honest.' },
  { step: '02', title: 'Intro call', desc: '30-minute conversation with a team member. We want to know you, not quiz you on algorithms yet.' },
  { step: '03', title: 'Skills assessment', desc: 'A focused take-home task (2–3 hours max). We pay you for your time — ₦15,000 stipend on completion.' },
  { step: '04', title: 'Panel interview', desc: 'Meet 2–3 team members. Half technical, half cultural. We share our values and you share yours.' },
  { step: '05', title: 'Offer', desc: "If we're a match, you get a written offer within 48 hours. We move fast." },
];

const EYEBROW = { fontSize: 11, fontWeight: 800, color: B, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const HEADING = { fontSize: 'clamp(24px,4vw,48px)', fontWeight: 900, color: INK, fontFamily: "'Nunito', sans-serif", lineHeight: 1.15, letterSpacing: '-0.02em' };

export default function CareersPage() {
  const [filter, setFilter]   = useState('All');
  const [expanded, setExpanded] = useState(null);
  const [roles, setRoles]     = useState([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesError, setRolesError]     = useState(false);

  // per-job application state: { [jobId]: 'idle'|'open'|'sending'|'done'|'error' }
  const [applyState, setApplyState] = useState({});
  const [applyForm, setApplyForm]   = useState({});

  useEffect(() => {
    let alive = true;
    listJobs()
      .then(data  => { if (alive) { setRoles(data || []); setRolesLoading(false); } })
      .catch(()   => { if (alive) { setRolesError(true); setRolesLoading(false); } });
    return () => { alive = false; };
  }, []);

  const depts    = ['All', ...roles.map(r => r.dept)];
  const filtered = filter === 'All' ? roles : roles.filter(r => r.dept === filter);
  const openCount = roles.reduce((n, r) => n + r.jobs.length, 0);

  const setField = (jobId, k) => e =>
    setApplyForm(f => ({ ...f, [jobId]: { ...(f[jobId] || {}), [k]: e.target.value } }));

  const handleApply = async (e, jobId) => {
    e.preventDefault();
    const payload = applyForm[jobId] || {};
    setApplyState(s => ({ ...s, [jobId]: 'sending' }));
    try {
      await applyToJob(jobId, { name: payload.name, email: payload.email, message: payload.message });
      setApplyState(s => ({ ...s, [jobId]: 'done' }));
    } catch {
      setApplyState(s => ({ ...s, [jobId]: 'error' }));
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=DM+Sans:wght@400;500;600;700&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'DM Sans',sans-serif;background:#fff}
        @keyframes pulse{0%{transform:scale(1);opacity:1}50%{transform:scale(1.6);opacity:.4}100%{transform:scale(1);opacity:1}}

        .crs-section{padding:clamp(48px,6vw,72px) 20px}
        .crs-hero{padding:clamp(56px,8vw,96px) 20px}
        .crs-container{max-width:1080px;margin:0 auto}

        .crs-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}

        .perk-card{background:#fff;border-radius:16px;padding:24px 20px;border:1px solid ${BORDER};box-shadow:0 1px 2px rgba(16,10,30,.04);transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
        .perk-card:hover{transform:translateY(-4px);box-shadow:0 12px 28px rgba(108,59,255,.10);border-color:${B}33}

        .job-card{background:#fff;border-radius:16px;border:1px solid ${BORDER};overflow:hidden;box-shadow:0 1px 2px rgba(16,10,30,.04);transition:border-color .18s ease,box-shadow .18s ease}
        .job-card:hover{border-color:${B}55;box-shadow:0 6px 20px rgba(108,59,255,.08)}

        .job-head{padding:20px 22px;display:flex;align-items:flex-start;gap:14px;cursor:pointer}
        .job-meta{display:flex;gap:14px;flex-wrap:wrap}
        .job-meta span{font-size:12.5px;color:${MUTED};display:inline-flex;align-items:center;gap:5px;white-space:nowrap}

        .chip{padding:8px 18px;border-radius:999px;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s ease;white-space:nowrap}

        .crs-chev{color:${MUTED};flex-shrink:0;margin-top:2px;transition:transform .25s ease}
        .crs-chev.open{transform:rotate(180deg);color:${B}}

        .crs-cta-btn{transition:transform .15s ease,box-shadow .15s ease}
        .crs-cta-btn:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(108,59,255,.28)}

        @media (max-width:600px){
          .crs-nav{padding:11px 16px!important}
          .crs-nav-secondary{display:none!important}
        }
      `}</style>

      <div style={{ minHeight: '100vh', background: '#fff', fontFamily: "'DM Sans', sans-serif" }}>

        {/* Nav */}
        <SiteNav />

        {/* Hero */}
        <div className="crs-hero" style={{ background: `linear-gradient(135deg, ${INK}, #2D1B6E)`, textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.16)', borderRadius: 999, padding: '7px 16px', marginBottom: 26 }}>
            <span style={{ position: 'relative', display: 'inline-flex', width: 8, height: 8 }}>
              <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: GREEN, animation: 'pulse 2s infinite' }} />
              <span style={{ position: 'relative', width: 8, height: 8, borderRadius: '50%', background: GREEN }} />
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', letterSpacing: '0.06em' }}>{openCount} open roles</span>
          </div>
          <h1 style={{ ...HEADING, color: '#fff', maxWidth: 760, margin: '0 auto 20px' }}>
            Help us make learning actually stick — for every student in Africa
          </h1>
          <p style={{ fontSize: 'clamp(15px,2vw,18px)', color: 'rgba(255,255,255,.78)', maxWidth: 580, margin: '0 auto 36px', lineHeight: 1.7 }}>
            We're a small, high-conviction team building the learning tools we wish we'd had. If that sounds like your kind of problem, read on.
          </p>
          <button className="crs-cta-btn" onClick={() => document.getElementById('open-roles')?.scrollIntoView({ behavior: 'smooth' })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: B, color: '#fff', padding: '14px 30px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 800, fontFamily: "'Nunito', sans-serif" }}>
            See open roles <ArrowDown size={17} />
          </button>
        </div>

        {/* Perks */}
        <div className="crs-section" style={{ background: SURFACE }}>
          <div className="crs-container">
            <div style={{ textAlign: 'center', marginBottom: 44 }}>
              <div style={EYEBROW}>Why Work Here</div>
              <h2 style={{ ...HEADING, fontSize: 'clamp(24px,3.4vw,38px)' }}>We take care of our team</h2>
            </div>
            <div className="crs-grid">
              {PERKS.map(({ Icon, title, desc }) => (
                <div key={title} className="perk-card">
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 12, background: TINT, marginBottom: 16 }}>
                    <Icon size={21} color={B} strokeWidth={2.2} />
                  </span>
                  <div style={{ fontSize: 15, fontWeight: 800, color: INK, marginBottom: 7, fontFamily: "'Nunito', sans-serif" }}>{title}</div>
                  <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.7 }}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Open roles */}
        <div id="open-roles" className="crs-section">
          <div className="crs-container">
            <div style={{ textAlign: 'center', marginBottom: 36 }}>
              <div style={EYEBROW}>Open Positions</div>
              <h2 style={{ ...HEADING, fontSize: 'clamp(24px,3.4vw,38px)' }}>Find your role</h2>
            </div>

            {/* Filter chips */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 36, justifyContent: 'center' }}>
              {depts.map(d => (
                <button key={d} className="chip" onClick={() => setFilter(d)}
                  style={{ border: `1.5px solid ${filter === d ? B : BORDER}`, background: filter === d ? B : '#fff', color: filter === d ? '#fff' : TEXT }}>
                  {d}
                </button>
              ))}
            </div>

            {rolesLoading ? (
              <div style={{ textAlign: 'center', padding: '60px 0', color: MUTED }}>
                <Loader2 size={30} style={{ animation: 'pulse 1s linear infinite', marginBottom: 12 }} />
                <p>Loading open roles…</p>
              </div>
            ) : rolesError ? (
              <div style={{ textAlign: 'center', padding: '60px 0', color: MUTED }}>
                <p>Couldn't load roles right now — please refresh the page.</p>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 0', color: MUTED }}>
                <p>No open roles in this department right now. Check back soon.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
                {filtered.map(({ dept, color, jobs }) => (
                  <div key={dept}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                      <div style={{ height: 1, flex: 1, background: BORDER }} />
                      <span style={{ fontSize: 11.5, fontWeight: 800, color, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '5px 14px', background: `${color}14`, borderRadius: 999 }}>{dept}</span>
                      <div style={{ height: 1, flex: 1, background: BORDER }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {jobs.map((job) => {
                        const { id, title, location, type, summary } = job;
                        const key  = id || `${dept}-${title}`;
                        const open = expanded === key;
                        const as   = applyState[key] || 'idle';
                        const af   = applyForm[key]  || {};
                        return (
                          <div key={key} className="job-card">
                            <div className="job-head" onClick={() => setExpanded(open ? null : key)}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 15.5, fontWeight: 700, color: INK, marginBottom: 8, fontFamily: "'Nunito', sans-serif" }}>{title}</div>
                                <div className="job-meta">
                                  <span><MapPin size={14} color={MUTED} /> {location}</span>
                                  <span><Clock size={14} color={MUTED} /> {type}</span>
                                </div>
                              </div>
                              <ChevronDown size={20} className={`crs-chev${open ? ' open' : ''}`} />
                            </div>
                            {open && (
                              <div style={{ padding: '0 22px 24px', borderTop: `1px solid ${BORDER}` }}>
                                <p style={{ fontSize: 14, color: TEXT, lineHeight: 1.7, marginTop: 16, marginBottom: 20 }}>{summary}</p>
                                {as === 'done' ? (
                                  <p style={{ color: '#22C55E', fontWeight: 700, fontSize: 14 }}>Application received! We'll be in touch.</p>
                                ) : (
                                  <form onSubmit={e => handleApply(e, key)} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480 }}>
                                    <input required placeholder="Full name" value={af.name || ''} onChange={setField(key, 'name')}
                                      style={{ padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${BORDER}`, fontSize: 14, fontFamily: 'inherit', color: INK, outline: 'none' }} />
                                    <input required type="email" placeholder="Email address" value={af.email || ''} onChange={setField(key, 'email')}
                                      style={{ padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${BORDER}`, fontSize: 14, fontFamily: 'inherit', color: INK, outline: 'none' }} />
                                    <textarea placeholder="Why are you excited about this role? (optional)" rows={3} value={af.message || ''} onChange={setField(key, 'message')}
                                      style={{ padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${BORDER}`, fontSize: 14, fontFamily: 'inherit', color: INK, outline: 'none', resize: 'vertical' }} />
                                    {as === 'error' && <p style={{ color: '#EF4444', fontSize: 13 }}>Something went wrong — please try again.</p>}
                                    <button type="submit" disabled={as === 'sending'} className="crs-cta-btn"
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: as === 'sending' ? '#9E8CFF' : B, color: '#fff', padding: '11px 22px', borderRadius: 10, border: 'none', cursor: as === 'sending' ? 'default' : 'pointer', fontSize: 13.5, fontWeight: 700, fontFamily: "'Nunito', sans-serif", width: 'fit-content' }}>
                                      {as === 'sending' ? 'Sending…' : <> Apply for this role <ArrowRight size={16} /> </>}
                                    </button>
                                  </form>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Hiring process */}
        <div className="crs-section" style={{ background: SURFACE }}>
          <div className="crs-container">
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
              <div style={EYEBROW}>How We Hire</div>
              <h2 style={{ ...HEADING, fontSize: 'clamp(24px,3.4vw,38px)' }}>Our hiring process</h2>
              <p style={{ fontSize: 15, color: MUTED, marginTop: 12 }}>From first application to offer — usually within 2 weeks.</p>
            </div>
            <div className="crs-grid">
              {PROCESS.map(({ step, title, desc }) => (
                <div key={step} style={{ background: '#fff', borderRadius: 16, padding: '24px 22px', border: `1px solid ${BORDER}`, boxShadow: '0 1px 2px rgba(16,10,30,.04)' }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: B, letterSpacing: '0.12em', marginBottom: 12 }}>STEP {step}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: INK, marginBottom: 8, fontFamily: "'Nunito', sans-serif" }}>{title}</div>
                  <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.7 }}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* No role CTA */}
        <div style={{ maxWidth: 680, margin: '0 auto', padding: 'clamp(48px,6vw,72px) 20px', textAlign: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 16, background: TINT, marginBottom: 20 }}>
            <Mail size={26} color={B} strokeWidth={2.2} />
          </span>
          <h2 style={{ ...HEADING, fontSize: 'clamp(22px,3vw,30px)', marginBottom: 12 }}>Don't see the right role?</h2>
          <p style={{ fontSize: 15, color: MUTED, lineHeight: 1.7, marginBottom: 26 }}>We're always open to hearing from exceptional people. Send us a short note about who you are and what you'd build at Akoro.</p>
          <a href="mailto:careers@akoro.app?subject=Open application" className="crs-cta-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: B, color: '#fff', padding: '13px 28px', borderRadius: 12, fontSize: 15, fontWeight: 800, textDecoration: 'none', fontFamily: "'Nunito', sans-serif" }}>
            Send an open application <ArrowRight size={17} />
          </a>
        </div>

        {/* Footer */}
        <SiteFooter />
      </div>
    </>
  );
}
