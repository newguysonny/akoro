import { useNavigate } from 'react-router-dom';
import { AMBER, INK, MUTED, BORDER, WHITE, LIGHT, FONT } from '../constants.js';

const SECTIONS = [
  {
    title: '1. Information We Collect',
    body: `We collect information you provide when registering as an instructor, including your name, email address, institution affiliation, and payment details. We also collect platform usage data such as course creation history, student management actions, session schedules, and AI training interactions.`,
  },
  {
    title: '2. How We Use Your Information',
    body: `We use your information to provide the Akoro Instructor platform, process subscription payments, send notifications about student activity and platform updates, generate analytics and earnings reports, and improve AI training capabilities. We do not sell your personal data.`,
  },
  {
    title: '3. Student Data Access',
    body: `As an instructor, you may access student progress data, session recordings, and assessment results for students enrolled in your courses. You agree to use this data solely for legitimate educational purposes and to comply with applicable student privacy laws (including NDPR, FERPA, and GDPR where applicable).`,
  },
  {
    title: '4. Data Sharing',
    body: `We share data only with trusted service providers (cloud infrastructure, payment processors, email delivery) under strict confidentiality obligations. We do not share your personal data with advertisers. We may disclose data where required by law or to protect user safety.`,
  },
  {
    title: '5. AI Training Data',
    body: `Content you upload to train AI agents (lesson materials, transcripts, notes) is processed to build course-specific knowledge models. This content is not used to train general-purpose AI models or shared with other instructors without your consent.`,
  },
  {
    title: '6. Data Retention',
    body: `We retain your account data while your account is active. Course and student data is retained for a minimum of 12 months after the last active session to support academic records requests. You may request account deletion at privacy@akoro.app; student records may be retained to comply with legal obligations.`,
  },
  {
    title: '7. Security',
    body: `All data is encrypted in transit (TLS 1.2+) and sensitive data is encrypted at rest. Access to platform data is restricted by role-based permissions. We conduct regular security reviews. In the event of a data breach affecting your account we will notify you within 72 hours.`,
  },
  {
    title: '8. Your Rights',
    body: `You may access, correct, or export your personal data via the Profile and Settings pages. For data deletion or portability requests, email privacy@akoro.app. We will respond within 30 days.`,
  },
  {
    title: '9. Cookies',
    body: `We use strictly necessary cookies for authentication and session management. Optional analytics cookies help us understand platform usage patterns. You may disable optional cookies in your browser without affecting core platform functionality.`,
  },
  {
    title: '10. Changes to This Policy',
    body: `We may update this Privacy Policy. Material changes will be communicated via email at least 14 days before taking effect. Continued use of the platform after changes take effect constitutes acceptance.`,
  },
  {
    title: '11. Contact',
    body: `Privacy questions or requests:\n\nAkoro Technologies Ltd\nprivacy@akoro.app`,
  },
];

export default function PrivacyPolicyPage() {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', background: LIGHT, fontFamily: FONT }}>
      {/* Header */}
      <div style={{ background: WHITE, borderBottom: `1px solid ${BORDER}`, padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 14, position: 'sticky', top: 0, zIndex: 100 }}>
        <button onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: AMBER, padding: 4 }}>
          ←
        </button>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: INK, fontFamily: FONT }}>Privacy Policy</div>
          <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>Last updated: June 2025</div>
        </div>
      </div>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 24px 60px' }}>
        {/* Intro */}
        <div style={{ background: `${AMBER}12`, borderRadius: 12, padding: '16px 20px', marginBottom: 24, borderLeft: `4px solid ${AMBER}` }}>
          <p style={{ fontSize: 13, lineHeight: 1.7, color: INK, fontFamily: FONT }}>
            Akoro Technologies Ltd ("Akoro", "we", "us") is committed to protecting the privacy of instructors and the students in their care. This policy explains what data we collect and how we use it within the Akoro Instructor platform.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {SECTIONS.map(({ title, body }) => (
            <div key={title} style={{ background: WHITE, borderRadius: 12, padding: '18px 20px', border: `1px solid ${BORDER}` }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: INK, fontFamily: FONT, marginBottom: 10 }}>{title}</h2>
              <p style={{ fontSize: 13, lineHeight: 1.75, color: MUTED, fontFamily: FONT, whiteSpace: 'pre-line' }}>{body}</p>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 28, textAlign: 'center' }}>
          <button onClick={() => navigate('/terms')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: AMBER, fontSize: 13, fontWeight: 600, fontFamily: FONT, textDecoration: 'underline' }}>
            View Terms of Service
          </button>
        </div>
      </div>
    </div>
  );
}
