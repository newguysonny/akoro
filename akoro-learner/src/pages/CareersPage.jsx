import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AkoroLogo from '../components/common/AkoroLogo.jsx';

const B   = '#6C3BFF';
const B2  = '#4C1DCC';
const INK = '#1A1A2E';
const MUTED = '#6B7280';
const LIGHT = '#F5F3FF';
const BORDER = '#E9E6FF';
const GREEN = '#10B981';

const PERKS = [
  { icon: '🌍', title: 'Remote-first', desc: 'Work from anywhere in Africa. Quarterly team gatherings in Lagos.' },
  { icon: '📚', title: 'Learning budget', desc: '₦500,000/year for courses, books, and conferences of your choice.' },
  { icon: '💰', title: 'Competitive pay', desc: 'Market-rate salaries benchmarked to local and global standards, paid in your local currency.' },
  { icon: '🏥', title: 'Health cover', desc: 'Full HMO coverage for you and your immediate family from day one.' },
  { icon: '📈', title: 'Equity', desc: 'All full-time employees receive stock options. We build this together.' },
  { icon: '⏰', title: 'Flexible hours', desc: 'Core hours 10 AM – 3 PM WAT. Outside that, work when you do your best thinking.' },
  { icon: '🧠', title: 'Mission-driven', desc: 'Your work directly improves learning outcomes for tens of thousands of students.' },
  { icon: '👶', title: 'Parental leave', desc: '16 weeks fully paid for primary carers, 6 weeks for secondary carers.' },
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
  { step: '05', title: 'Offer', desc: 'If we're a match, you get a written offer within 48 hours. We move fast.' },
];

export default function CareersPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('All');
  const [expanded, setExpanded] = useState(null);

  const depts = ['All', ...ROLES.map(r => r.dept)];
  const filtered = filter === 'All' ? ROLES : ROLES.filter(r => r.dept === filter);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=DM+Sans:wght@400;500;600;700&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'DM Sans',sans-serif;background:#fff}
        .job-card:hover{border-color:${B}!important;box-shadow:0 4px 16px rgba(108,59,255,.1)!important}
        .job-card{transition:border-color .15s,box-shadow .15s}
        .perk-card:hover{transform:translateY(-3px);box-shadow:0 8px 24px rgba(108,59,255,.09)!important}
        .perk-card{transition:transform .2s,box-shadow .2s}
      `}</style>

      <div style={{ minHeight: '100vh', background: '#fff', fontFamily: "'DM Sans', sans-serif" }}>

        {/* Nav */}
        <div style={{ background: 'rgba(255,255,255,.95)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${BORDER}`, padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 14, position: 'sticky', top: 0, zIndex: 200 }}>
          <button onClick={() => navigate('/')} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer' }}>
            <AkoroLogo size={32} radius={9} />
            <span style={{ fontSize: 17, fontWeight: 700, color: INK }}>Akoro</span>
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={() => navigate('/about')} style={{ background: 'none', border: `1px solid ${BORDER}`, cursor: 'pointer', color: MUTED, padding: '7px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600 }}>About us</button>
          <button onClick={() => navigate('/contact')} style={{ background: B, border: 'none', cursor: 'pointer', color: '#fff', padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700 }}>Contact us</button>
        </div>

        {/* Hero */}
        <div style={{ background: `linear-gradient(135deg, ${INK} 0%, #2D1B6E 100%)`, padding: 'clamp(64px,8vw,96px) 24px', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: `${B}60`, border: `1px solid ${B}`, borderRadius: 20, padding: '6px 16px', marginBottom: 24 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: GREEN, animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', letterSpacing: '0.08em' }}>{ROLES.reduce((n, r) => n + r.jobs.length, 0)} open roles</span>
          </div>
          <h1 style={{ fontSize: 'clamp(32px,5vw,56px)', fontWeight: 900, color: '#fff', marginBottom: 20, lineHeight: 1.15, fontFamily: "'Nunito', sans-serif", maxWidth: 700, margin: '0 auto 20px' }}>
            Help us make learning actually stick — for every student in Africa
          </h1>
          <p style={{ fontSize: 'clamp(14px,2vw,17px)', color: 'rgba(255,255,255,.8)', maxWidth: 560, margin: '0 auto 36px', lineHeight: 1.75 }}>
            We're a small, high-conviction team building the learning tools we wish we'd had. If that sounds like your kind of problem, read on.
          </p>
          <button onClick={() => document.getElementById('open-roles')?.scrollIntoView({ behavior: 'smooth' })}
            style={{ background: B, color: '#fff', padding: '14px 32px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 800, fontFamily: "'Nunito', sans-serif" }}>
            See open roles ↓
          </button>
        </div>

        {/* Perks */}
        <div style={{ background: LIGHT, padding: 'clamp(48px,6vw,72px) 24px' }}>
          <div style={{ maxWidth: 1040, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 40 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: B, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>Why Work Here</div>
              <h2 style={{ fontSize: 'clamp(22px,3vw,32px)', fontWeight: 900, color: INK, fontFamily: "'Nunito', sans-serif" }}>We take care of our team</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              {PERKS.map(({ icon, title, desc }) => (
                <div key={title} className="perk-card"
                  style={{ background: '#fff', borderRadius: 14, padding: '22px 18px', border: `1px solid ${BORDER}`, boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
                  <span style={{ fontSize: 28, display: 'block', marginBottom: 12 }}>{icon}</span>
                  <div style={{ fontSize: 14, fontWeight: 800, color: INK, marginBottom: 6, fontFamily: "'Nunito', sans-serif" }}>{title}</div>
                  <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.65 }}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Open roles */}
        <div id="open-roles" style={{ maxWidth: 1040, margin: '0 auto', padding: 'clamp(48px,6vw,72px) 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: B, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>Open Positions</div>
            <h2 style={{ fontSize: 'clamp(22px,3vw,32px)', fontWeight: 900, color: INK, fontFamily: "'Nunito', sans-serif" }}>Find your role</h2>
          </div>

          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 32, justifyContent: 'center' }}>
            {depts.map(d => (
              <button key={d} onClick={() => setFilter(d)}
                style={{ padding: '8px 18px', borderRadius: 20, border: `1.5px solid ${filter === d ? B : BORDER}`, background: filter === d ? B : '#fff', color: filter === d ? '#fff' : MUTED, fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all .15s' }}>
                {d}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {filtered.map(({ dept, color, jobs }) => (
              <div key={dept}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <div style={{ height: 2, flex: 1, background: `${color}20` }} />
                  <span style={{ fontSize: 12, fontWeight: 800, color, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '4px 12px', background: `${color}12`, borderRadius: 20 }}>{dept}</span>
                  <div style={{ height: 2, flex: 1, background: `${color}20` }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {jobs.map(({ title, location, type, summary }) => {
                    const key = `${dept}-${title}`;
                    const open = expanded === key;
                    return (
                      <div key={title} className="job-card"
                        style={{ background: '#fff', borderRadius: 14, border: `1.5px solid ${BORDER}`, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
                        <div style={{ padding: '20px 22px', display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }} onClick={() => setExpanded(open ? null : key)}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 6, fontFamily: "'Nunito', sans-serif" }}>{title}</div>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 12, color: MUTED, display: 'flex', alignItems: 'center', gap: 4 }}>📍 {location}</span>
                              <span style={{ fontSize: 12, color: MUTED, display: 'flex', alignItems: 'center', gap: 4 }}>🕐 {type}</span>
                            </div>
                          </div>
                          <div style={{ fontSize: 18, color: MUTED, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>⌄</div>
                        </div>
                        {open && (
                          <div style={{ padding: '0 22px 22px', borderTop: `1px solid ${BORDER}` }}>
                            <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.75, marginTop: 16, marginBottom: 20 }}>{summary}</p>
                            <a href={`mailto:careers@akoro.app?subject=Application: ${title}`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: B, color: '#fff', padding: '10px 22px', borderRadius: 10, fontSize: 13, fontWeight: 700, textDecoration: 'none', fontFamily: "'Nunito', sans-serif" }}>
                              Apply for this role →
                            </a>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Hiring process */}
        <div style={{ background: LIGHT, padding: 'clamp(48px,6vw,72px) 24px' }}>
          <div style={{ maxWidth: 840, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: B, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>How We Hire</div>
              <h2 style={{ fontSize: 'clamp(22px,3vw,32px)', fontWeight: 900, color: INK, fontFamily: "'Nunito', sans-serif" }}>Our hiring process</h2>
              <p style={{ fontSize: 14, color: MUTED, marginTop: 10 }}>From first application to offer — usually within 2 weeks.</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              {PROCESS.map(({ step, title, desc }) => (
                <div key={step} style={{ background: '#fff', borderRadius: 14, padding: '22px 20px', border: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: B, letterSpacing: '0.12em', marginBottom: 10 }}>STEP {step}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: INK, marginBottom: 8, fontFamily: "'Nunito', sans-serif" }}>{title}</div>
                  <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.7 }}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* No role CTA */}
        <div style={{ maxWidth: 680, margin: '0 auto', padding: 'clamp(40px,5vw,64px) 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 16 }}>💌</div>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: INK, marginBottom: 10, fontFamily: "'Nunito', sans-serif" }}>Don't see the right role?</h2>
          <p style={{ fontSize: 14, color: MUTED, lineHeight: 1.75, marginBottom: 24 }}>We're always open to hearing from exceptional people. Send us a short note about who you are and what you'd build at Akoro.</p>
          <a href="mailto:careers@akoro.app?subject=Open application"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: B, color: '#fff', padding: '13px 28px', borderRadius: 12, fontSize: 15, fontWeight: 800, textDecoration: 'none', fontFamily: "'Nunito', sans-serif" }}>
            Send an open application →
          </a>
        </div>

        {/* Footer mini */}
        <div style={{ background: '#F5F2EC', padding: '24px', textAlign: 'center', borderTop: '1px solid #E2DDD6' }}>
          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            {[['/', 'Home'], ['/about', 'About'], ['/contact', 'Contact'], ['/privacy', 'Privacy'], ['/terms', 'Terms']].map(([href, label]) => (
              <a key={label} href={href} style={{ fontSize: 13, color: MUTED, textDecoration: 'none', fontWeight: 500 }}
                onMouseEnter={e => e.target.style.color = B} onMouseLeave={e => e.target.style.color = MUTED}>{label}</a>
            ))}
          </div>
          <p style={{ fontSize: 12, color: '#9CA3AF' }}>© 2025 Akoro Technologies Ltd. All rights reserved.</p>
        </div>
      </div>
    </>
  );
}
