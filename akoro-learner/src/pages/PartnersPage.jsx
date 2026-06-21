import { useState } from 'react';
import { SiteNav, SiteFooter } from '../components/SiteChrome.jsx';
import { Handshake, School, Cpu, Globe, HeartHandshake, Award, TrendingUp, Users, CheckCircle2, ArrowRight, Mail, Building2, BookOpen, Zap } from 'lucide-react';

const B = '#6C3BFF', B2 = '#4C1DCC', INK = '#0F0A1E', TEXT = '#3F3A52', MUTED = '#7A7588', BORDER = '#ECEAF4', TINT = '#F6F4FF';

const TIERS = [
  {
    key: 'schools',
    Icon: School,
    color: '#EDE9FF',
    iconColor: B,
    label: 'School Partners',
    tagline: 'Bring NaNa to your classrooms',
    desc: 'We partner with primary, secondary, and tertiary institutions across Africa to embed AI-powered learning directly into the school experience.',
    perks: [
      'Discounted seat pricing for all enrolled students',
      'Dedicated onboarding and curriculum alignment support',
      'Teacher dashboard with class-wide progress analytics',
      'Co-branded learning journeys and certificates',
    ],
  },
  {
    key: 'tech',
    Icon: Cpu,
    color: '#FFF3E0',
    iconColor: '#E65100',
    label: 'Technology Partners',
    tagline: 'Build the future of learning together',
    desc: 'EdTech platforms, device manufacturers, and infrastructure providers that want to integrate or distribute Akoro to expand their impact.',
    perks: [
      'API access and white-label deployment options',
      'Joint go-to-market opportunities across West Africa',
      'Engineering support for integration and data pipelines',
      'Co-authored research and product case studies',
    ],
  },
  {
    key: 'ngo',
    Icon: Globe,
    color: '#E8F5E9',
    iconColor: '#2E7D32',
    label: 'NGO & Development Partners',
    tagline: 'Expand access where it matters most',
    desc: 'We work with nonprofits, development agencies, and foundations committed to education equity and digital inclusion across the continent.',
    perks: [
      'Subsidised or grant-funded learner seats',
      'Impact measurement and reporting for your funders',
      'Community engagement and digital literacy programmes',
      'Recognition as an Akoro Social Impact Partner',
    ],
  },
];

const PARTNERS = [
  { name: 'Ghana Education Service', cat: 'schools', abbr: 'GES' },
  { name: 'Ashesi University', cat: 'schools', abbr: 'AU' },
  { name: 'MEST Africa', cat: 'tech', abbr: 'MEST' },
  { name: 'Vodafone Ghana', cat: 'tech', abbr: 'VF' },
  { name: 'Tony Elumelu Foundation', cat: 'ngo', abbr: 'TEF' },
  { name: 'UNICEF Ghana', cat: 'ngo', abbr: 'UNICEF' },
  { name: 'Andela', cat: 'tech', abbr: 'AND' },
  { name: 'Mastercard Foundation', cat: 'ngo', abbr: 'MCF' },
];

const STATS = [
  { Icon: School, value: '120+', label: 'School Partners' },
  { Icon: Users, value: '380k', label: 'Student Seats' },
  { Icon: Globe, value: '8', label: 'Countries' },
  { Icon: TrendingUp, value: '94%', label: 'Partner Renewal Rate' },
];

const STEPS = [
  { n: '01', title: 'Express interest', body: 'Fill in the short form below. Tell us about your organisation and what you\'re hoping to achieve.' },
  { n: '02', title: 'Discovery call', body: 'Our partnerships team schedules a 30-minute call to understand your context and goals.' },
  { n: '03', title: 'Tailored proposal', body: 'We put together a partnership structure designed around your learners, timeline, and budget.' },
  { n: '04', title: 'Onboarding & launch', body: 'Dedicated support from day one. Go live in as little as two weeks.' },
];

export default function PartnersPage() {
  const [form, setForm] = useState({ name: '', org: '', email: '', type: '', message: '' });
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = e => {
    e.preventDefault();
    setSending(true);
    setTimeout(() => { setSending(false); setSent(true); }, 1200);
  };

  const inputStyle = { width: '100%', padding: '13px 16px', borderRadius: 10, border: `1.5px solid ${BORDER}`, fontSize: 15, fontFamily: '"DM Sans",sans-serif', color: INK, outline: 'none', background: '#fff', boxSizing: 'border-box' };

  return (
    <div style={{ fontFamily: '"DM Sans",sans-serif', color: INK, background: '#fff', minHeight: '100vh' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=DM+Sans:wght@400;500;600;700&display=swap');
        .prt-tiers { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 28px; }
        .prt-logos { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
        .prt-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; }
        .prt-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; }
        .prt-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .prt-split { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; align-items: start; }
        @media(max-width:960px) {
          .prt-logos { grid-template-columns: repeat(3, 1fr); }
          .prt-stats { grid-template-columns: repeat(2, 1fr); }
          .prt-steps { grid-template-columns: repeat(2, 1fr); }
          .prt-split { grid-template-columns: 1fr; gap: 40px; }
        }
        @media(max-width:600px) {
          .prt-logos { grid-template-columns: repeat(2, 1fr); }
          .prt-stats { grid-template-columns: repeat(2, 1fr); }
          .prt-steps { grid-template-columns: 1fr; }
          .prt-form-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <SiteNav />

      {/* Hero */}
      <section style={{ background: `linear-gradient(135deg, #1A1040 0%, ${B} 60%, #2D1B6E 100%)`, padding: '88px 24px 72px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 70% 30%, rgba(255,255,255,.07) 0%, transparent 60%)' }} />
        <div style={{ maxWidth: 1120, margin: '0 auto', position: 'relative', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 999, padding: '6px 18px', marginBottom: 24 }}>
            <Handshake size={15} color="#fff" />
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>Partner with Akoro</span>
          </div>
          <h1 style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 900, fontSize: 'clamp(32px,5vw,56px)', color: '#fff', margin: '0 0 18px', lineHeight: 1.12 }}>
            Grow further, together
          </h1>
          <p style={{ color: 'rgba(255,255,255,.78)', fontSize: 18, lineHeight: 1.75, maxWidth: 560, margin: '0 auto 40px' }}>
            Join the schools, technology companies, and organisations already working with Akoro to transform learning across Africa.
          </p>
          <a href="#partner-form" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', color: B, fontWeight: 700, fontSize: 16, borderRadius: 12, padding: '14px 28px', textDecoration: 'none' }}>
            Become a partner <ArrowRight size={18} />
          </a>
        </div>
      </section>

      {/* Stats */}
      <section style={{ background: TINT, borderBottom: `1.5px solid ${BORDER}`, padding: '48px 24px' }}>
        <div className="prt-stats" style={{ maxWidth: 1120, margin: '0 auto' }}>
          {STATS.map(({ Icon, value, label }) => (
            <div key={label} style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 14, background: '#EDE9FF', marginBottom: 12 }}>
                <Icon size={22} color={B} />
              </div>
              <p style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 900, fontSize: 32, color: INK, margin: '0 0 4px' }}>{value}</p>
              <p style={{ color: MUTED, fontSize: 14, margin: 0 }}>{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Partner tiers */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '72px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: B, textTransform: 'uppercase', margin: '0 0 12px' }}>Partnership types</p>
          <h2 style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 900, fontSize: 'clamp(26px,3.5vw,40px)', color: INK, margin: '0 0 14px' }}>
            Find your partnership path
          </h2>
          <p style={{ color: TEXT, fontSize: 17, maxWidth: 520, margin: '0 auto', lineHeight: 1.7 }}>
            We tailor every partnership to your mission, scale, and context.
          </p>
        </div>
        <div className="prt-tiers">
          {TIERS.map(({ key, Icon, color, iconColor, label, tagline, desc, perks }) => (
            <div key={key} style={{ background: '#fff', border: `1.5px solid ${BORDER}`, borderRadius: 20, padding: '32px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 16, background: color }}>
                <Icon size={24} color={iconColor} />
              </div>
              <div>
                <p style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 800, fontSize: 20, color: INK, margin: '0 0 4px' }}>{label}</p>
                <p style={{ color: B, fontWeight: 600, fontSize: 14, margin: 0 }}>{tagline}</p>
              </div>
              <p style={{ color: TEXT, fontSize: 15, lineHeight: 1.7, margin: 0 }}>{desc}</p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {perks.map(p => (
                  <li key={p} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, color: TEXT }}>
                    <CheckCircle2 size={16} color={B} style={{ marginTop: 2, flexShrink: 0 }} />
                    {p}
                  </li>
                ))}
              </ul>
              <a href="#partner-form" style={{ marginTop: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, color: B, fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
                Apply now <ArrowRight size={15} />
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* Partner logos */}
      <section style={{ background: TINT, borderTop: `1.5px solid ${BORDER}`, padding: '64px 24px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <p style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 36 }}>Trusted by leading organisations</p>
          <div className="prt-logos">
            {PARTNERS.map(({ name, abbr }) => (
              <div key={name} style={{ background: '#fff', border: `1.5px solid ${BORDER}`, borderRadius: 14, padding: '22px 12px', textAlign: 'center' }}>
                <p style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 900, fontSize: 15, color: B, margin: '0 0 6px' }}>{abbr}</p>
                <p style={{ color: MUTED, fontSize: 12, margin: 0, lineHeight: 1.4 }}>{name}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '72px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: B, textTransform: 'uppercase', margin: '0 0 12px' }}>How it works</p>
          <h2 style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 900, fontSize: 'clamp(26px,3.5vw,40px)', color: INK, margin: 0 }}>
            From inquiry to impact in four steps
          </h2>
        </div>
        <div className="prt-steps">
          {STEPS.map(({ n, title, body }) => (
            <div key={n} style={{ position: 'relative' }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: B, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <span style={{ color: '#fff', fontFamily: 'Nunito,sans-serif', fontWeight: 900, fontSize: 16 }}>{n}</span>
              </div>
              <p style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 800, fontSize: 18, color: INK, margin: '0 0 10px' }}>{title}</p>
              <p style={{ color: TEXT, fontSize: 15, lineHeight: 1.7, margin: 0 }}>{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Application form */}
      <section id="partner-form" style={{ background: TINT, borderTop: `1.5px solid ${BORDER}`, padding: '72px 24px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <div className="prt-split">
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: B, textTransform: 'uppercase', margin: '0 0 12px' }}>Get in touch</p>
              <h2 style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 900, fontSize: 'clamp(26px,3.5vw,38px)', color: INK, margin: '0 0 16px' }}>
                Ready to partner?
              </h2>
              <p style={{ color: TEXT, fontSize: 16, lineHeight: 1.75, margin: '0 0 32px' }}>
                Tell us a little about your organisation and goals. Our partnerships team will be in touch within 2 business days.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {[
                  [HeartHandshake, 'Tailored partnership structure'],
                  [Zap, 'Launch in as little as two weeks'],
                  [Award, 'Dedicated partner success manager'],
                  [BookOpen, 'Impact reporting included'],
                ].map(([Icon, txt]) => (
                  <div key={txt} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: '#EDE9FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon size={18} color={B} />
                    </div>
                    <span style={{ color: TEXT, fontSize: 15 }}>{txt}</span>
                  </div>
                ))}
              </div>
            </div>

            {sent ? (
              <div style={{ background: '#fff', border: `1.5px solid ${BORDER}`, borderRadius: 20, padding: '48px 36px', textAlign: 'center' }}>
                <CheckCircle2 size={48} color="#22C55E" style={{ marginBottom: 16 }} />
                <h3 style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 800, fontSize: 22, color: INK, margin: '0 0 10px' }}>Application received!</h3>
                <p style={{ color: TEXT, fontSize: 16, lineHeight: 1.7, margin: '0 0 24px' }}>Our partnerships team will reach out within 2 business days.</p>
                <button onClick={() => { setSent(false); setForm({ name: '', org: '', email: '', type: '', message: '' }); }}
                  style={{ padding: '11px 24px', border: `1.5px solid ${BORDER}`, borderRadius: 10, background: '#fff', color: TEXT, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  Submit another enquiry
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ background: '#fff', border: `1.5px solid ${BORDER}`, borderRadius: 20, padding: '36px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="prt-form-grid">
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6 }}>Full name *</label>
                    <input required value={form.name} onChange={set('name')} placeholder="Your name" style={inputStyle} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6 }}>Organisation *</label>
                    <input required value={form.org} onChange={set('org')} placeholder="Organisation name" style={inputStyle} />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6 }}>Work email *</label>
                  <input required type="email" value={form.email} onChange={set('email')} placeholder="you@org.com" style={inputStyle} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6 }}>Partnership type *</label>
                  <select required value={form.type} onChange={set('type')} style={{ ...inputStyle, color: form.type ? INK : MUTED }}>
                    <option value="" disabled>Select a type…</option>
                    <option value="School Partner">School Partner</option>
                    <option value="Technology Partner">Technology Partner</option>
                    <option value="NGO / Development Partner">NGO / Development Partner</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6 }}>Tell us about your goals</label>
                  <textarea value={form.message} onChange={set('message')} rows={4} placeholder="What are you hoping to achieve through this partnership?"
                    style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} />
                </div>
                <button type="submit" disabled={sending}
                  style={{ padding: '14px', background: sending ? '#9E8CFF' : B, color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: sending ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  {sending ? 'Sending…' : (<>Submit application <ArrowRight size={17} /></>)}
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section style={{ background: `linear-gradient(135deg, ${INK} 0%, #2D1B6E 100%)`, padding: '64px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <Handshake size={36} color="rgba(255,255,255,.4)" style={{ marginBottom: 16 }} />
          <h2 style={{ fontFamily: 'Nunito,sans-serif', fontWeight: 900, fontSize: 'clamp(24px,3vw,36px)', color: '#fff', margin: '0 0 14px' }}>
            Questions before applying?
          </h2>
          <p style={{ color: 'rgba(255,255,255,.75)', fontSize: 17, lineHeight: 1.7, margin: '0 0 28px' }}>
            Drop us an email and our team will get back to you within one business day.
          </p>
          <a href="mailto:partners@akoro.ai" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', color: B, fontWeight: 700, fontSize: 15, borderRadius: 12, padding: '13px 24px', textDecoration: 'none' }}>
            <Mail size={17} /> partners@akoro.ai
          </a>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
