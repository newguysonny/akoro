import { useNavigate } from 'react-router-dom';
import AkoroLogo from '../components/common/AkoroLogo.jsx';

const B  = '#6C3BFF';
const B2 = '#4C1DCC';
const INK = '#1A1A2E';
const MUTED = '#6B7280';
const LIGHT = '#F5F3FF';
const BORDER = '#E9E6FF';

const TEAM = [
  { name: 'Sonny Amobi', role: 'Co-Founder & CEO', emoji: '👨🏿‍💻', bio: 'Former classroom teacher turned technologist. Spent 6 years teaching secondary school maths before building the tools he wished he\'d had.' },
  { name: 'Nana Esumai', role: 'Head of AI & Research', emoji: '🧠', bio: 'PhD in Cognitive Science from the University of Lagos. Pioneered the bidirectional teaching model that sits at the heart of Akoro\'s learning engine.' },
  { name: 'Temi Oladele', role: 'Co-Founder & CTO', emoji: '👩🏽‍💻', bio: 'Full-stack engineer with a decade in EdTech. Built scalable learning infrastructure for over 500,000 students across West Africa before joining Akoro.' },
  { name: 'Chidi Nwosu', role: 'Head of Product', emoji: '🎨', bio: 'Obsessed with the student experience. Formerly at Andela and Coursera Africa. Leads every design decision from the student\'s desk, not a boardroom.' },
  { name: 'Adaeze Ibe', role: 'Head of Partnerships', emoji: '🤝', bio: 'Spent 8 years in the Nigerian education sector building school networks. Now brings Akoro into classrooms across 12 states and counting.' },
  { name: 'Kwame Asante', role: 'Lead AI Engineer', emoji: '⚡', bio: 'Former ML engineer at Google Research Africa. Leads the development of Akoro\'s knowledge decay engine and spaced-repetition models.' },
];

const VALUES = [
  { icon: '🧠', title: 'Learning by teaching', desc: 'The most powerful way to learn anything is to explain it. We built a platform around that truth, not around passive video.' },
  { icon: '🌍', title: 'Built for Africa', desc: 'Nigeria first, Africa always. Our AI is aligned to WAEC, NECO, and JAMB curricula. We work offline. We price for our market.' },
  { icon: '🔬', title: 'Science-backed', desc: 'Everything we build is grounded in cognitive science — spaced repetition, retrieval practice, the protégé effect. Not marketing, methods.' },
  { icon: '🏫', title: 'Teacher partnership', desc: 'We amplify great teachers; we don\'t replace them. NaNa Esumai is a guide, not a substitute for human expertise and relationship.' },
  { icon: '📊', title: 'Radical transparency', desc: 'Students see exactly what their agent knows and where it is weak. Parents and teachers see the same. No black boxes.' },
  { icon: '⚖️', title: 'Equity of access', desc: 'Outstanding education should not depend on postcode or income. We offer offline access, affordable pricing, and school partnerships to make that real.' },
];

const MILESTONES = [
  { year: '2021', title: 'The idea', desc: 'Sonny, frustrated by how quickly students forget what they\'ve just been taught, starts research into the protégé effect in Nigerian classrooms.' },
  { year: '2022', title: 'First prototype', desc: 'A simple chat interface where students explain concepts to a basic AI. Early tests show 3× better retention after just 4 weeks.' },
  { year: '2023', title: 'Akoro is born', desc: 'Akoro Technologies Ltd is incorporated in Lagos. NaNa Esumai and Sargeant are named. First 50 schools onboarded in a pilot programme.' },
  { year: '2024', title: 'Platform launch', desc: 'Full learner and instructor platforms launch. Agent battles, live classes, and the spaced-repetition engine ship. 40,000 students in the first six months.' },
  { year: '2025', title: 'Scaling Africa', desc: 'Expanding to Ghana, Kenya, and South Africa. AI models aligned to local curricula. Partnerships with ministry of education pilots underway.' },
];

export default function AboutPage() {
  const navigate = useNavigate();

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=DM+Sans:wght@400;500;600;700&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'DM Sans',sans-serif;background:#fff}
        .about-team-card:hover{transform:translateY(-4px);box-shadow:0 12px 32px rgba(108,59,255,.12)!important}
        .about-team-card{transition:transform .2s,box-shadow .2s}
      `}</style>

      <div style={{ minHeight: '100vh', background: '#fff', fontFamily: "'DM Sans', sans-serif" }}>

        {/* Nav */}
        <div style={{ background: 'rgba(255,255,255,.95)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${BORDER}`, padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 14, position: 'sticky', top: 0, zIndex: 200 }}>
          <button onClick={() => navigate('/')}
            style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer' }}>
            <AkoroLogo size={32} radius={9} />
            <span style={{ fontSize: 17, fontWeight: 700, color: INK, fontFamily: "'DM Sans', sans-serif" }}>Akoro</span>
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={() => navigate('/contact')}
            style={{ background: 'none', border: `1px solid ${BORDER}`, cursor: 'pointer', color: MUTED, padding: '7px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600 }}>
            Contact us
          </button>
          <button onClick={() => navigate('/careers')}
            style={{ background: B, border: 'none', cursor: 'pointer', color: '#fff', padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700 }}>
            We're hiring →
          </button>
        </div>

        {/* Hero */}
        <div style={{ background: `linear-gradient(135deg, ${B} 0%, ${B2} 100%)`, padding: 'clamp(64px,8vw,96px) 24px', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.25)', borderRadius: 20, padding: '6px 16px', marginBottom: 24 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Our Story</span>
          </div>
          <h1 style={{ fontSize: 'clamp(32px,5vw,56px)', fontWeight: 900, color: '#fff', marginBottom: 20, lineHeight: 1.15, fontFamily: "'Nunito', sans-serif", maxWidth: 700, margin: '0 auto 20px' }}>
            We're on a mission to make learning actually stick
          </h1>
          <p style={{ fontSize: 'clamp(15px,2vw,18px)', color: 'rgba(255,255,255,.85)', maxWidth: 580, margin: '0 auto 36px', lineHeight: 1.75 }}>
            Akoro is an AI-powered learning platform built in Lagos, Nigeria — designed around the science of how the human brain actually retains information.
          </p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[['40,000+', 'Students learning'],['500+', 'Schools onboarded'],['12', 'States reached'],['89%', 'Retention rate']].map(([stat, label]) => (
              <div key={label} style={{ background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 14, padding: '16px 24px', textAlign: 'center', minWidth: 110 }}>
                <div style={{ fontSize: 26, fontWeight: 900, color: '#fff', fontFamily: "'Nunito', sans-serif" }}>{stat}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.75)', fontWeight: 600, marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Mission section */}
        <div style={{ maxWidth: 900, margin: '0 auto', padding: 'clamp(48px,6vw,80px) 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: B, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 12 }}>Why We Exist</div>
              <h2 style={{ fontSize: 'clamp(22px,3vw,32px)', fontWeight: 800, color: INK, marginBottom: 18, lineHeight: 1.25, fontFamily: "'Nunito', sans-serif" }}>Students forget 80% of what they learn within a week. We built Akoro to fix that.</h2>
              <p style={{ fontSize: 14, color: MUTED, lineHeight: 1.8, marginBottom: 16 }}>
                The forgetting curve is one of the most well-documented findings in cognitive science — and one of the most ignored in how we actually teach. Passive watching, note-taking, re-reading: they feel productive but they don't work.
              </p>
              <p style={{ fontSize: 14, color: MUTED, lineHeight: 1.8, marginBottom: 24 }}>
                The protégé effect — where you learn deeply by teaching someone else — is one of the most powerful techniques we know. Akoro puts that at the centre of every learning session, powered by AI, available to every student with a phone.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {['Built by former teachers, not just engineers','Curriculum-aligned to WAEC, NECO, and JAMB','Offline-first for real African infrastructure','Priced for schools, not Silicon Valley'].map(p => (
                  <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: `${B}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 11 }}>✓</span>
                    </div>
                    <span style={{ fontSize: 13.5, color: INK, fontWeight: 500 }}>{p}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: LIGHT, borderRadius: 20, padding: '28px 24px', borderLeft: `4px solid ${B}` }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>🧠</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: INK, marginBottom: 6 }}>The Protégé Effect</div>
                <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.7 }}>Students who teach a concept to someone else retain up to 89% of it after a week — versus 17% from passive video viewing.</p>
              </div>
              <div style={{ background: '#FFF7ED', borderRadius: 20, padding: '28px 24px', borderLeft: '4px solid #F59E0B' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📊</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: INK, marginBottom: 6 }}>Spaced Repetition</div>
                <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.7 }}>Sargeant tracks every concept and resurfaces it at exactly the right moment — before the knowledge fades. Science, not guesswork.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Values */}
        <div style={{ background: LIGHT, padding: 'clamp(48px,6vw,80px) 24px' }}>
          <div style={{ maxWidth: 1040, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: B, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>What We Stand For</div>
              <h2 style={{ fontSize: 'clamp(24px,3.5vw,36px)', fontWeight: 900, color: INK, fontFamily: "'Nunito', sans-serif" }}>Our values</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              {VALUES.map(({ icon, title, desc }) => (
                <div key={title} style={{ background: '#fff', borderRadius: 16, padding: '24px 22px', border: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 32, marginBottom: 14 }}>{icon}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: INK, marginBottom: 8, fontFamily: "'Nunito', sans-serif" }}>{title}</div>
                  <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.75 }}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(48px,6vw,80px) 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: B, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>How We Got Here</div>
            <h2 style={{ fontSize: 'clamp(24px,3.5vw,36px)', fontWeight: 900, color: INK, fontFamily: "'Nunito', sans-serif" }}>Our journey</h2>
          </div>
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: 56, top: 0, bottom: 0, width: 2, background: `linear-gradient(to bottom, ${B}, ${B}20)` }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
              {MILESTONES.map(({ year, title, desc }) => (
                <div key={year} style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
                  <div style={{ flexShrink: 0, width: 48, textAlign: 'right' }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: B }}>{year}</span>
                  </div>
                  <div style={{ position: 'relative', flexShrink: 0, marginTop: 2 }}>
                    <div style={{ width: 16, height: 16, borderRadius: '50%', background: B, border: '3px solid #fff', boxShadow: `0 0 0 3px ${B}30` }} />
                  </div>
                  <div style={{ paddingTop: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: INK, marginBottom: 6, fontFamily: "'Nunito', sans-serif" }}>{title}</div>
                    <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.75 }}>{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Team */}
        <div style={{ background: LIGHT, padding: 'clamp(48px,6vw,80px) 24px' }}>
          <div style={{ maxWidth: 1040, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: B, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>The People</div>
              <h2 style={{ fontSize: 'clamp(24px,3.5vw,36px)', fontWeight: 900, color: INK, fontFamily: "'Nunito', sans-serif" }}>Meet the team</h2>
              <p style={{ fontSize: 14, color: MUTED, marginTop: 12, maxWidth: 500, margin: '12px auto 0' }}>Former teachers, engineers, scientists, and operators — united by a belief that every student deserves tools that actually work.</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              {TEAM.map(({ name, role, emoji, bio }) => (
                <div key={name} className="about-team-card"
                  style={{ background: '#fff', borderRadius: 16, padding: '28px 22px', border: `1px solid ${BORDER}`, boxShadow: '0 2px 8px rgba(0,0,0,.05)' }}>
                  <div style={{ width: 56, height: 56, borderRadius: 16, background: `${B}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 16 }}>{emoji}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: INK, fontFamily: "'Nunito', sans-serif" }}>{name}</div>
                  <div style={{ fontSize: 12, color: B, fontWeight: 700, marginBottom: 12, marginTop: 2 }}>{role}</div>
                  <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.75 }}>{bio}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div style={{ background: `linear-gradient(135deg, ${B} 0%, ${B2} 100%)`, padding: 'clamp(48px,6vw,72px) 24px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 'clamp(24px,3.5vw,36px)', fontWeight: 900, color: '#fff', marginBottom: 16, fontFamily: "'Nunito', sans-serif" }}>Ready to actually remember what you learn?</h2>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,.8)', marginBottom: 32, maxWidth: 480, margin: '0 auto 32px' }}>Join 40,000+ students across Nigeria using Akoro to learn by teaching.</p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => navigate('/signup')}
              style={{ background: '#fff', color: B, padding: '14px 28px', borderRadius: 12, fontSize: 15, fontWeight: 800, border: 'none', cursor: 'pointer', fontFamily: "'Nunito', sans-serif" }}>
              Get started free →
            </button>
            <button onClick={() => navigate('/careers')}
              style={{ background: 'rgba(255,255,255,.15)', color: '#fff', padding: '14px 28px', borderRadius: 12, fontSize: 15, fontWeight: 700, border: '1.5px solid rgba(255,255,255,.35)', cursor: 'pointer' }}>
              Join our team
            </button>
          </div>
        </div>

        {/* Footer mini */}
        <div style={{ background: '#F5F2EC', padding: '24px', textAlign: 'center', borderTop: '1px solid #E2DDD6' }}>
          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            {[['/', 'Home'], ['/privacy', 'Privacy'], ['/terms', 'Terms'], ['/contact', 'Contact'], ['/careers', 'Careers']].map(([href, label]) => (
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
