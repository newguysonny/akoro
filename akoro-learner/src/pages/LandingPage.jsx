import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const BRAND  = '#6C3BFF';
const BRAND2 = '#4C1DCC';
const GREEN  = '#10B981';
const GOLD   = '#F59E0B';
const RED    = '#EF4444';

/* ── tiny helpers ── */
const px = (n) => `${n}px`;

function useInView(threshold = 0.15) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, visible];
}

function AnimBlock({ children, delay = 0, style = {} }) {
  const [ref, vis] = useInView();
  return (
    <div ref={ref} style={{
      opacity: vis ? 1 : 0,
      transform: vis ? 'translateY(0)' : 'translateY(32px)',
      transition: `opacity .6s ease ${delay}s, transform .6s ease ${delay}s`,
      ...style,
    }}>
      {children}
    </div>
  );
}

/* ── Section wrapper ── */
function Section({ id, children, bg = 'transparent', style = {} }) {
  return (
    <section id={id} style={{ background: bg, width: '100%', padding: '96px 24px', boxSizing: 'border-box', ...style }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>{children}</div>
    </section>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: `${BRAND}12`, border: `1px solid ${BRAND}30`, borderRadius: 99, padding: '5px 14px', marginBottom: 16 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: BRAND }} />
      <span style={{ fontSize: 11, fontWeight: 800, color: BRAND, letterSpacing: 1, textTransform: 'uppercase' }}>{children}</span>
    </div>
  );
}

function SectionHeading({ children, sub, center = false }) {
  return (
    <div style={{ textAlign: center ? 'center' : 'left', marginBottom: 56 }}>
      <h2 style={{ fontSize: 'clamp(28px,4vw,44px)', fontWeight: 900, color: '#0D0A1E', lineHeight: 1.15, margin: '0 0 14px' }}>{children}</h2>
      {sub && <p style={{ fontSize: 17, color: '#6B7280', fontWeight: 600, maxWidth: 580, margin: center ? '0 auto' : 0, lineHeight: 1.6 }}>{sub}</p>}
    </div>
  );
}

/* ─────────────────────────────── NAV ─────────────────────────────── */
function Navbar({ onSignin, onSignup }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', fn);
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const links = [
    { href: '#features', label: 'Features' },
    { href: '#how', label: 'How it works' },
    { href: '#pricing', label: 'Pricing' },
    { href: '#faq', label: 'FAQ' },
  ];

  const scrollTo = (e, href) => {
    e.preventDefault();
    document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' });
    setMenuOpen(false);
  };

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 900,
      background: scrolled ? 'rgba(255,255,255,.95)' : 'transparent',
      backdropFilter: scrolled ? 'blur(12px)' : 'none',
      borderBottom: scrolled ? '1px solid #F3F4F6' : 'none',
      transition: 'all .3s ease',
      padding: '0 24px',
    }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', height: 68, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg,${BRAND},${BRAND2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🧠</div>
          <span style={{ fontSize: 20, fontWeight: 900, color: '#0D0A1E', letterSpacing: -.3 }}>Akoro</span>
        </div>

        {/* Desktop links */}
        <div style={{ display: 'flex', gap: 32, alignItems: 'center' }} className="nav-links-desktop">
          {links.map(l => (
            <a key={l.href} href={l.href} onClick={e => scrollTo(e, l.href)}
              style={{ fontSize: 14, fontWeight: 700, color: '#374151', textDecoration: 'none', transition: 'color .2s' }}
              onMouseEnter={e => e.target.style.color = BRAND}
              onMouseLeave={e => e.target.style.color = '#374151'}>
              {l.label}
            </a>
          ))}
        </div>

        {/* CTA */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={onSignin} style={{ padding: '9px 20px', borderRadius: 10, border: '1.5px solid #E5E7EB', background: '#fff', fontSize: 13, fontWeight: 800, color: '#374151', cursor: 'pointer', fontFamily: 'inherit' }}>
            Sign in
          </button>
          <button onClick={onSignup} style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${BRAND},${BRAND2})`, fontSize: 13, fontWeight: 800, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', boxShadow: `0 4px 14px ${BRAND}40` }}>
            Get started free
          </button>
        </div>
      </div>
    </nav>
  );
}

/* ─────────────────────────────── HERO ─────────────────────────────── */
function Hero({ onLearner, onInstructor }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(160deg,#F5F3FF 0%,#EEF2FF 40%,#F0FDF4 100%)',
      padding: '120px 24px 80px', textAlign: 'center', position: 'relative', overflow: 'hidden',
    }}>
      {/* Background orbs */}
      <div style={{ position: 'absolute', width: 600, height: 600, borderRadius: '50%', background: `radial-gradient(circle,${BRAND}18 0%,transparent 70%)`, top: -200, right: -200, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', width: 400, height: 400, borderRadius: '50%', background: `radial-gradient(circle,${GREEN}14 0%,transparent 70%)`, bottom: -100, left: -100, pointerEvents: 'none' }} />

      <div style={{ maxWidth: 780, position: 'relative', zIndex: 1 }}>
        {/* Badge */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: `${BRAND}12`, border: `1px solid ${BRAND}30`, borderRadius: 99, padding: '6px 16px', marginBottom: 28 }}>
          <span style={{ fontSize: 14 }}>🚀</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: BRAND, letterSpacing: .5 }}>AI-Powered Learning Platform</span>
        </div>

        <h1 style={{ fontSize: 'clamp(36px,6vw,68px)', fontWeight: 900, color: '#0D0A1E', lineHeight: 1.1, margin: '0 0 22px', letterSpacing: -1.5 }}>
          Learn by teaching.<br />
          <span style={{ background: `linear-gradient(135deg,${BRAND},${GREEN})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            Your AI agent learns too.
          </span>
        </h1>

        <p style={{ fontSize: 'clamp(16px,2vw,20px)', color: '#6B7280', fontWeight: 600, lineHeight: 1.7, maxWidth: 560, margin: '0 auto 40px' }}>
          Akoro flips the classroom — students teach AI agents, battle peers, and build deep mastery through active recall and spaced repetition.
        </p>

        {/* CTA buttons */}
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 56 }}>
          <button onClick={onLearner} style={{ padding: '16px 32px', borderRadius: 14, border: 'none', background: `linear-gradient(135deg,${BRAND},${BRAND2})`, fontSize: 15, fontWeight: 800, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', boxShadow: `0 8px 24px ${BRAND}40`, display: 'flex', alignItems: 'center', gap: 8 }}>
            🎓 Learner Login
          </button>
          <button onClick={onInstructor} style={{ padding: '16px 32px', borderRadius: 14, border: `2px solid ${BRAND}`, background: '#fff', fontSize: 15, fontWeight: 800, color: BRAND, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8 }}>
            🏫 Instructor Login
          </button>
        </div>

        {/* Social proof */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 20 }}>
          {['👩🏾‍🎓','👨🏻‍🎓','👩🏽‍🎓','👨🏿‍🎓','👩🏼‍🎓'].map((e, i) => (
            <div key={i} style={{ width: 36, height: 36, borderRadius: '50%', background: `${BRAND}15`, border: '2px solid #fff', marginLeft: i ? -10 : 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, boxShadow: '0 2px 8px rgba(0,0,0,.1)', zIndex: 5 - i }}>
              {e}
            </div>
          ))}
          <span style={{ fontSize: 13, fontWeight: 700, color: '#6B7280', marginLeft: 8 }}>
            Trusted by <strong style={{ color: '#0D0A1E' }}>12,000+</strong> students across Africa
          </span>
        </div>

        {/* Stars */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          {'★★★★★'.split('').map((s, i) => <span key={i} style={{ fontSize: 18, color: GOLD }}>{s}</span>)}
          <span style={{ fontSize: 13, fontWeight: 700, color: '#9CA3AF', marginLeft: 6 }}>4.9 / 5 from 850 reviews</span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── STATS ─────────────────────────────── */
const STATS = [
  { value: '12,400+', label: 'Active Learners',   icon: '🎓', color: BRAND },
  { value: '94%',     label: 'Pass Rate Improvement', icon: '📈', color: GREEN },
  { value: '3.2×',    label: 'Faster Retention',  icon: '⚡', color: GOLD },
  { value: '48',      label: 'Schools Onboarded', icon: '🏫', color: '#0EA5E9' },
];

function Stats() {
  return (
    <Section bg="#0D0A1E">
      <AnimBlock>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 2 }}>
          {STATS.map((s, i) => (
            <AnimBlock key={s.label} delay={i * 0.1}>
              <div style={{ textAlign: 'center', padding: '40px 24px' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>{s.icon}</div>
                <div style={{ fontSize: 'clamp(32px,4vw,48px)', fontWeight: 900, color: s.color, letterSpacing: -1, marginBottom: 8 }}>{s.value}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,.6)', lineHeight: 1.4 }}>{s.label}</div>
              </div>
            </AnimBlock>
          ))}
        </div>
      </AnimBlock>
    </Section>
  );
}

/* ─────────────────────────────── FEATURES ─────────────────────────────── */
const FEATURES = [
  { icon: '🧠', title: 'Teach to Learn', desc: 'Students explain concepts to NaNa, their AI agent. The act of teaching forces deep understanding and exposes hidden gaps.', color: BRAND },
  { icon: '⚔️', title: 'Battle Mode', desc: 'Peer-to-peer AI battles where agents compete on knowledge. Immediate or scheduled — gamified learning at its best.', color: RED },
  { icon: '🔁', title: 'Spaced Repetition', desc: 'Smart decay detection flags topics before they fade. Sargeant schedules revision sessions at the perfect moment.', color: GOLD },
  { icon: '📊', title: 'Real-time Analytics', desc: 'Instructors see confidence scores, flagged gaps, and learning velocity across every student in their classroom.', color: GREEN },
  { icon: '🏆', title: 'Live Leaderboards', desc: 'Class, course, and inter-school rankings drive healthy competition and keep engagement high all term.', color: '#0EA5E9' },
  { icon: '🌍', title: '9 Languages', desc: 'English, Yoruba, Igbo, Hausa, Pidgin, French, Spanish, Portuguese, and Arabic — meet learners in their mother tongue.', color: '#8B5CF6' },
];

function Features() {
  return (
    <Section id="features" bg="#FAFAFA">
      <AnimBlock>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <SectionLabel>Features</SectionLabel>
          <SectionHeading center
            sub="Everything a modern edtech platform needs — built specifically for African classrooms.">
            Built for how students<br />actually learn
          </SectionHeading>
        </div>
      </AnimBlock>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 24 }}>
        {FEATURES.map((f, i) => (
          <AnimBlock key={f.title} delay={i * 0.08}>
            <div style={{ background: '#fff', borderRadius: 20, padding: '32px 28px', border: '1px solid #F3F4F6', transition: 'transform .2s,box-shadow .2s', cursor: 'default' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 16px 40px ${f.color}18`; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: `${f.color}12`, border: `1px solid ${f.color}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, marginBottom: 20 }}>
                {f.icon}
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 900, color: '#0D0A1E', margin: '0 0 10px' }}>{f.title}</h3>
              <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.7, margin: 0 }}>{f.desc}</p>
            </div>
          </AnimBlock>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────── HOW IT WORKS ─────────────────────────────── */
const STEPS = [
  { step: '01', icon: '📚', who: 'Learner', title: 'Pick a topic', desc: 'Choose from curriculum subjects or create your own. Set subtopics and learning objectives.' },
  { step: '02', icon: '🧠', who: 'AI Agent', title: 'Teach NaNa', desc: "NaNa listens, asks probing questions, and flags any misconceptions in real time as you teach." },
  { step: '03', icon: '⚡', who: 'Sargeant', title: 'Get assessed', desc: 'Sargeant tests your agent on what you taught. Your confidence score updates after every battle.' },
  { step: '04', icon: '🏆', who: 'Platform', title: 'Rise the ranks', desc: "Climb classroom and inter-school leaderboards. Challenge friends and prove your knowledge." },
];

function HowItWorks() {
  return (
    <Section id="how">
      <AnimBlock>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <SectionLabel>How It Works</SectionLabel>
          <SectionHeading center sub="Four simple steps that turn passive studying into active mastery.">
            From first session to top of class
          </SectionHeading>
        </div>
      </AnimBlock>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 32, position: 'relative' }}>
        {STEPS.map((s, i) => (
          <AnimBlock key={s.step} delay={i * 0.1}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ position: 'relative', display: 'inline-block', marginBottom: 20 }}>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: `linear-gradient(135deg,${BRAND}18,${BRAND}08)`, border: `2px solid ${BRAND}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, margin: '0 auto' }}>
                  {s.icon}
                </div>
                <div style={{ position: 'absolute', top: -4, right: -4, background: `linear-gradient(135deg,${BRAND},${BRAND2})`, color: '#fff', fontSize: 9, fontWeight: 900, borderRadius: 6, padding: '2px 6px', letterSpacing: .5 }}>{s.step}</div>
              </div>
              <div style={{ fontSize: 10, fontWeight: 800, color: BRAND, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, background: `${BRAND}10`, borderRadius: 99, padding: '3px 10px', display: 'inline-block' }}>{s.who}</div>
              <h3 style={{ fontSize: 18, fontWeight: 900, color: '#0D0A1E', margin: '10px 0 8px' }}>{s.title}</h3>
              <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.7, margin: 0 }}>{s.desc}</p>
            </div>
          </AnimBlock>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────── RESULTS ─────────────────────────────── */
const RESULTS = [
  { metric: '94%', detail: 'of students improved their end-of-term scores after 8 weeks on Akoro', icon: '📈', bg: GREEN },
  { metric: '3.2×', detail: 'faster knowledge retention compared to traditional note-taking', icon: '⚡', bg: GOLD },
  { metric: '78%', detail: 'reduction in last-minute cramming for students who use spaced repetition', icon: '🧠', bg: BRAND },
  { metric: '#1', detail: 'rated learning platform by secondary school students in Nigeria 2024', icon: '🏆', bg: RED },
];

function Results() {
  return (
    <Section id="results" bg="linear-gradient(135deg,#0D0A1E,#1A0E3B)">
      <AnimBlock>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <SectionLabel>Results</SectionLabel>
          <SectionHeading center sub="The numbers don't lie. Here's what happens when students teach to learn.">
            <span style={{ color: '#fff' }}>Real outcomes from<br />real classrooms</span>
          </SectionHeading>
        </div>
      </AnimBlock>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 20 }}>
        {RESULTS.map((r, i) => (
          <AnimBlock key={r.metric} delay={i * 0.1}>
            <div style={{ background: 'rgba(255,255,255,.05)', borderRadius: 20, padding: '36px 28px', border: '1px solid rgba(255,255,255,.1)', textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>{r.icon}</div>
              <div style={{ fontSize: 'clamp(40px,5vw,56px)', fontWeight: 900, color: r.bg, letterSpacing: -2, marginBottom: 12 }}>{r.metric}</div>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,.65)', lineHeight: 1.7, margin: 0 }}>{r.detail}</p>
            </div>
          </AnimBlock>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────── REVIEWS ─────────────────────────────── */
const REVIEWS = [
  { name: 'Adaeze O.', role: 'SS3 Student · Lagos', avatar: '👩🏾‍🎓', stars: 5, text: 'Before Akoro I would just read my notes over and over. Now I actually teach my agent and the difference in how much I remember is insane. I topped my class in Chemistry!' },
  { name: 'Mr Emeka T.', role: 'Biology Teacher · Abuja', avatar: '👨🏿‍🏫', stars: 5, text: "I can see exactly where each student is struggling before the exam. The confidence scores save me hours of marking and the students love the battles." },
  { name: 'Chiamaka N.', role: 'JSS2 Student · Enugu', avatar: '👧🏽', stars: 5, text: 'My mum was worried I was playing games but she saw my results and now she\'s the one telling her friends about Akoro. The battle with my friend was so fun!' },
  { name: 'Dr. Sarah K.', role: 'School Principal · Kano', avatar: '👩🏽‍💼', stars: 5, text: "We rolled out Akoro across all science classes. Term 1 pass rate went from 61% to 89%. The inter-school rankings have made every student competitive in the right way." },
  { name: 'Tunde A.', role: 'SS1 Student · Ibadan', avatar: '👦🏿', stars: 5, text: "I failed Maths twice. My agent has a 73% confidence score now and I'm actually enjoying learning for the first time. NaNa never judges me when I get things wrong." },
  { name: 'Mrs Fatima B.', role: 'Maths Teacher · Port Harcourt', avatar: '👩🏾‍🏫', stars: 5, text: 'The spaced repetition feature is what sets Akoro apart. Students come to class having already revised the right things. It has completely changed my teaching rhythm.' },
];

function StarRating({ n = 5 }) {
  return (
    <div style={{ display: 'flex', gap: 3, marginBottom: 12 }}>
      {Array.from({ length: n }).map((_, i) => <span key={i} style={{ fontSize: 14, color: GOLD }}>★</span>)}
    </div>
  );
}

function Reviews() {
  return (
    <Section id="reviews" bg="#FAFAFA">
      <AnimBlock>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <SectionLabel>Reviews</SectionLabel>
          <SectionHeading center sub="From Lagos to Kano — students and teachers are seeing real results.">
            What our community is saying
          </SectionHeading>
        </div>
      </AnimBlock>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 20 }}>
        {REVIEWS.map((r, i) => (
          <AnimBlock key={r.name} delay={i * 0.07}>
            <div style={{ background: '#fff', borderRadius: 20, padding: '28px 24px', border: '1px solid #F3F4F6', height: '100%', display: 'flex', flexDirection: 'column' }}>
              <StarRating n={r.stars} />
              <p style={{ fontSize: 14.5, color: '#374151', lineHeight: 1.75, margin: '0 0 20px', flex: 1, fontStyle: 'italic' }}>"{r.text}"</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: `${BRAND}12`, border: `2px solid ${BRAND}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{r.avatar}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#0D0A1E' }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 600 }}>{r.role}</div>
                </div>
              </div>
            </div>
          </AnimBlock>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────── PRICING ─────────────────────────────── */
const PLANS = [
  {
    name: 'Free',
    price: '₦0',
    period: 'forever',
    desc: 'Perfect for trying Akoro and getting your first sessions in.',
    color: '#6B7280',
    features: ['3 AI teaching sessions/month', '1 AI agent (NaNa)', 'Classroom leaderboard', 'Basic analytics', 'Battle mode (5/month)'],
    cta: 'Get started free',
    highlight: false,
  },
  {
    name: 'Student Pro',
    price: '₦2,500',
    period: 'per month',
    desc: 'Unlimited learning for ambitious students who want to top their class.',
    color: BRAND,
    features: ['Unlimited teaching sessions', 'All 3 AI agents', 'Spaced repetition engine', 'Inter-school rankings', 'Unlimited battles', 'Priority support'],
    cta: 'Start 7-day free trial',
    highlight: true,
    badge: 'Most Popular',
  },
  {
    name: 'Classroom',
    price: '₦18,000',
    period: 'per class / month',
    desc: 'For teachers and schools who want data-driven classrooms.',
    color: GREEN,
    features: ['Up to 40 students', 'Teacher analytics dashboard', 'Custom curriculum setup', 'Live class scheduling', 'Progress reports & exports', 'Dedicated onboarding'],
    cta: 'Book a demo',
    highlight: false,
  },
];

function Pricing() {
  return (
    <Section id="pricing">
      <AnimBlock>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <SectionLabel>Pricing</SectionLabel>
          <SectionHeading center sub="Start for free, scale as you grow. No hidden fees.">
            Simple, transparent pricing
          </SectionHeading>
        </div>
      </AnimBlock>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 24, alignItems: 'start' }}>
        {PLANS.map((p, i) => (
          <AnimBlock key={p.name} delay={i * 0.1}>
            <div style={{
              background: p.highlight ? `linear-gradient(160deg,${BRAND},${BRAND2})` : '#fff',
              borderRadius: 24, padding: '36px 28px',
              border: p.highlight ? 'none' : '1.5px solid #E5E7EB',
              position: 'relative', overflow: 'hidden',
              boxShadow: p.highlight ? `0 20px 60px ${BRAND}35` : 'none',
              transform: p.highlight ? 'scale(1.03)' : 'none',
            }}>
              {p.badge && (
                <div style={{ position: 'absolute', top: 20, right: 20, background: GOLD, color: '#fff', fontSize: 10, fontWeight: 900, borderRadius: 99, padding: '4px 12px', letterSpacing: .5 }}>
                  {p.badge}
                </div>
              )}
              <div style={{ fontSize: 11, fontWeight: 800, color: p.highlight ? 'rgba(255,255,255,.7)' : p.color, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>{p.name}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
                <span style={{ fontSize: 42, fontWeight: 900, color: p.highlight ? '#fff' : '#0D0A1E', letterSpacing: -2 }}>{p.price}</span>
                <span style={{ fontSize: 13, color: p.highlight ? 'rgba(255,255,255,.6)' : '#9CA3AF', fontWeight: 600 }}>/{p.period}</span>
              </div>
              <p style={{ fontSize: 13.5, color: p.highlight ? 'rgba(255,255,255,.75)' : '#6B7280', lineHeight: 1.6, marginBottom: 28 }}>{p.desc}</p>
              <div style={{ marginBottom: 28 }}>
                {p.features.map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: p.highlight ? 'rgba(255,255,255,.2)' : `${p.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 10, color: p.highlight ? '#fff' : p.color }}>✓</span>
                    </div>
                    <span style={{ fontSize: 13.5, color: p.highlight ? 'rgba(255,255,255,.85)' : '#374151', fontWeight: 600 }}>{f}</span>
                  </div>
                ))}
              </div>
              <button style={{ width: '100%', padding: '14px', borderRadius: 12, border: p.highlight ? '2px solid rgba(255,255,255,.4)' : `2px solid ${p.color}`, background: p.highlight ? 'rgba(255,255,255,.15)' : p.color === '#6B7280' ? '#F9FAFB' : `${p.color}10`, fontSize: 14, fontWeight: 800, color: p.highlight ? '#fff' : p.color, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .2s' }}
                onMouseEnter={e => { e.currentTarget.style.background = p.highlight ? 'rgba(255,255,255,.25)' : p.color; e.currentTarget.style.color = p.highlight ? '#fff' : '#fff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = p.highlight ? 'rgba(255,255,255,.15)' : p.color === '#6B7280' ? '#F9FAFB' : `${p.color}10`; e.currentTarget.style.color = p.highlight ? '#fff' : p.color; }}>
                {p.cta}
              </button>
            </div>
          </AnimBlock>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────── INSTRUCTORS ─────────────────────────────── */
const INSTRUCTORS = [
  { name: 'Dr. Amara Okonkwo', subject: 'Biology & Life Sciences', school: 'King\'s College Lagos', avatar: '👩🏾‍🔬', students: 124, rating: 4.9, badge: 'Top Educator' },
  { name: 'Mr. Ibrahim Musa', subject: 'Mathematics', school: 'Government College Kano', avatar: '👨🏿‍🏫', students: 98, rating: 4.8, badge: 'STEM Champion' },
  { name: 'Mrs. Ngozi Eze', subject: 'English Language', school: 'Queen\'s School Enugu', avatar: '👩🏽‍🏫', students: 156, rating: 5.0, badge: 'Most Reviewed' },
  { name: 'Mr. Seun Adewale', subject: 'Chemistry & Physics', school: 'Baptist High School Ibadan', avatar: '👨🏾‍🔬', students: 87, rating: 4.7, badge: 'Rising Star' },
];

function Instructors() {
  return (
    <Section id="instructors" bg="#FAFAFA">
      <AnimBlock>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <SectionLabel>Instructors</SectionLabel>
          <SectionHeading center sub="Nigeria's top educators are already on Akoro. Join thousands of teachers transforming their classrooms.">
            Meet our top instructors
          </SectionHeading>
        </div>
      </AnimBlock>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 20 }}>
        {INSTRUCTORS.map((inst, i) => (
          <AnimBlock key={inst.name} delay={i * 0.1}>
            <div style={{ background: '#fff', borderRadius: 20, padding: '32px 24px', border: '1px solid #F3F4F6', textAlign: 'center' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: `${BRAND}12`, border: `3px solid ${BRAND}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto 16px' }}>{inst.avatar}</div>
              <div style={{ fontSize: 9, fontWeight: 900, color: GOLD, letterSpacing: 1, background: `${GOLD}15`, borderRadius: 99, padding: '3px 10px', display: 'inline-block', marginBottom: 10 }}>{inst.badge}</div>
              <h3 style={{ fontSize: 16, fontWeight: 900, color: '#0D0A1E', margin: '8px 0 4px' }}>{inst.name}</h3>
              <p style={{ fontSize: 12.5, color: BRAND, fontWeight: 700, margin: '0 0 4px' }}>{inst.subject}</p>
              <p style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 600, margin: '0 0 16px' }}>{inst.school}</p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 20 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#0D0A1E' }}>{inst.students}</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600 }}>Students</div>
                </div>
                <div style={{ width: 1, background: '#F3F4F6' }} />
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: GOLD }}>{'★'} {inst.rating}</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600 }}>Rating</div>
                </div>
              </div>
            </div>
          </AnimBlock>
        ))}
      </div>
      <AnimBlock delay={0.3}>
        <div style={{ textAlign: 'center', marginTop: 48 }}>
          <p style={{ fontSize: 15, color: '#6B7280', fontWeight: 600, marginBottom: 20 }}>Are you an educator? Join our growing community of instructors.</p>
          <button style={{ padding: '14px 32px', borderRadius: 12, border: `2px solid ${BRAND}`, background: 'transparent', fontSize: 14, fontWeight: 800, color: BRAND, cursor: 'pointer', fontFamily: 'inherit' }}>
            Apply as an Instructor →
          </button>
        </div>
      </AnimBlock>
    </Section>
  );
}

/* ─────────────────────────────── FAQ ─────────────────────────────── */
const FAQS = [
  { q: 'How is Akoro different from other tutoring apps?', a: "Most apps test passive knowledge. Akoro uses the Feynman technique — you teach an AI agent, which forces you to confront what you don't actually understand. Combined with peer battles and spaced repetition, it's the closest thing to a personal tutor for every student." },
  { q: 'What age group is Akoro designed for?', a: 'Akoro is optimised for JSS1 through SS3 (ages 10–18) following the Nigerian secondary school curriculum, but works for any learner who wants to master a subject by teaching it.' },
  { q: 'Can a school deploy Akoro for an entire class?', a: 'Yes. Our Classroom plan supports up to 40 students per class. The teacher gets a dedicated analytics dashboard, can set curriculum topics, and schedule live class sessions. Contact us for multi-class or whole-school pricing.' },
  { q: 'Is my data safe? What about student privacy?', a: "We take privacy seriously. All data is encrypted at rest and in transit. We never sell user data. Student accounts require parental consent for under-13s and comply with Nigerian data protection regulations." },
  { q: 'Do I need internet to use Akoro?', a: "The teaching and chat flows require an internet connection for the AI. However, session history, leaderboards, and revision flashcards can be accessed offline once loaded." },
  { q: 'What subjects are available?', a: "Currently Maths, English, Biology, Chemistry, and Physics follow the WAEC/NECO syllabus. We're adding Economics, Government, and Further Maths in Q3 2025. Instructors can also create custom topics for any subject." },
];

function FAQItem({ q, a, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid #F3F4F6' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '22px 0', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: '#0D0A1E' }}>{q}</span>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: open ? `${BRAND}12` : '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .2s' }}>
          <span style={{ fontSize: 14, color: open ? BRAND : '#9CA3AF', transform: open ? 'rotate(45deg)' : 'none', display: 'block', transition: 'transform .2s' }}>+</span>
        </div>
      </button>
      {open && (
        <p style={{ fontSize: 14.5, color: '#6B7280', lineHeight: 1.75, margin: '0 0 20px', paddingRight: 44 }}>{a}</p>
      )}
    </div>
  );
}

function FAQ() {
  return (
    <Section id="faq">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, alignItems: 'start' }}>
        <AnimBlock>
          <SectionLabel>FAQ</SectionLabel>
          <SectionHeading sub="Can't find your answer? Reach us at hello@akoro.app">
            Frequently asked questions
          </SectionHeading>
          <div style={{ background: `linear-gradient(135deg,${BRAND}08,${BRAND}04)`, border: `1px solid ${BRAND}20`, borderRadius: 16, padding: '24px 20px' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>💬</div>
            <h4 style={{ fontSize: 16, fontWeight: 900, color: '#0D0A1E', margin: '0 0 8px' }}>Still have questions?</h4>
            <p style={{ fontSize: 13.5, color: '#6B7280', margin: '0 0 16px', lineHeight: 1.6 }}>Our team replies within 24 hours on school days.</p>
            <button style={{ padding: '11px 20px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${BRAND},${BRAND2})`, fontSize: 13, fontWeight: 800, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
              Contact Support →
            </button>
          </div>
        </AnimBlock>
        <AnimBlock delay={0.1}>
          <div>
            {FAQS.map((f, i) => <FAQItem key={f.q} q={f.q} a={f.a} defaultOpen={i === 0} />)}
          </div>
        </AnimBlock>
      </div>
    </Section>
  );
}

/* ─────────────────────────────── CTA BANNER ─────────────────────────────── */
function CTABanner({ onLearner, onInstructor }) {
  return (
    <Section bg="linear-gradient(135deg,#0D0A1E,#1A0E3B)" style={{ padding: '80px 24px' }}>
      <AnimBlock>
        <div style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🚀</div>
          <h2 style={{ fontSize: 'clamp(28px,4vw,44px)', fontWeight: 900, color: '#fff', margin: '0 0 16px', lineHeight: 1.15 }}>
            Ready to transform how<br />you learn?
          </h2>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,.65)', fontWeight: 600, lineHeight: 1.6, marginBottom: 36 }}>
            Join 12,000+ students and teachers already using Akoro to build real, lasting knowledge.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={onLearner} style={{ padding: '16px 32px', borderRadius: 14, border: 'none', background: `linear-gradient(135deg,${BRAND},${BRAND2})`, fontSize: 15, fontWeight: 800, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', boxShadow: `0 8px 24px ${BRAND}50` }}>
              🎓 Learner Login
            </button>
            <button onClick={onInstructor} style={{ padding: '16px 32px', borderRadius: 14, border: '2px solid rgba(255,255,255,.3)', background: 'rgba(255,255,255,.08)', fontSize: 15, fontWeight: 800, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
              🏫 Instructor Login
            </button>
          </div>
        </div>
      </AnimBlock>
    </Section>
  );
}

/* ─────────────────────────────── FOOTER ─────────────────────────────── */
function Footer() {
  const cols = [
    { heading: 'Product', links: ['Features', 'Pricing', 'Battle Mode', 'Leaderboards', 'Analytics'] },
    { heading: 'For Schools', links: ['Classroom Plan', 'Teacher Dashboard', 'Curriculum Setup', 'Book a Demo', 'Case Studies'] },
    { heading: 'Company', links: ['About Us', 'Blog', 'Careers', 'Press Kit', 'Contact'] },
    { heading: 'Legal', links: ['Privacy Policy', 'Terms of Service', 'Cookie Policy', 'Data Protection'] },
  ];
  return (
    <footer style={{ background: '#0D0A1E', padding: '64px 24px 32px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 48, marginBottom: 64 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg,${BRAND},${BRAND2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🧠</div>
              <span style={{ fontSize: 20, fontWeight: 900, color: '#fff', letterSpacing: -.3 }}>Akoro</span>
            </div>
            <p style={{ fontSize: 13.5, color: 'rgba(255,255,255,.5)', lineHeight: 1.7, margin: '0 0 20px', maxWidth: 260 }}>
              The AI learning platform that turns students into teachers — and teachers into data-driven educators.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              {['𝕏', 'in', 'f', '▶'].map((icon, i) => (
                <div key={i} style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'rgba(255,255,255,.6)', cursor: 'pointer' }}>{icon}</div>
              ))}
            </div>
          </div>
          {cols.map(col => (
            <div key={col.heading}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,.4)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 16 }}>{col.heading}</div>
              {col.links.map(l => (
                <div key={l} style={{ fontSize: 13.5, color: 'rgba(255,255,255,.55)', marginBottom: 10, cursor: 'pointer', fontWeight: 600, transition: 'color .2s' }}
                  onMouseEnter={e => e.target.style.color = '#fff'}
                  onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,.55)'}>
                  {l}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,.35)', fontWeight: 600 }}>© 2025 Akoro Technologies Ltd. All rights reserved.</span>
          <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,.35)', fontWeight: 600 }}>Built with ❤️ for African students</span>
        </div>
      </div>
    </footer>
  );
}

/* ─────────────────────────────── ROOT ─────────────────────────────── */
export default function LandingPage() {
  const navigate = useNavigate();

  const goLearner    = () => navigate('/signin');
  const goInstructor = () => navigate('/signin?role=instructor');

  return (
    <div style={{ fontFamily: "'Nunito',sans-serif", overflowX: 'hidden', background: '#fff', color: '#111827' }}>
      <Navbar onSignin={goLearner} onSignup={() => navigate('/signup')} />
      <Hero        onLearner={goLearner} onInstructor={goInstructor} />
      <Stats />
      <Features />
      <HowItWorks />
      <Results />
      <Reviews />
      <Pricing />
      <Instructors />
      <FAQ />
      <CTABanner   onLearner={goLearner} onInstructor={goInstructor} />
      <Footer />
    </div>
  );
}
