import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardList, Settings2, GraduationCap, Share2, Database, Cookie, Lock, Scale, Bell,
  Shield, Ban, KeyRound, Pencil, ArrowLeft, ArrowRight, Mail,
} from 'lucide-react';

const B = '#6C3BFF', B2 = '#4C1DCC', INK = '#0F0A1E', TEXT = '#3F3A52', MUTED = '#7A7588',
  BORDER = '#ECEAF4', SURFACE = '#FAFAFB', TINT = '#F6F4FF';

const SECTIONS = [
  {
    id: 'what-we-collect',
    Icon: ClipboardList,
    title: 'What We Collect',
    badge: 'Data Collection',
    badgeColor: '#6366F1',
    body: [
      {
        subtitle: 'Information you provide',
        text: 'When you create an account we collect your full name, email address, password (hashed), year group, school name, and any profile details you choose to add such as a profile photo or preferred subjects.',
      },
      {
        subtitle: 'Learning activity data',
        text: 'We record session history, topics taught, assessment scores, knowledge-confidence levels per subject, XP earned, battle results, and your AI agent\'s knowledge model so we can personalise your learning experience.',
      },
      {
        subtitle: 'Device & usage data',
        text: 'We automatically collect browser type, device model, operating system, IP address, and page interaction events (clicks, session duration) to diagnose errors and improve the platform.',
      },
      {
        subtitle: 'Voice & media inputs',
        text: 'If you use voice teaching, audio is processed in real time to convert speech to text. We do not store raw audio recordings beyond the duration of a session unless you explicitly save a voice note.',
      },
    ],
  },
  {
    id: 'how-we-use',
    Icon: Settings2,
    title: 'How We Use Your Data',
    badge: 'Purpose of Processing',
    badgeColor: '#7C3AED',
    body: [
      { subtitle: 'Deliver the service', text: 'To run the platform, personalise your AI agent\'s knowledge model, schedule learning sessions, generate assessments, and surface revision prompts at the right time.' },
      { subtitle: 'Improve the platform', text: 'Aggregated, anonymised usage patterns help us identify bugs, optimise AI accuracy, and build new features. We never sell individual data.' },
      { subtitle: 'Communications', text: 'We send transactional emails (password resets, session reminders, progress reports). You can adjust notification preferences in Settings. We do not send unsolicited marketing without consent.' },
      { subtitle: 'Safety & compliance', text: 'To detect fraud, enforce our Terms of Service, and comply with legal obligations including regulatory requests.' },
    ],
  },
  {
    id: 'student-data',
    Icon: GraduationCap,
    title: 'Student Data',
    badge: 'Child & Student Safety',
    badgeColor: '#059669',
    body: [
      { subtitle: 'Our commitment', text: 'Akoro is built for students. Educational records — session history, assessment results, knowledge maps — are used solely to deliver and improve your learning experience. We never use them for advertising.' },
      { subtitle: 'Under-13 policy', text: 'We do not knowingly collect personal data from children under 13 without verifiable parental or institutional consent. Schools deploying Akoro for younger students must obtain appropriate parental consent before onboarding.' },
      { subtitle: 'Instructor access', text: 'Your enrolled teachers and institution administrators can view your progress data, session logs, and assessment scores within their authorised scope. They may not download or export your data to third parties without your consent.' },
      { subtitle: 'Applicable laws', text: 'We comply with Nigeria\'s NDPR, the EU/UK GDPR where applicable, and FERPA for US-based institutions.' },
    ],
  },
  {
    id: 'data-sharing',
    Icon: Share2,
    title: 'Data Sharing',
    badge: 'Third Parties',
    badgeColor: '#D97706',
    body: [
      { subtitle: 'Service providers', text: 'We share data with vetted providers who help us operate the platform: cloud hosting (AWS / Supabase), email delivery (SMTP), payment processing (Paystack / Stripe), and error monitoring. All are bound by strict data processing agreements.' },
      { subtitle: 'We never sell your data', text: 'Your personal data is never sold, rented, or traded to advertisers, data brokers, or any third party for commercial purposes.' },
      { subtitle: 'Legal disclosures', text: 'We may disclose data if required by a court order, law enforcement request, or to protect the safety of users or the public. We will notify you where legally permitted.' },
      { subtitle: 'Business transfers', text: 'In the event of a merger or acquisition, your data may be transferred to the successor entity. We will notify users and ensure the same privacy protections apply.' },
    ],
  },
  {
    id: 'data-retention',
    Icon: Database,
    title: 'Data Retention',
    badge: 'How Long We Keep Data',
    badgeColor: '#6366F1',
    body: [
      { subtitle: 'Account data', text: 'Retained while your account is active. If you delete your account, personal data is removed within 30 days except where retention is required by law.' },
      { subtitle: 'Learning records', text: 'Session histories and knowledge-model data are retained for 24 months after the last active session to support continuity and academic records requests.' },
      { subtitle: 'Anonymised data', text: 'Aggregated, anonymised analytics (e.g., average session length by subject) may be retained indefinitely for research and platform improvement.' },
      { subtitle: 'Backups', text: 'Encrypted backups are retained for up to 90 days before being permanently deleted.' },
    ],
  },
  {
    id: 'cookies',
    Icon: Cookie,
    title: 'Cookies & Tracking',
    badge: 'Cookies',
    badgeColor: '#B45309',
    body: [
      { subtitle: 'Essential cookies', text: 'Required for authentication (HttpOnly session cookies) and security (CSRF tokens). These cannot be disabled without breaking the platform.' },
      { subtitle: 'Analytics cookies', text: 'Optional cookies help us understand how features are used. You can opt out in your browser settings or in our cookie banner without affecting core functionality.' },
      { subtitle: 'No advertising trackers', text: 'We do not use cross-site advertising trackers, Facebook Pixel, Google Ads tags, or similar third-party tracking scripts on any page of the authenticated platform.' },
      { subtitle: 'Managing cookies', text: 'You can clear or block cookies in your browser settings at any time. Note that blocking essential cookies will require you to re-authenticate on each visit.' },
    ],
  },
  {
    id: 'security',
    Icon: Lock,
    title: 'Security',
    badge: 'How We Protect Your Data',
    badgeColor: '#DC2626',
    body: [
      { subtitle: 'Encryption in transit', text: 'All data transmitted between your device and our servers is encrypted using TLS 1.2 or higher. We enforce HTTPS across every endpoint.' },
      { subtitle: 'Encryption at rest', text: 'Sensitive fields (passwords, tokens, payment references) are encrypted or hashed before storage using industry-standard algorithms.' },
      { subtitle: 'Access controls', text: 'Role-based access controls ensure that only authorised personnel and systems can access user data. All internal access is logged and audited.' },
      { subtitle: 'Breach notification', text: 'In the event of a data breach that affects your personal data, we will notify you within 72 hours of becoming aware of it, as required by applicable law.' },
    ],
  },
  {
    id: 'your-rights',
    Icon: Scale,
    title: 'Your Rights',
    badge: 'Data Subject Rights',
    badgeColor: '#7C3AED',
    body: [
      { subtitle: 'Access', text: 'You can request a copy of the personal data we hold about you at any time by emailing privacy@akoro.app.' },
      { subtitle: 'Correction', text: 'You can update most profile information directly in Settings. For data that cannot be self-corrected, contact us and we will update it within 14 days.' },
      { subtitle: 'Deletion', text: 'You can delete your account in Settings → Account → Delete Account. We will remove your personal data within 30 days, subject to legal retention requirements.' },
      { subtitle: 'Portability', text: 'You can request an export of your learning data (session history, agent knowledge model, assessment results) in JSON format. Email privacy@akoro.app.' },
      { subtitle: 'Objection & restriction', text: 'You may object to certain processing activities or request we restrict processing of your data while a dispute is resolved. Contact privacy@akoro.app.' },
    ],
  },
  {
    id: 'changes',
    Icon: Bell,
    title: 'Policy Changes',
    badge: 'Updates',
    badgeColor: '#6B7280',
    body: [
      { subtitle: 'How we notify you', text: 'We will notify you of material changes to this Privacy Policy via email and an in-app banner at least 14 days before they take effect.' },
      { subtitle: 'Your options', text: 'If you do not accept the revised policy, you may close your account before the effective date. Continued use after that date constitutes acceptance.' },
    ],
  },
];

const TOC = SECTIONS.map(({ id, title, Icon }) => ({ id, title, Icon }));

const SUMMARY = [
  { Icon: Ban, title: 'No data selling', desc: 'We never sell or trade your personal data.', color: '#DC2626' },
  { Icon: GraduationCap, title: 'Student-first', desc: 'Educational records used only for learning.', color: '#059669' },
  { Icon: KeyRound, title: 'TLS + Encryption', desc: 'Data encrypted in transit and at rest.', color: B },
  { Icon: Pencil, title: 'Your control', desc: 'Access, edit, export or delete anytime.', color: '#7C3AED' },
];

export default function PrivacyPolicyPage() {
  const navigate = useNavigate();
  const [active, setActive] = useState(null);

  const scrollTo = (id) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=DM+Sans:wght@400;500;600;700&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'DM Sans',sans-serif;background:${SURFACE}}
        .legal-section{scroll-margin-top:88px}
        .legal-shell{display:grid;grid-template-columns:240px minmax(0,1fr);gap:36px;align-items:start}
        .legal-toc-item{transition:all .15s}
        .legal-toc-item:hover{background:${TINT}!important;color:${B}!important}
        @media(max-width:860px){.legal-shell{grid-template-columns:1fr}.legal-toc{display:none}}
        @media(max-width:560px){.legal-head{padding:12px 16px!important}.legal-head-cross{display:none!important}}
      `}</style>

      <div style={{ minHeight: '100vh', background: SURFACE, fontFamily: "'DM Sans', sans-serif" }}>

        {/* Sticky Header */}
        <div className="legal-head" style={{ background: 'rgba(255,255,255,.9)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${BORDER}`, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, position: 'sticky', top: 0, zIndex: 200 }}>
          <button onClick={() => navigate(-1)}
            style={{ background: TINT, border: `1px solid ${BORDER}`, cursor: 'pointer', color: B, lineHeight: 1, padding: '9px 14px', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "'DM Sans',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ArrowLeft size={16} /> Back
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: INK, fontFamily: "'Nunito',sans-serif" }}>Privacy Policy</div>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 500 }}>Effective: 1 June 2025 · Akoro Technologies Ltd</div>
          </div>
          <button className="legal-head-cross" onClick={() => navigate('/terms')}
            style={{ background: '#fff', border: `1px solid ${BORDER}`, cursor: 'pointer', color: B, padding: '9px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: "'DM Sans',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Terms of Service <ArrowRight size={15} />
          </button>
        </div>

        {/* Hero Banner */}
        <div style={{ background: `linear-gradient(135deg, ${B}, ${B2})`, padding: 'clamp(48px,7vw,72px) 20px', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,.15)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
            <Shield size={28} color="#fff" />
          </div>
          <h1 style={{ fontSize: 'clamp(26px, 4vw, 40px)', fontWeight: 900, color: '#fff', marginBottom: 14, fontFamily: "'Nunito',sans-serif" }}>Your Privacy Matters</h1>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,.85)', maxWidth: 560, margin: '0 auto 26px', lineHeight: 1.7 }}>
            Akoro is built for students. We collect only what we need to give you the best learning experience — and we never sell your data.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {['NDPR Compliant', 'GDPR Aligned', 'FERPA Aware', 'TLS Encrypted', 'No Ads'].map(b => (
              <span key={b} style={{ background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.28)', borderRadius: 20, padding: '5px 13px', fontSize: 12, fontWeight: 600, color: '#fff' }}>{b}</span>
            ))}
          </div>
        </div>

        <div style={{ maxWidth: 1080, margin: '0 auto', padding: 'clamp(24px,5vw,40px)', display: 'flex', flexDirection: 'column', gap: 36 }}>

          {/* Quick-summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            {SUMMARY.map(({ Icon, title, desc, color }) => (
              <div key={title} style={{ background: '#fff', borderRadius: 16, padding: '20px 18px', border: `1px solid ${BORDER}`, boxShadow: '0 1px 2px rgba(16,10,30,.04)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <span style={{ width: 44, height: 44, borderRadius: 12, background: `${color}14`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={22} color={color} />
                </span>
                <div style={{ fontSize: 14, fontWeight: 800, color: INK, fontFamily: "'Nunito',sans-serif" }}>{title}</div>
                <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>

          <div className="legal-shell">

            {/* Sticky TOC */}
            <div className="legal-toc" style={{ position: 'sticky', top: 88 }}>
              <div style={{ background: '#fff', borderRadius: 16, padding: 16, border: `1px solid ${BORDER}`, boxShadow: '0 1px 2px rgba(16,10,30,.04)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED, marginBottom: 12 }}>Contents</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {TOC.map(({ id, title, Icon }) => (
                    <button key={id} className="legal-toc-item" onClick={() => scrollTo(id)}
                      style={{ background: active === id ? TINT : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '9px 10px', borderRadius: 10, fontSize: 13, fontWeight: active === id ? 700 : 500, color: active === id ? B : TEXT, fontFamily: "'DM Sans',sans-serif", display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Icon size={16} color={active === id ? B : MUTED} style={{ flexShrink: 0 }} />{title}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Sections */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Intro card */}
              <div style={{ background: TINT, borderRadius: 16, padding: '22px 24px', borderLeft: `4px solid ${B}` }}>
                <p style={{ fontSize: 14, lineHeight: 1.8, color: TEXT }}>
                  <strong style={{ color: INK }}>Akoro Technologies Ltd</strong> ("Akoro", "we", "us") operates the Akoro learning platform. This Privacy Policy explains what personal data we collect, how we use it, who we share it with, and what rights you have. It applies to all users of the Akoro learner app, instructor portal, and associated APIs.
                </p>
              </div>

              {SECTIONS.map(({ id, Icon, title, badge, badgeColor, body }) => (
                <div key={id} id={id} className="legal-section"
                  style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', border: `1px solid ${BORDER}`, boxShadow: '0 1px 2px rgba(16,10,30,.04)' }}>
                  {/* Section header */}
                  <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: `${badgeColor}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon size={22} color={badgeColor} />
                    </div>
                    <h2 style={{ fontSize: 17, fontWeight: 800, color: INK, fontFamily: "'Nunito',sans-serif" }}>{title}</h2>
                    <span style={{ background: `${badgeColor}14`, color: badgeColor, fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{badge}</span>
                  </div>
                  {/* Sub-sections */}
                  <div style={{ padding: '18px 24px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {body.map(({ subtitle, text }) => (
                      <div key={subtitle}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{subtitle}</div>
                        <p style={{ fontSize: 14, lineHeight: 1.75, color: TEXT }}>{text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Contact card */}
              <div style={{ background: TINT, borderRadius: 16, padding: '32px 24px', border: `1px solid ${BORDER}`, textAlign: 'center' }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: `${B}14`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                  <Mail size={26} color={B} />
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: INK, marginBottom: 8, fontFamily: "'Nunito',sans-serif" }}>Questions about your data?</h3>
                <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.6, marginBottom: 22, maxWidth: 460, marginInline: 'auto' }}>Our privacy team responds within 30 days to all data requests — access, correction, deletion, or portability.</p>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <a href="mailto:privacy@akoro.app"
                    style={{ background: B, color: '#fff', padding: '11px 22px', borderRadius: 10, fontSize: 13.5, fontWeight: 700, textDecoration: 'none', fontFamily: "'DM Sans',sans-serif" }}>
                    privacy@akoro.app
                  </a>
                  <button onClick={() => navigate('/terms')}
                    style={{ background: '#fff', color: B, border: `1px solid ${BORDER}`, padding: '11px 22px', borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                    Read Terms of Service
                  </button>
                </div>
              </div>

              <p style={{ fontSize: 12, color: MUTED, textAlign: 'center', lineHeight: 1.6 }}>
                Akoro Technologies Ltd · RC 1234567 · Lagos, Nigeria<br />
                This policy was last updated on 1 June 2025.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
