import { useNavigate } from 'react-router-dom';
import AkoroLogo from '../components/common/AkoroLogo.jsx';
import {
  Brain, Globe, FlaskConical, School, Eye, Scale,
  Check, Sparkles, Repeat, ArrowRight,
} from 'lucide-react';

const B      = '#6C3BFF';
const B2     = '#4C1DCC';
const INK    = '#0F0A1E';
const TEXT   = '#3F3A52';
const MUTED  = '#7A7588';
const BORDER = '#ECEAF4';
const SURFACE = '#FAFAFB';
const TINT   = '#F6F4FF';

const TEAM = [
  { name: 'Sonny Amobi', role: 'Co-Founder & CEO', emoji: '👨🏿‍💻', bio: 'Former classroom teacher turned technologist. Spent 6 years teaching secondary school maths before building the tools he wished he\'d had.' },
  { name: 'Nana Esumai', role: 'Head of AI & Research', emoji: '🧠', bio: 'PhD in Cognitive Science from the University of Lagos. Pioneered the bidirectional teaching model that sits at the heart of Akoro\'s learning engine.' },
  { name: 'Temi Oladele', role: 'Co-Founder & CTO', emoji: '👩🏽‍💻', bio: 'Full-stack engineer with a decade in EdTech. Built scalable learning infrastructure for over 500,000 students across West Africa before joining Akoro.' },
  { name: 'Chidi Nwosu', role: 'Head of Product', emoji: '🎨', bio: 'Obsessed with the student experience. Formerly at Andela and Coursera Africa. Leads every design decision from the student\'s desk, not a boardroom.' },
  { name: 'Adaeze Ibe', role: 'Head of Partnerships', emoji: '🤝', bio: 'Spent 8 years in the Nigerian education sector building school networks. Now brings Akoro into classrooms across 12 states and counting.' },
  { name: 'Kwame Asante', role: 'Lead AI Engineer', emoji: '⚡', bio: 'Former ML engineer at Google Research Africa. Leads the development of Akoro\'s knowledge decay engine and spaced-repetition models.' },
];

const VALUES = [
  { Icon: Brain, title: 'Learning by teaching', desc: 'The most powerful way to learn anything is to explain it. We built a platform around that truth, not around passive video.' },
  { Icon: Globe, title: 'Built for Africa', desc: 'Nigeria first, Africa always. Our AI is aligned to WAEC, NECO, and JAMB curricula. We work offline. We price for our market.' },
  { Icon: FlaskConical, title: 'Science-backed', desc: 'Everything we build is grounded in cognitive science — spaced repetition, retrieval practice, the protégé effect. Not marketing, methods.' },
  { Icon: School, title: 'Teacher partnership', desc: 'We amplify great teachers; we don\'t replace them. NaNa Esumai is a guide, not a substitute for human expertise and relationship.' },
  { Icon: Eye, title: 'Radical transparency', desc: 'Students see exactly what their agent knows and where it is weak. Parents and teachers see the same. No black boxes.' },
  { Icon: Scale, title: 'Equity of access', desc: 'Outstanding education should not depend on postcode or income. We offer offline access, affordable pricing, and school partnerships to make that real.' },
];

const MILESTONES = [
  { year: '2021', title: 'The idea', desc: 'Sonny, frustrated by how quickly students forget what they\'ve just been taught, starts research into the protégé effect in Nigerian classrooms.' },
  { year: '2022', title: 'First prototype', desc: 'A simple chat interface where students explain concepts to a basic AI. Early tests show 3× better retention after just 4 weeks.' },
  { year: '2023', title: 'Akoro is born', desc: 'Akoro Technologies Ltd is incorporated in Lagos. NaNa Esumai and Sargeant are named. First 50 schools onboarded in a pilot programme.' },
  { year: '2024', title: 'Platform launch', desc: 'Full learner and instructor platforms launch. Agent battles, live classes, and the spaced-repetition engine ship. 40,000 students in the first six months.' },
  { year: '2025', title: 'Scaling Africa', desc: 'Expanding to Ghana, Kenya, and South Africa. AI models aligned to local curricula. Partnerships with ministry of education pilots underway.' },
];

const EYEBROW = {
  fontSize: 11, fontWeight: 700, color: B, letterSpacing: '0.14em',
  textTransform: 'uppercase', fontFamily: "'DM Sans', sans-serif",
};
const HEADING = (size = 'clamp(24px,4vw,48px)') => ({
  fontSize: size, fontWeight: 900, color: INK, lineHeight: 1.15,
  fontFamily: "'Nunito', sans-serif", letterSpacing: '-0.01em',
});
const CARD = {
  border: `1px solid ${BORDER}`,
  boxShadow: '0 1px 2px rgba(16,10,30,.04)',
};

export default function AboutPage() {
  const navigate = useNavigate();

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=DM+Sans:wght@400;500;600;700&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'DM Sans',sans-serif;background:#fff;-webkit-font-smoothing:antialiased}

        .about-split{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
        @media(max-width:820px){.about-split{grid-template-columns:1fr;gap:32px}}

        @media(max-width:560px){
          .about-nav{padding:12px 16px}
          .about-nav-sec{display:none}
        }

        .about-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}

        .about-card{transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
        .about-card:hover{transform:translateY(-4px);box-shadow:0 14px 32px rgba(108,59,255,.10)!important;border-color:${B}33}

        .about-foot-link{transition:color .15s ease}
        .about-foot-link:hover{color:${B}!important}

        .about-timeline-line{left:56px}
        @media(max-width:560px){
          .about-timeline-line{left:34px}
          .about-tl-row{gap:14px!important}
          .about-tl-year{width:32px!important;font-size:11px!important}
        }
      `}</style>

      <div style={{ minHeight: '100vh', background: '#fff', fontFamily: "'DM Sans', sans-serif" }}>

        {/* Nav */}
        <div className="about-nav" style={{ background: 'rgba(255,255,255,.85)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderBottom: `1px solid ${BORDER}`, padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 14, position: 'sticky', top: 0, zIndex: 200 }}>
          <button onClick={() => navigate('/')}
            style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer' }}>
            <AkoroLogo size={32} radius={9} />
            <span style={{ fontSize: 18, fontWeight: 800, color: INK, fontFamily: "'Nunito', sans-serif", letterSpacing: '-0.01em' }}>Akoro</span>
          </button>
          <div style={{ flex: 1 }} />
          <button className="about-nav-sec" onClick={() => navigate('/contact')}
            style={{ background: 'none', border: `1px solid ${BORDER}`, cursor: 'pointer', color: TEXT, padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
            Contact us
          </button>
          <button onClick={() => navigate('/careers')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: B, border: 'none', cursor: 'pointer', color: '#fff', padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: "'DM Sans', sans-serif", boxShadow: '0 2px 8px rgba(108,59,255,.25)' }}>
            We're hiring <ArrowRight size={15} strokeWidth={2.5} />
          </button>
        </div>

        {/* Hero */}
        <div style={{ background: `linear-gradient(135deg, ${B} 0%, ${B2} 100%)`, padding: 'clamp(56px,8vw,96px) 20px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'relative', maxWidth: 760, margin: '0 auto' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.28)', borderRadius: 999, padding: '7px 16px', marginBottom: 24 }}>
              <Sparkles size={14} color="#fff" strokeWidth={2.2} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.14em', textTransform: 'uppercase' }}>Our Story</span>
            </div>
            <h1 style={{ ...HEADING('clamp(28px,5vw,52px)'), color: '#fff', marginBottom: 20, maxWidth: 720, marginLeft: 'auto', marginRight: 'auto' }}>
              We're on a mission to make learning actually stick
            </h1>
            <p style={{ fontSize: 'clamp(15px,2vw,18px)', color: 'rgba(255,255,255,.88)', maxWidth: 560, margin: '0 auto 40px', lineHeight: 1.75 }}>
              Akoro is an AI-powered learning platform built in Lagos, Nigeria — designed around the science of how the human brain actually retains information.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              {[['40,000+', 'Students learning'],['500+', 'Schools onboarded'],['12', 'States reached'],['89%', 'Retention rate']].map(([stat, label]) => (
                <div key={label} style={{ background: 'rgba(255,255,255,.10)', border: '1px solid rgba(255,255,255,.18)', borderRadius: 14, padding: '14px 22px', textAlign: 'center', minWidth: 104, backdropFilter: 'blur(4px)' }}>
                  <div style={{ fontSize: 26, fontWeight: 900, color: '#fff', fontFamily: "'Nunito', sans-serif", lineHeight: 1.1 }}>{stat}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.78)', fontWeight: 600, marginTop: 4 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Mission section */}
        <div style={{ maxWidth: 1040, margin: '0 auto', padding: 'clamp(48px,6vw,80px) 20px' }}>
          <div className="about-split">
            <div>
              <div style={{ ...EYEBROW, marginBottom: 14 }}>Why We Exist</div>
              <h2 style={{ ...HEADING('clamp(24px,3.4vw,34px)'), marginBottom: 18, lineHeight: 1.22 }}>Students forget 80% of what they learn within a week. We built Akoro to fix that.</h2>
              <p style={{ fontSize: 15, color: TEXT, lineHeight: 1.75, marginBottom: 16 }}>
                The forgetting curve is one of the most well-documented findings in cognitive science — and one of the most ignored in how we actually teach. Passive watching, note-taking, re-reading: they feel productive but they don't work.
              </p>
              <p style={{ fontSize: 15, color: TEXT, lineHeight: 1.75, marginBottom: 28 }}>
                The protégé effect — where you learn deeply by teaching someone else — is one of the most powerful techniques we know. Akoro puts that at the centre of every learning session, powered by AI, available to every student with a phone.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {['Built by former teachers, not just engineers','Curriculum-aligned to WAEC, NECO, and JAMB','Offline-first for real African infrastructure','Priced for schools, not Silicon Valley'].map(p => (
                  <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: TINT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Check size={13} color={B} strokeWidth={3} />
                    </div>
                    <span style={{ fontSize: 14.5, color: INK, fontWeight: 500 }}>{p}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: TINT, borderRadius: 20, padding: '28px 26px', border: `1px solid ${BORDER}`, borderLeft: `4px solid ${B}` }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: `${B}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                  <Brain size={22} color={B} strokeWidth={2} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: INK, marginBottom: 8, fontFamily: "'Nunito', sans-serif" }}>The Protégé Effect</div>
                <p style={{ fontSize: 14, color: TEXT, lineHeight: 1.75 }}>Students who teach a concept to someone else retain up to 89% of it after a week — versus 17% from passive video viewing.</p>
              </div>
              <div style={{ background: '#FFF7ED', borderRadius: 20, padding: '28px 26px', border: '1px solid #FBE3C2', borderLeft: '4px solid #F59E0B' }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(245,158,11,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                  <Repeat size={22} color="#D97706" strokeWidth={2} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: INK, marginBottom: 8, fontFamily: "'Nunito', sans-serif" }}>Spaced Repetition</div>
                <p style={{ fontSize: 14, color: TEXT, lineHeight: 1.75 }}>Sargeant tracks every concept and resurfaces it at exactly the right moment — before the knowledge fades. Science, not guesswork.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Values */}
        <div style={{ background: SURFACE, borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}`, padding: 'clamp(48px,6vw,80px) 20px' }}>
          <div style={{ maxWidth: 1040, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
              <div style={{ ...EYEBROW, marginBottom: 12 }}>What We Stand For</div>
              <h2 style={HEADING('clamp(24px,3.5vw,40px)')}>Our values</h2>
            </div>
            <div className="about-grid">
              {VALUES.map(({ Icon, title, desc }) => (
                <div key={title} className="about-card" style={{ background: '#fff', borderRadius: 18, padding: '26px 24px', ...CARD }}>
                  <div style={{ width: 46, height: 46, borderRadius: 13, background: TINT, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                    <Icon size={22} color={B} strokeWidth={2} />
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: INK, marginBottom: 8, fontFamily: "'Nunito', sans-serif" }}>{title}</div>
                  <p style={{ fontSize: 14, color: TEXT, lineHeight: 1.75 }}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(48px,6vw,80px) 20px' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{ ...EYEBROW, marginBottom: 12 }}>How We Got Here</div>
            <h2 style={HEADING('clamp(24px,3.5vw,40px)')}>Our journey</h2>
          </div>
          <div style={{ position: 'relative' }}>
            <div className="about-timeline-line" style={{ position: 'absolute', top: 6, bottom: 6, width: 2, background: `linear-gradient(to bottom, ${B}, ${B}1A)` }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
              {MILESTONES.map(({ year, title, desc }) => (
                <div key={year} className="about-tl-row" style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
                  <div className="about-tl-year" style={{ flexShrink: 0, width: 48, textAlign: 'right', paddingTop: 1 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: B, fontFamily: "'Nunito', sans-serif" }}>{year}</span>
                  </div>
                  <div style={{ position: 'relative', flexShrink: 0, marginTop: 3 }}>
                    <div style={{ width: 16, height: 16, borderRadius: '50%', background: B, border: '3px solid #fff', boxShadow: `0 0 0 3px ${B}30` }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: INK, marginBottom: 6, fontFamily: "'Nunito', sans-serif" }}>{title}</div>
                    <p style={{ fontSize: 14, color: TEXT, lineHeight: 1.75 }}>{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Team */}
        <div style={{ background: SURFACE, borderTop: `1px solid ${BORDER}`, padding: 'clamp(48px,6vw,80px) 20px' }}>
          <div style={{ maxWidth: 1040, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
              <div style={{ ...EYEBROW, marginBottom: 12 }}>The People</div>
              <h2 style={HEADING('clamp(24px,3.5vw,40px)')}>Meet the team</h2>
              <p style={{ fontSize: 15, color: TEXT, lineHeight: 1.75, maxWidth: 520, margin: '14px auto 0' }}>Former teachers, engineers, scientists, and operators — united by a belief that every student deserves tools that actually work.</p>
            </div>
            <div className="about-grid">
              {TEAM.map(({ name, role, emoji, bio }) => (
                <div key={name} className="about-card"
                  style={{ background: '#fff', borderRadius: 18, padding: '28px 24px', ...CARD }}>
                  <div style={{ width: 56, height: 56, borderRadius: 16, background: TINT, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 16 }}>{emoji}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: INK, fontFamily: "'Nunito', sans-serif" }}>{name}</div>
                  <div style={{ fontSize: 12, color: B, fontWeight: 700, marginBottom: 12, marginTop: 3, letterSpacing: '0.01em' }}>{role}</div>
                  <p style={{ fontSize: 14, color: TEXT, lineHeight: 1.75 }}>{bio}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div style={{ background: `linear-gradient(135deg, ${B} 0%, ${B2} 100%)`, padding: 'clamp(48px,6vw,80px) 20px', textAlign: 'center' }}>
          <div style={{ maxWidth: 640, margin: '0 auto' }}>
            <h2 style={{ ...HEADING('clamp(24px,3.5vw,40px)'), color: '#fff', marginBottom: 16 }}>Ready to actually remember what you learn?</h2>
            <p style={{ fontSize: 16, color: 'rgba(255,255,255,.85)', marginBottom: 32, maxWidth: 480, margin: '0 auto 32px', lineHeight: 1.7 }}>Join 40,000+ students across Nigeria using Akoro to learn by teaching.</p>
            <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => navigate('/signup')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', color: B, padding: '14px 28px', borderRadius: 12, fontSize: 15, fontWeight: 800, border: 'none', cursor: 'pointer', fontFamily: "'Nunito', sans-serif", boxShadow: '0 6px 18px rgba(16,10,30,.18)' }}>
                Get started free <ArrowRight size={17} strokeWidth={2.5} />
              </button>
              <button onClick={() => navigate('/careers')}
                style={{ background: 'rgba(255,255,255,.12)', color: '#fff', padding: '14px 28px', borderRadius: 12, fontSize: 15, fontWeight: 700, border: '1.5px solid rgba(255,255,255,.35)', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                Join our team
              </button>
            </div>
          </div>
        </div>

        {/* Footer mini */}
        <div style={{ background: '#fff', padding: '28px 20px', textAlign: 'center', borderTop: `1px solid ${BORDER}` }}>
          <div style={{ display: 'flex', gap: 22, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            {[['/', 'Home'], ['/privacy', 'Privacy'], ['/terms', 'Terms'], ['/contact', 'Contact'], ['/careers', 'Careers']].map(([href, label]) => (
              <a key={label} href={href} className="about-foot-link" style={{ fontSize: 13.5, color: MUTED, textDecoration: 'none', fontWeight: 600 }}>{label}</a>
            ))}
          </div>
          <p style={{ fontSize: 12.5, color: MUTED }}>© 2025 Akoro Technologies Ltd. All rights reserved.</p>
        </div>
      </div>
    </>
  );
}
