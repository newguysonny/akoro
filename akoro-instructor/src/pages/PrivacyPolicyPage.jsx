import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AMBER, INK, MUTED, BORDER, WHITE, LIGHT, FONT } from '../constants.js';

const A = AMBER;

const SECTIONS = [
  {
    id: 'what-we-collect',
    icon: '📋',
    title: 'What We Collect',
    badge: 'Data Collection',
    badgeColor: '#6366F1',
    body: [
      { subtitle: 'Registration data', text: 'Your name, email address, hashed password, institution affiliation, profile photo, and any bio or contact details you provide.' },
      { subtitle: 'Platform activity', text: 'Course creation history, session schedules, student management actions, AI training uploads, earnings records, and settings changes.' },
      { subtitle: 'AI training content', text: 'Lesson materials, transcripts, notes, and other content you upload to train course-specific AI knowledge models.' },
      { subtitle: 'Device & usage data', text: 'Browser type, device model, IP address, and interaction events to diagnose errors and improve the platform.' },
    ],
  },
  {
    id: 'how-we-use',
    icon: '⚙️',
    title: 'How We Use Your Data',
    badge: 'Purpose',
    badgeColor: '#7C3AED',
    body: [
      { subtitle: 'Service delivery', text: 'To operate the instructor portal, process course enrollments, schedule sessions, train AI agents, and generate student performance reports.' },
      { subtitle: 'Payments', text: 'To process subscription fees and course revenue payments via our payment processor. We do not store full card numbers.' },
      { subtitle: 'Communications', text: 'Transactional emails about student activity, billing, and platform updates. You can manage notification preferences in Settings.' },
      { subtitle: 'Platform improvement', text: 'Aggregated, anonymised analytics help us improve AI accuracy and build new features. We never sell individual data.' },
    ],
  },
  {
    id: 'student-data-access',
    icon: '🎓',
    title: 'Student Data Access',
    badge: 'Your Responsibilities',
    badgeColor: '#059669',
    body: [
      { subtitle: 'Instructor access scope', text: 'You can view progress data, session logs, assessment scores, and knowledge maps for students enrolled in your courses within the Akoro platform.' },
      { subtitle: 'Your obligations', text: 'You agree to use student data solely for legitimate educational purposes, not export it to unauthorised third parties, and comply with NDPR, GDPR (where applicable), and FERPA (for US institutions).' },
      { subtitle: 'Data processor role', text: 'As an instructor, you act as a data processor for student personal data within your courses. Akoro acts as the data controller. Our Data Processing Agreement governs this relationship.' },
    ],
  },
  {
    id: 'ai-training',
    icon: '🤖',
    title: 'AI Training Data',
    badge: 'Content You Upload',
    badgeColor: '#D97706',
    body: [
      { subtitle: 'Course-specific models', text: 'Content you upload is used exclusively to build knowledge models for your courses. It is never shared with other instructors or used to train Akoro\'s general AI models without explicit consent.' },
      { subtitle: 'Your ownership', text: 'You retain full ownership of uploaded materials. You grant Akoro a licence to process them for the purpose of delivering the service.' },
      { subtitle: 'Deletion', text: 'You can delete uploaded training materials at any time. Deletion removes them from active AI models; they are purged from backups within 90 days.' },
    ],
  },
  {
    id: 'data-sharing',
    icon: '🔗',
    title: 'Data Sharing',
    badge: 'Third Parties',
    badgeColor: '#6366F1',
    body: [
      { subtitle: 'Service providers', text: 'We share data with vetted providers (cloud hosting, email delivery, payment processing) under strict data processing agreements.' },
      { subtitle: 'We never sell data', text: 'Your personal data and your students\' data are never sold, rented, or traded to advertisers or data brokers.' },
      { subtitle: 'Legal disclosures', text: 'We may disclose data if required by law, court order, or to protect user safety. We notify you where legally permitted.' },
    ],
  },
  {
    id: 'security',
    icon: '🔒',
    title: 'Security',
    badge: 'Protection Measures',
    badgeColor: '#DC2626',
    body: [
      { subtitle: 'Encryption', text: 'All data is encrypted in transit (TLS 1.2+). Sensitive fields are encrypted or hashed at rest.' },
      { subtitle: 'Access controls', text: 'Role-based access controls limit data access to authorised personnel. All internal access is logged and audited.' },
      { subtitle: 'Breach notification', text: 'In the event of a data breach affecting your account, we will notify you within 72 hours of becoming aware, as required by applicable law.' },
    ],
  },
  {
    id: 'retention',
    icon: '🗄️',
    title: 'Data Retention',
    badge: 'How Long We Keep Data',
    badgeColor: '#6B7280',
    body: [
      { subtitle: 'Account data', text: 'Retained while your account is active. Deleted within 30 days of account closure, subject to legal retention requirements.' },
      { subtitle: 'Student records', text: 'Retained for 24 months after the last active session to support academic records requests.' },
      { subtitle: 'Backups', text: 'Encrypted backups retained for up to 90 days then permanently deleted.' },
    ],
  },
  {
    id: 'your-rights',
    icon: '⚖️',
    title: 'Your Rights',
    badge: 'Data Subject Rights',
    badgeColor: '#7C3AED',
    body: [
      { subtitle: 'Access & correction', text: 'View and update most profile data in Settings. For other corrections, contact privacy@akoro.app.' },
      { subtitle: 'Deletion', text: 'Request account deletion in Settings → Account → Delete Account. Data is removed within 30 days, subject to legal obligations.' },
      { subtitle: 'Portability', text: 'Request an export of your course data and earnings history in JSON format. Email privacy@akoro.app.' },
      { subtitle: 'Response time', text: 'We respond to all data requests within 30 days.' },
    ],
  },
];

const TOC = SECTIONS.map(({ id, title, icon }) => ({ id, title, icon }));

export default function PrivacyPolicyPage() {
  const navigate = useNavigate();
  const [active, setActive] = useState(null);

  const scrollTo = (id) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div style={{ minHeight: '100vh', background: LIGHT, fontFamily: FONT }}>
      <style>{`
        .ip-toc-btn:hover{background:${A}18!important;color:${A}!important}
        .ip-section{scroll-margin-top:80px}
      `}</style>

      {/* Sticky header */}
      <div style={{ background: 'rgba(255,255,255,.96)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${BORDER}`, padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 14, position: 'sticky', top: 0, zIndex: 200 }}>
        <button onClick={() => navigate(-1)}
          style={{ background: `${A}15`, border: 'none', cursor: 'pointer', color: A, padding: '8px 14px', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: FONT }}>
          ← Back
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: INK, fontFamily: FONT }}>Privacy Policy</div>
          <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>Effective: 1 June 2025 · Akoro Technologies Ltd</div>
        </div>
        <button onClick={() => navigate('/terms')}
          style={{ background: `${A}15`, border: `1px solid ${A}40`, cursor: 'pointer', color: A, padding: '7px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, fontFamily: FONT }}>
          Terms of Service →
        </button>
      </div>

      {/* Hero */}
      <div style={{ background: `linear-gradient(135deg, ${A} 0%, #C07020 100%)`, padding: '44px 24px 48px', textAlign: 'center' }}>
        <div style={{ fontSize: 44, marginBottom: 10 }}>🔒</div>
        <h1 style={{ fontSize: 'clamp(22px,3.5vw,32px)', fontWeight: 700, color: WHITE, marginBottom: 12, fontFamily: FONT }}>Instructor Privacy Policy</h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,.85)', maxWidth: 520, margin: '0 auto 22px', lineHeight: 1.7, fontFamily: FONT }}>
          We collect only what we need to run the platform and pay you fairly. Your course content and your students' data are never sold.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {['NDPR Compliant','GDPR Aligned','TLS Encrypted','No Data Selling','DPA Available'].map(b => (
            <span key={b} style={{ background: 'rgba(255,255,255,.2)', border: '1px solid rgba(255,255,255,.35)', borderRadius: 20, padding: '4px 12px', fontSize: 11, fontWeight: 700, color: WHITE, fontFamily: FONT }}>{b}</span>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '32px 24px 80px' }}>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 32 }}>
          {[
            { icon: '🚫', title: 'No data selling', desc: 'We never sell your data or your students\' data.' },
            { icon: '🤖', title: 'AI content stays yours', desc: 'Training materials are only used for your courses.' },
            { icon: '🔐', title: 'Encrypted', desc: 'TLS in transit, encrypted at rest.' },
            { icon: '✏️', title: 'Full control', desc: 'Access, edit, export or delete any time.' },
          ].map(({ icon, title, desc }) => (
            <div key={title} style={{ background: WHITE, borderRadius: 12, padding: '16px', border: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 24 }}>{icon}</span>
              <div style={{ fontSize: 13, fontWeight: 700, color: INK, fontFamily: FONT }}>{title}</div>
              <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.5, fontFamily: FONT }}>{desc}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '210px minmax(0,1fr)', gap: 28, alignItems: 'start' }}>

          {/* TOC */}
          <div style={{ position: 'sticky', top: 80 }}>
            <div style={{ background: WHITE, borderRadius: 12, padding: '14px', border: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED, marginBottom: 10, fontFamily: FONT }}>Contents</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {TOC.map(({ id, title, icon }) => (
                  <button key={id} className="ip-toc-btn" onClick={() => scrollTo(id)}
                    style={{ background: active === id ? `${A}14` : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '7px 10px', borderRadius: 8, fontSize: 12, fontWeight: active === id ? 700 : 500, color: active === id ? A : '#4B5563', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 8, transition: 'all .15s' }}>
                    <span style={{ fontSize: 13 }}>{icon}</span>{title}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Content */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: `${A}10`, borderRadius: 12, padding: '18px 20px', borderLeft: `4px solid ${A}` }}>
              <p style={{ fontSize: 13.5, lineHeight: 1.8, color: INK, fontFamily: FONT }}>
                <strong>Akoro Technologies Ltd</strong> ("Akoro", "we", "us") operates the Akoro Instructor portal. This policy explains what data we collect from instructors, how we use it, and your rights. It also covers your obligations regarding the student data you access through our platform.
              </p>
            </div>

            {SECTIONS.map(({ id, icon, title, badge, badgeColor, body }) => (
              <div key={id} id={id} className="ip-section"
                style={{ background: WHITE, borderRadius: 14, overflow: 'hidden', border: `1px solid ${BORDER}` }}>
                <div style={{ padding: '18px 22px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 10, background: `${badgeColor}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{icon}</div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, fontFamily: FONT }}>{title}</h2>
                      <span style={{ background: `${badgeColor}12`, color: badgeColor, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>{badge}</span>
                    </div>
                  </div>
                </div>
                <div style={{ padding: '14px 22px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {body.map(({ subtitle, text }) => (
                    <div key={subtitle}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: INK, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: FONT }}>{subtitle}</div>
                      <p style={{ fontSize: 13.5, lineHeight: 1.75, color: MUTED, fontFamily: FONT }}>{text}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Contact */}
            <div style={{ background: `${A}10`, borderRadius: 14, padding: '26px 22px', border: `1px solid ${A}30`, textAlign: 'center' }}>
              <div style={{ fontSize: 34, marginBottom: 10 }}>💌</div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: INK, marginBottom: 8, fontFamily: FONT }}>Questions about your data?</h3>
              <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.6, marginBottom: 18, fontFamily: FONT }}>We respond to all requests within 30 days.</p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                <a href="mailto:privacy@akoro.app"
                  style={{ background: A, color: WHITE, padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700, textDecoration: 'none', fontFamily: FONT }}>
                  privacy@akoro.app
                </a>
                <button onClick={() => navigate('/terms')}
                  style={{ background: WHITE, color: A, border: `1.5px solid ${A}40`, padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                  Read Terms of Service
                </button>
              </div>
            </div>

            <p style={{ fontSize: 11, color: MUTED, textAlign: 'center', lineHeight: 1.6, fontFamily: FONT }}>
              Akoro Technologies Ltd · RC 1234567 · Lagos, Nigeria<br/>
              Last updated: 1 June 2025
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
