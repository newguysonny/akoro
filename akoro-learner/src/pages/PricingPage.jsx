/**
 * PricingPage: school-facing pricing for the Nigerian / African market.
 * Four tiers (Starter · Growth · Pro · Enterprise), a monthly/annual toggle
 * (annual = 2 months free), a per-student alternative, a feature matrix, the
 * local-market billing tactics, FAQ and conversion CTAs. Uses the shared
 * marketing chrome (SiteNav / SiteFooter).
 */
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { SiteNav, SiteFooter, Btn } from '../components/SiteChrome.jsx';
import {
  Check, X, Star, ArrowRight, Sparkles, Globe, MessageSquare, GraduationCap,
  Users, TrendingUp, ShieldCheck, Zap, CreditCard, CalendarDays, BadgePercent,
} from 'lucide-react';

const B = '#6C3BFF', B2 = '#4C1DCC', INK = '#0F0A1E', TEXT = '#3F3A52';
const MUTED = '#7A7588', BORDER = '#ECEAF4', SURFACE = '#FAFAFB', TINT = '#F6F4FF';
const G = '#10B981', AMBER = '#E8884A';
const HEAD = "'Nunito', sans-serif", BODY = "'DM Sans', sans-serif";

const EYEBROW = { fontSize: 11, fontWeight: 800, color: B, letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: BODY };
const H = (size = 'clamp(26px,4.4vw,46px)') => ({ fontSize: size, fontWeight: 900, color: INK, lineHeight: 1.12, fontFamily: HEAD, letterSpacing: '-0.02em' });

// ── Tier data ────────────────────────────────────────────────────────────────
const TIERS = [
  {
    id: 'starter', name: 'Starter', tag: 'Digital Presence', icon: Globe,
    monthly: 12000, blurb: 'Get online with a school website and an AI assistant, for less than the cost of one developer invoice.',
    cta: 'Start free pilot', highlight: false,
    features: [
      'Custom school website (drag-and-drop builder)',
      'Basic AI chat widget that answers FAQs 24/7',
      'Free <slug>.akoro.name.ng subdomain',
      '1 admin account',
      'Mobile-ready, installable as an app (PWA)',
    ],
    best: 'New & low-budget private schools with no website yet.',
  },
  {
    id: 'growth', name: 'Growth', tag: 'Parent & Student Engagement', icon: Users,
    monthly: 30000, blurb: 'Turn your website into a 24/7 engagement engine: after-school revision, a 24/7 WhatsApp agent, and teacher tools.',
    cta: 'Start free pilot', highlight: true, badge: '⭐ Best value',
    features: [
      'Everything in Starter, plus:',
      'AI Assessment Agent: students revise & get graded',
      'Parent Portal Agent: attendance, fees & announcements',
      'Teacher lesson-plan generator (5 subjects / month)',
      '24/7 WhatsApp agent for parents (+ SMS)',
      'Up to 5 teacher accounts',
    ],
    best: 'Established primary & secondary schools, 200–800 students.',
  },
  {
    id: 'pro', name: 'Pro', tag: 'Enrollment & Revenue Engine', icon: TrendingUp,
    monthly: 80000, blurb: 'Win more enrolments and collect fees faster. One extra student pays for the whole year.',
    cta: 'Talk to sales', highlight: false,
    features: [
      'Everything in Growth, plus:',
      'AI Admissions Counselor: leads, tours & follow-ups',
      'Auto-blog + social content generator',
      'Fee collection in chat (Paystack / Flutterwave)',
      'Smart attendance & retention alerts',
      'Custom domain + SEO optimisation',
      'Unlimited teachers + full multi-agent suite',
    ],
    best: 'Premium, international & fast-growing schools.',
  },
  {
    id: 'enterprise', name: 'Enterprise', tag: 'School Group / Chain', icon: ShieldCheck,
    monthly: null, blurb: 'A white-label platform for chains and government partnerships, with central oversight across every campus.',
    cta: 'Contact us', highlight: false,
    features: [
      'Everything in Pro, plus:',
      'White-label: rebrand the platform as your own',
      'Multi-school dashboard & central oversight',
      'Custom AI training per school',
      'Dedicated success manager & support',
      'Revenue share on payment processing',
    ],
    best: 'School groups, chains & state-government programmes.',
  },
];

// ── Feature matrix ───────────────────────────────────────────────────────────
const MATRIX = [
  ['Custom website builder', true, true, true, true],
  ['AI FAQ chat widget', true, true, true, true],
  ['AI Assessment Agent (revision)', false, true, true, true],
  ['Parent Portal (attendance · fees)', false, true, true, true],
  ['24/7 WhatsApp agent (+ SMS)', false, true, true, true],
  ['Teacher lesson-plan generator', false, '5 / mo', 'Unlimited', 'Unlimited'],
  ['AI Admissions Counselor', false, false, true, true],
  ['Fee collection in chat', false, false, true, true],
  ['Auto blog + social content', false, false, true, true],
  ['Custom domain + SEO', false, false, true, true],
  ['Teacher accounts', '1 admin', 'Up to 5', 'Unlimited', 'Unlimited'],
  ['White-label & multi-school', false, false, false, true],
];

const TACTICS = [
  { icon: CalendarDays, title: 'Annual billing, 2 months free', desc: 'Pay yearly and align with your Sept & Jan fee-collection seasons. Best value, and the setup fee is waived.' },
  { icon: BadgePercent, title: 'Per-student option', desc: 'Prefer to think per head? Ask for our ₦300–₦500 / student / year plan instead of a flat monthly fee.' },
  { icon: CreditCard, title: 'Auto-debit via Paystack', desc: 'Set-and-forget monthly or termly auto-debit. No cheques, no chasing, no “the payment is coming”.' },
  { icon: Zap, title: 'Free 14-day pilot', desc: 'Run it on your real school data first. Nigerian schools trust what they can see, so see it before you pay.' },
];

const FAQ = [
  ['Can we pay per term instead of monthly?', 'Yes. Most schools choose termly or annual billing to match fee-collection seasons. Annual gives you two months free and waives the setup fee.'],
  ['Is there a setup fee?', 'A one-time onboarding fee of ₦25,000–₦50,000 applies to monthly plans and is fully waived when you pay annually. It covers website setup, agent configuration and staff training.'],
  ['What does the free pilot include?', 'A 14-day pilot on your real school data (your website, your AI assistant, and the Growth agent suite) so you can show it to your team and parents before committing.'],
  ['Do parents need to download an app?', 'No. Parents chat with your school’s AI over WhatsApp or right on your website. It’s your school’s branded assistant, not a third-party app they’ll forget.'],
  ['Can we switch tiers later?', 'Anytime. Upgrade as you grow. Your website, data and agents carry over. No migration, no downtime.'],
  ['Do you support Flutterwave as well as Paystack?', 'Yes. Pro and Enterprise support both Paystack and Flutterwave for in-chat fee collection.'],
];

const naira = (n) => '₦' + n.toLocaleString('en-NG');

export default function PricingPage() {
  const navigate = useNavigate();
  const [annual, setAnnual] = useState(true);

  // Annual = 2 months free → yearly = monthly × 10; show per-month equivalent.
  const priceFor = (t) => {
    if (t.monthly == null) return { big: 'Custom', sub: 'Tailored to your group' };
    if (annual) {
      const perMonth = Math.round((t.monthly * 10) / 12 / 1000) * 1000;
      return { big: naira(perMonth), sub: `/mo · billed ${naira(t.monthly * 10)}/yr` };
    }
    return { big: naira(t.monthly), sub: '/month' };
  };

  const goCTA = (t) => {
    if (t.id === 'starter' || t.id === 'growth') navigate('/signup');
    else navigate('/contact');
  };

  return (
    <div style={{ background: '#fff', fontFamily: BODY, color: TEXT, minHeight: '100vh' }}>
      <SiteNav />

      {/* ── Hero ── */}
      <section style={{ background: `linear-gradient(180deg,${TINT},#fff)`, padding: 'clamp(48px,7vw,88px) 20px 32px', textAlign: 'center' }}>
        <div style={{ maxWidth: 780, margin: '0 auto' }}>
          <div style={{ ...EYEBROW, marginBottom: 14 }}>Pricing for African schools</div>
          <h1 style={H()}>Your school’s website, AI assistant & operations, in one price.</h1>
          <p style={{ fontSize: 'clamp(15px,2vw,18px)', color: MUTED, lineHeight: 1.65, maxWidth: 620, margin: '18px auto 0' }}>
            Priced for Nigerian purchasing power and cash-flow. Pay termly or annually,
            start with a free 14-day pilot on your real data, and grow as you enrol.
          </p>

          {/* Billing toggle */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: `1.5px solid ${BORDER}`, borderRadius: 99, padding: 5, marginTop: 28, boxShadow: '0 4px 18px rgba(108,59,255,.08)' }}>
            {[['Annual', true], ['Monthly', false]].map(([label, val]) => (
              <button key={label} onClick={() => setAnnual(val)}
                style={{ border: 'none', cursor: 'pointer', borderRadius: 99, padding: '9px 20px', fontSize: 14, fontWeight: 700, fontFamily: BODY,
                  background: annual === val ? `linear-gradient(135deg,${B},${B2})` : 'transparent',
                  color: annual === val ? '#fff' : MUTED, transition: 'all .2s' }}>
                {label}{label === 'Annual' && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: annual === val ? '#fff' : G }}>2 months free</span>}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Tier cards ── */}
      <section style={{ padding: '20px 16px 8px' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit,minmax(255px,1fr))' }}>
          {TIERS.map((t) => {
            const p = priceFor(t);
            const hot = t.highlight;
            return (
              <div key={t.id} style={{
                position: 'relative', background: hot ? `linear-gradient(180deg,#fff,${TINT})` : '#fff',
                border: `1.5px solid ${hot ? B : BORDER}`, borderRadius: 20, padding: '26px 22px 24px',
                boxShadow: hot ? `0 18px 50px ${B}22` : '0 2px 14px rgba(16,10,30,.05)',
                transform: hot ? 'translateY(-6px)' : 'none', display: 'flex', flexDirection: 'column',
              }}>
                {t.badge && (
                  <div style={{ position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', background: `linear-gradient(135deg,${B},${B2})`, color: '#fff', fontSize: 11.5, fontWeight: 800, padding: '5px 14px', borderRadius: 99, whiteSpace: 'nowrap', boxShadow: `0 6px 18px ${B}44` }}>{t.badge}</div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: hot ? B : TINT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <t.icon size={18} color={hot ? '#fff' : B} />
                  </div>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 900, color: INK, fontFamily: HEAD, lineHeight: 1 }}>{t.name}</div>
                    <div style={{ fontSize: 11.5, color: MUTED, fontWeight: 600 }}>{t.tag}</div>
                  </div>
                </div>

                <div style={{ margin: '16px 0 4px', display: 'flex', alignItems: 'baseline', gap: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 30, fontWeight: 900, color: INK, fontFamily: HEAD, letterSpacing: '-0.02em' }}>{p.big}</span>
                  <span style={{ fontSize: 13, color: MUTED, fontWeight: 600 }}>{p.sub}</span>
                </div>
                <p style={{ fontSize: 13, color: TEXT, lineHeight: 1.55, margin: '8px 0 18px', minHeight: 58 }}>{t.blurb}</p>

                <Btn v={hot ? 'primary' : 'outline'} onClick={() => goCTA(t)} style={{ width: '100%', justifyContent: 'center' }}>
                  {t.cta} <ArrowRight size={14} />
                </Btn>

                <ul style={{ listStyle: 'none', margin: '20px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                  {t.features.map((f, i) => {
                    const isHeader = f.endsWith('plus:') || f.endsWith('plus:');
                    return (
                      <li key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 13, color: isHeader ? MUTED : TEXT, fontWeight: isHeader ? 700 : 500, lineHeight: 1.45 }}>
                        {!isHeader && <Check size={15} color={G} style={{ flexShrink: 0, marginTop: 1 }} />}
                        <span>{f}</span>
                      </li>
                    );
                  })}
                </ul>

                <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${BORDER}`, fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
                  <strong style={{ color: INK, fontWeight: 700 }}>Best for:</strong> {t.best}
                </div>
              </div>
            );
          })}
        </div>
        <p style={{ textAlign: 'center', fontSize: 13, color: MUTED, marginTop: 22 }}>
          Prices in Naira, excluding VAT. A one-time setup fee (₦25k–₦50k) applies to monthly plans and is <strong style={{ color: INK }}>waived on annual billing</strong>.
        </p>
      </section>

      {/* ── First-pitch bundle banner ── */}
      <section style={{ padding: '40px 16px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', background: `linear-gradient(135deg,${B},${B2})`, borderRadius: 24, padding: 'clamp(28px,4vw,44px)', color: '#fff', textAlign: 'center', boxShadow: `0 20px 60px ${B}33` }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: .85, marginBottom: 12 }}>Most schools start here</div>
          <p style={{ fontSize: 'clamp(18px,2.6vw,26px)', fontWeight: 800, fontFamily: HEAD, lineHeight: 1.4, maxWidth: 720, margin: '0 auto' }}>
            For <span style={{ color: '#FFD86E' }}>₦30,000/month</span>, get your own school website with a 24/7 AI assistant that
            revises with students after school, runs a 24/7 WhatsApp agent for parents, and writes your lesson plans.
          </p>
          <p style={{ fontSize: 15, opacity: .9, marginTop: 14 }}>One extra enrolled student pays for the whole year.</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 26 }}>
            <Btn v="outline" sz="lg" onClick={() => navigate('/signup')} style={{ background: '#fff', border: 'none', color: B }}>Start your free pilot <ArrowRight size={16} /></Btn>
            <Btn v="ghost" sz="lg" onClick={() => navigate('/contact')} style={{ color: '#fff', border: '1.5px solid rgba(255,255,255,.5)' }}>Book a demo</Btn>
          </div>
        </div>
      </section>

      {/* ── Feature matrix ── */}
      <section style={{ padding: '20px 16px 40px' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ ...EYEBROW, marginBottom: 10 }}>Compare plans</div>
            <h2 style={H('clamp(22px,3.2vw,34px)')}>Everything in every tier, side by side</h2>
          </div>
          <div style={{ overflowX: 'auto', border: `1px solid ${BORDER}`, borderRadius: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620, fontFamily: BODY }}>
              <thead>
                <tr style={{ background: SURFACE }}>
                  <th style={{ textAlign: 'left', padding: '14px 16px', fontSize: 12.5, fontWeight: 800, color: INK }}>Feature</th>
                  {TIERS.map((t) => (
                    <th key={t.id} style={{ padding: '14px 12px', fontSize: 12.5, fontWeight: 800, color: t.highlight ? B : INK, textAlign: 'center', minWidth: 96 }}>{t.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATRIX.map(([label, ...vals], r) => (
                  <tr key={r} style={{ borderTop: `1px solid ${BORDER}` }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT, fontWeight: 500 }}>{label}</td>
                    {vals.map((v, i) => (
                      <td key={i} style={{ padding: '12px 12px', textAlign: 'center', fontSize: 12.5, fontWeight: 700, color: TIERS[i].highlight ? B : TEXT, background: TIERS[i].highlight ? TINT : 'transparent' }}>
                        {v === true ? <Check size={16} color={G} /> : v === false ? <X size={15} color="#CFC9DC" /> : v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Local-market tactics ── */}
      <section style={{ padding: '40px 16px', background: SURFACE }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 30 }}>
            <div style={{ ...EYEBROW, marginBottom: 10 }}>Built for how schools pay</div>
            <h2 style={H('clamp(22px,3.2vw,34px)')}>Pricing that fits your cash flow</h2>
          </div>
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))' }}>
            {TACTICS.map((t) => (
              <div key={t.title} style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 16, padding: '22px 20px' }}>
                <div style={{ width: 40, height: 40, borderRadius: 11, background: TINT, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                  <t.icon size={20} color={B} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: INK, fontFamily: HEAD, marginBottom: 6 }}>{t.title}</div>
                <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.6, margin: 0 }}>{t.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section style={{ padding: '48px 16px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ ...EYEBROW, marginBottom: 10 }}>Questions</div>
            <h2 style={H('clamp(22px,3.2vw,34px)')}>Pricing FAQ</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {FAQ.map(([q, a], i) => (
              <details key={i} style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px 20px' }}>
                <summary style={{ cursor: 'pointer', fontSize: 15, fontWeight: 700, color: INK, fontFamily: HEAD, listStyle: 'none' }}>{q}</summary>
                <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.65, margin: '10px 0 0' }}>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section style={{ padding: '10px 16px 64px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center', background: INK, borderRadius: 24, padding: 'clamp(32px,5vw,52px)', color: '#fff' }}>
          <Sparkles size={26} color="#FFD86E" style={{ marginBottom: 14 }} />
          <h2 style={{ ...H('clamp(22px,3.4vw,36px)'), color: '#fff' }}>See it on your school’s data first</h2>
          <p style={{ fontSize: 15.5, color: 'rgba(255,255,255,.75)', lineHeight: 1.65, maxWidth: 540, margin: '14px auto 0' }}>
            Start a free 14-day pilot. No card, no setup fee. If it doesn’t win over your team and your parents, walk away.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 26 }}>
            <Btn v="primary" sz="lg" onClick={() => navigate('/signup')}>Start free pilot <ArrowRight size={16} /></Btn>
            <Btn v="ghost" sz="lg" onClick={() => navigate('/compare')} style={{ color: '#fff', border: '1.5px solid rgba(255,255,255,.4)' }}>Why Akoro vs others</Btn>
          </div>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', marginTop: 18 }}>
            Questions? <Link to="/contact" style={{ color: '#FFD86E', fontWeight: 700, textDecoration: 'none' }}>Talk to our schools team →</Link>
          </p>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
