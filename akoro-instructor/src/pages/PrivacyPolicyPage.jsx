import { Archive, Bot, ClipboardList, GraduationCap, Link2, Lock, Scale, Settings } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LegalShell } from '../shared/LegalShell.jsx';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const A = C.brand;

const SECTIONS = [
  {
    id: 'what-we-collect',
    icon: ClipboardList, ti: 'ti-clipboard-list',
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
    icon: Settings, ti: 'ti-settings',
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
    icon: GraduationCap, ti: 'ti-school',
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
    icon: Bot, ti: 'ti-robot',
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
    icon: Link2, ti: 'ti-link',
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
    icon: Lock, ti: 'ti-lock',
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
    icon: Archive, ti: 'ti-archive',
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
    icon: Scale, ti: 'ti-scale',
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

const TOC = SECTIONS.map(({ id, title, ti }) => ({ id, title, ti }));

const HIGHLIGHTS = [
  { ti: 'ti-ban', title: 'No data selling', desc: 'We never sell your data or your students\' data.' },
  { ti: 'ti-robot', title: 'AI content stays yours', desc: 'Training materials are only used for your courses.' },
  { ti: 'ti-lock', title: 'Encrypted', desc: 'TLS in transit, encrypted at rest.' },
  { ti: 'ti-pencil', title: 'Full control', desc: 'Access, edit, export or delete any time.' },
];

const TRUST = ['NDPR Compliant', 'GDPR Aligned', 'TLS Encrypted', 'No Data Selling', 'DPA Available'];

export default function PrivacyPolicyPage() {
  const navigate = useNavigate();
  const [active, setActive] = useState(null);

  const scrollTo = (id) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <LegalShell title="Instructor Privacy Policy" updated="1 June 2025" onBack={() => navigate(-1)}>
      <style>{`
        .ip-toc-btn:hover{background:${tint(9, A)}!important;color:${A}!important}
        .ip-section{scroll-margin-top:80px}
      `}</style>

      <p style={introP}>
        We collect only what we need to run the platform and pay you fairly. Your course content and your students' data are never sold.
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '0 0 12px' }}>
        {TRUST.map(b => (
          <span key={b} style={{ background: tint(8, A), border: `1px solid ${tint(20, A)}`, borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: A, fontFamily: C.font }}>{b}</span>
        ))}
      </div>
      <button type="button" onClick={() => navigate('/terms')} style={linkBtn}>Terms of Service →</button>

      {/* Summary cards */}
      <div style={cardGrid}>
        {HIGHLIGHTS.map(({ ti, title, desc }) => (
          <div key={title} style={summaryCard}>
            <Ico ti={ti} size={20} color={A} />
            <div style={summaryTitle}>{title}</div>
            <div style={summaryDesc}>{desc}</div>
          </div>
        ))}
      </div>

      {/* TOC */}
      <div style={{ marginBottom: 22 }}>
        <div style={tocLabel}>Contents</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {TOC.map(({ id, title, ti }) => (
            <button key={id} className="ip-toc-btn" onClick={() => scrollTo(id)}
              style={{ background: active === id ? tint(8, A) : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '6px 9px', borderRadius: 8, fontSize: 12, fontWeight: active === id ? 800 : 600, color: active === id ? A : '#4B5563', fontFamily: C.font, display: 'flex', alignItems: 'center', gap: 6, transition: 'all .15s' }}>
              <Ico ti={ti} size={13} />{title}
            </button>
          ))}
        </div>
      </div>

      <div style={lead}>
        <p style={{ ...bodyText, color: C.ink }}>
          <strong>Akoro Technologies Ltd</strong> ("Akoro", "we", "us") operates the Akoro Instructor portal. This policy explains what data we collect from instructors, how we use it, and your rights. It also covers your obligations regarding the student data you access through our platform.
        </p>
      </div>

      {SECTIONS.map(({ id, ti, title, badge, badgeColor, body }) => (
        <div key={id} id={id} className="ip-section" style={{ marginBottom: 22 }}>
          <div style={sectionHead}>
            <span style={{ width: 36, height: 36, borderRadius: 10, background: tint(9, badgeColor), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Ico ti={ti} size={18} color={A} />
            </span>
            <h2 style={sectionTitle}>{title}</h2>
            <span style={{ ...badgePill, background: tint(9, badgeColor), color: badgeColor }}>{badge}</span>
          </div>
          {body.map(({ subtitle, text }) => (
            <div key={subtitle} style={{ marginBottom: 10 }}>
              <div style={subTitle}>{subtitle}</div>
              <p style={bodyText}>{text}</p>
            </div>
          ))}
        </div>
      ))}

      {/* Contact */}
      <div style={contact}>
        <div style={{ marginBottom: 10 }}><Ico ti="ti-mail" size={30} color={A} /></div>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: C.ink, marginBottom: 8, fontFamily: C.font }}>Questions about your data?</h3>
        <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 18, fontFamily: C.font }}>We respond to all requests within 30 days.</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="mailto:privacy@akoro.app"
            style={{ background: A, color: '#fff', padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700, textDecoration: 'none', fontFamily: C.font }}>
            privacy@akoro.app
          </a>
          <button onClick={() => navigate('/terms')}
            style={{ background: C.surface, color: A, border: `1.5px solid ${tint(25, A)}`, padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}>
            Read Terms of Service
          </button>
        </div>
      </div>

      <p style={footer}>
        Akoro Technologies Ltd · RC 1234567 · Lagos, Nigeria<br/>
        Last updated: 1 June 2025
      </p>
    </LegalShell>
  );
}

const introP = { fontSize: 14, lineHeight: 1.7, color: C.muted, margin: '0 0 8px', fontFamily: C.font };
const linkBtn = { background: 'none', border: 'none', padding: 0, color: A, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: C.font, marginBottom: 18 };
const cardGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 22 };
const summaryCard = { background: tint(4, A), borderRadius: 12, padding: 12, border: `1px solid ${tint(14, A)}`, display: 'flex', flexDirection: 'column', gap: 4, fontFamily: C.font };
const summaryTitle = { fontSize: 13, fontWeight: 800, color: C.ink, fontFamily: C.font };
const summaryDesc = { fontSize: 12, color: C.muted, lineHeight: 1.5, fontFamily: C.font };
const tocLabel = { fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted, marginBottom: 8, fontFamily: C.font };
const lead = { background: tint(6, A), borderRadius: 12, padding: '14px 16px', borderLeft: `4px solid ${A}`, marginBottom: 22 };
const sectionHead = { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' };
const sectionTitle = { fontSize: 16, fontWeight: 800, color: C.ink, margin: 0, fontFamily: C.font };
const badgePill = { fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, fontFamily: C.font };
const subTitle = { fontSize: 11, fontWeight: 800, color: C.ink, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: C.font };
const bodyText = { fontSize: 14, lineHeight: 1.7, color: C.muted, margin: 0, fontFamily: C.font, whiteSpace: 'pre-line' };
const contact = { background: tint(6, A), borderRadius: 12, padding: '22px 18px', border: `1px solid ${tint(19, A)}`, textAlign: 'center', marginBottom: 18 };
const footer = { fontSize: 11, color: C.muted, textAlign: 'center', lineHeight: 1.6, fontFamily: C.font, margin: 0 };
