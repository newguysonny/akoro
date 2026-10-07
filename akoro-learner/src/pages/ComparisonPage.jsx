/**
 * ComparisonPage: "Why Akoro" competitive comparison for school buyers.
 * Positions Akoro against website builders, EdTech apps and school-management
 * software, with a head-to-head matrix, differentiator cards, an all-in-one
 * story and CTAs. Uses the shared marketing chrome (SiteNav / SiteFooter).
 */
import { useNavigate, Link } from 'react-router-dom';
import { SiteNav, SiteFooter, Btn } from '../components/SiteChrome.jsx';
import {
  Check, X, Minus, ArrowRight, Globe, Bot, MessageSquare, GraduationCap,
  Wallet, Megaphone, LayoutGrid, Sparkles,
} from 'lucide-react';

const B = '#6C3BFF', B2 = '#4C1DCC', INK = '#0F0A1E', TEXT = '#3F3A52';
const MUTED = '#7A7588', BORDER = '#ECEAF4', SURFACE = '#FAFAFB', TINT = '#F6F4FF';
const G = '#10B981';
const HEAD = "'Nunito', sans-serif", BODY = "'DM Sans', sans-serif";

const EYEBROW = { fontSize: 11, fontWeight: 800, color: B, letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: BODY };
const H = (size = 'clamp(26px,4.4vw,46px)') => ({ fontSize: size, fontWeight: 900, color: INK, lineHeight: 1.12, fontFamily: HEAD, letterSpacing: '-0.02em' });

// Columns: Akoro, Website builders (Wix/local devs), EdTech apps (uLesson/Gradely), School mgmt software (SAFSMS/QuickSchools)
const COLS = ['Akoro', 'Website builders', 'EdTech apps', 'School software'];
const YES = 'yes', NO = 'no', PART = 'part';

const ROWS = [
  ['Branded school website', YES, YES, NO, PART],
  ['Your own 24/7 AI assistant', YES, NO, NO, NO],
  ['After-school AI revision for students', YES, NO, PART, NO],
  ['24/7 WhatsApp agent', YES, NO, NO, PART],
  ['AI admissions & lead capture', YES, NO, NO, NO],
  ['Fee collection in chat', YES, NO, NO, PART],
  ['Teacher lesson-plan generator', YES, NO, PART, NO],
  ['Auto blog + social content', YES, PART, NO, NO],
  ['Attendance & records', YES, NO, NO, YES],
  ['Aligned to WAEC / NECO / JAMB', YES, NO, PART, NO],
  ['Priced for Nigerian schools', YES, PART, YES, PART],
  ['One platform, one login', YES, NO, NO, NO],
];

const COMPARE = [
  {
    icon: Globe, them: 'Generic website builders (Wix, local developers)',
    themLine: 'A pretty page that just sits there, and a developer invoice every time you need a change.',
    us: 'Website + AI agent + school operations in one, that answers parents and revises with students, not just a brochure.',
  },
  {
    icon: GraduationCap, them: 'EdTech apps (uLesson, Gradely)',
    themLine: 'A third-party app with someone else’s brand that parents download once and forget.',
    us: 'Your school’s own branded AI, living on your website and WhatsApp, reinforcing your name every day.',
  },
  {
    icon: LayoutGrid, them: 'School management software (SAFSMS, QuickSchools)',
    themLine: 'Good at record-keeping behind the scenes, but invisible to prospective parents.',
    us: 'We don’t just manage. We market your school and engage parents 24/7, then hand off records too.',
  },
];

const Cell = ({ v, hot }) => {
  if (v === YES) return <span style={{ display: 'inline-flex', width: 26, height: 26, borderRadius: '50%', background: hot ? B : `${G}18`, alignItems: 'center', justifyContent: 'center' }}><Check size={15} color={hot ? '#fff' : G} /></span>;
  if (v === PART) return <Minus size={16} color="#C9A227" />;
  return <X size={15} color="#CFC9DC" />;
};

export default function ComparisonPage() {
  const navigate = useNavigate();

  return (
    <div style={{ background: '#fff', fontFamily: BODY, color: TEXT, minHeight: '100vh' }}>
      <SiteNav />

      {/* ── Hero ── */}
      <section style={{ background: `linear-gradient(180deg,${TINT},#fff)`, padding: 'clamp(48px,7vw,88px) 20px 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <div style={{ ...EYEBROW, marginBottom: 14 }}>Why Akoro</div>
          <h1 style={H()}>Not a website. Not an app. Your school’s whole online presence, with a brain.</h1>
          <p style={{ fontSize: 'clamp(15px,2vw,18px)', color: MUTED, lineHeight: 1.65, maxWidth: 640, margin: '18px auto 0' }}>
            Most tools do one thing. Akoro combines your website, a 24/7 AI assistant, parent engagement,
            admissions and fee collection, built and priced for African schools.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 26 }}>
            <Btn v="primary" sz="lg" onClick={() => navigate('/signup')}>Start free pilot <ArrowRight size={16} /></Btn>
            <Btn v="outline" sz="lg" onClick={() => navigate('/pricing')}>See pricing</Btn>
          </div>
        </div>
      </section>

      {/* ── Head-to-head matrix ── */}
      <section style={{ padding: '20px 16px 44px' }}>
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
          <div style={{ overflowX: 'auto', border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: '0 6px 30px rgba(16,10,30,.05)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640, fontFamily: BODY }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '16px 18px', fontSize: 12.5, fontWeight: 800, color: INK, background: SURFACE }}>Capability</th>
                  {COLS.map((c, i) => (
                    <th key={c} style={{ padding: '16px 12px', fontSize: 12.5, fontWeight: 800, textAlign: 'center', minWidth: 104,
                      color: i === 0 ? '#fff' : INK, background: i === 0 ? `linear-gradient(135deg,${B},${B2})` : SURFACE }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([label, ...vals], r) => (
                  <tr key={r} style={{ borderTop: `1px solid ${BORDER}` }}>
                    <td style={{ padding: '13px 18px', fontSize: 13, color: TEXT, fontWeight: 500 }}>{label}</td>
                    {vals.map((v, i) => (
                      <td key={i} style={{ padding: '13px 12px', textAlign: 'center', background: i === 0 ? TINT : 'transparent' }}>
                        <Cell v={v} hot={i === 0} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 18, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16, fontSize: 12.5, color: MUTED }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Check size={14} color={G} /> Included</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Minus size={14} color="#C9A227" /> Partial / add-on</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><X size={14} color="#CFC9DC" /> Not available</span>
          </div>
        </div>
      </section>

      {/* ── Differentiator cards ── */}
      <section style={{ padding: '20px 16px 44px', background: SURFACE }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', margin: '20px 0 32px' }}>
            <div style={{ ...EYEBROW, marginBottom: 10 }}>How we’re different</div>
            <h2 style={H('clamp(22px,3.2vw,34px)')}>What each option gives you, and what it doesn’t</h2>
          </div>
          <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
            {COMPARE.map((c) => (
              <div key={c.them} style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 18, padding: '24px 22px' }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: TINT, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                  <c.icon size={21} color={B} />
                </div>
                <div style={{ fontSize: 15.5, fontWeight: 800, color: INK, fontFamily: HEAD, marginBottom: 12 }}>{c.them}</div>
                <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: 12 }}>
                  <X size={16} color="#CFC9DC" style={{ flexShrink: 0, marginTop: 2 }} />
                  <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.55, margin: 0 }}>{c.themLine}</p>
                </div>
                <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: TINT, borderRadius: 12, padding: '12px 14px' }}>
                  <Check size={16} color={G} style={{ flexShrink: 0, marginTop: 2 }} />
                  <p style={{ fontSize: 13, color: TEXT, fontWeight: 600, lineHeight: 1.55, margin: 0 }}>{c.us}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── All-in-one story ── */}
      <section style={{ padding: '52px 16px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ ...EYEBROW, marginBottom: 12 }}>One platform</div>
          <h2 style={H('clamp(22px,3.4vw,36px)')}>Replace three vendors with one</h2>
          <p style={{ fontSize: 15.5, color: MUTED, lineHeight: 1.65, maxWidth: 620, margin: '16px auto 34px' }}>
            Stop paying a web developer, an EdTech subscription and a records system separately,
            and stop stitching them together. Akoro is one login for all of it.
          </p>
          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', maxWidth: 720, margin: '0 auto' }}>
            {[
              [Bot, 'AI assistant', '24/7 on web & WhatsApp'],
              [MessageSquare, 'Parent engagement', 'Fees, attendance, alerts'],
              [Megaphone, 'Marketing & admissions', 'Leads, tours, content'],
              [Wallet, 'Fee collection', 'Paystack / Flutterwave'],
            ].map(([Icon, t, d]) => (
              <div key={t} style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 16, padding: '20px 16px' }}>
                <Icon size={22} color={B} style={{ marginBottom: 10 }} />
                <div style={{ fontSize: 14, fontWeight: 800, color: INK, fontFamily: HEAD }}>{t}</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 4, lineHeight: 1.4 }}>{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section style={{ padding: '10px 16px 64px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center', background: `linear-gradient(135deg,${B},${B2})`, borderRadius: 24, padding: 'clamp(32px,5vw,52px)', color: '#fff', boxShadow: `0 20px 60px ${B}33` }}>
          <Sparkles size={26} color="#FFD86E" style={{ marginBottom: 14 }} />
          <h2 style={{ ...H('clamp(22px,3.4vw,36px)'), color: '#fff' }}>See why schools switch to Akoro</h2>
          <p style={{ fontSize: 15.5, color: 'rgba(255,255,255,.85)', lineHeight: 1.65, maxWidth: 540, margin: '14px auto 0' }}>
            Start a free 14-day pilot on your real school data. Website, AI assistant and parent tools included.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 26 }}>
            <Btn v="outline" sz="lg" onClick={() => navigate('/signup')} style={{ background: '#fff', border: 'none', color: B }}>Start free pilot <ArrowRight size={16} /></Btn>
            <Btn v="ghost" sz="lg" onClick={() => navigate('/pricing')} style={{ color: '#fff', border: '1.5px solid rgba(255,255,255,.5)' }}>View pricing</Btn>
          </div>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,.75)', marginTop: 18 }}>
            Prefer to talk first? <Link to="/contact" style={{ color: '#FFD86E', fontWeight: 700, textDecoration: 'none' }}>Book a demo →</Link>
          </p>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
