import { useNavigate } from 'react-router-dom';
import { BRAND } from '../constants.js';

const SECTIONS = [
  {
    title: '1. Information We Collect',
    body: `We collect information you provide directly, such as your name, email address, and educational profile when you create an account. We also automatically collect usage data including learning session history, assessment results, agent interactions, and device/browser information to personalise your learning experience.`,
  },
  {
    title: '2. How We Use Your Information',
    body: `We use your information to provide and improve the Akoro platform, personalise your AI agent's learning model, send notifications about live sessions and academic progress, generate progress reports, and communicate service updates. We do not sell your personal data to third parties.`,
  },
  {
    title: '3. Student Data',
    body: `Akoro is committed to protecting student data. We comply with applicable student privacy laws. Educational records are used solely to deliver the learning service and are never shared with advertisers. Teachers and institution administrators may access student progress data within their authorised scope.`,
  },
  {
    title: '4. Data Sharing',
    body: `We may share your information with trusted service providers who assist in operating the platform (cloud hosting, email delivery, analytics) under strict confidentiality agreements. We may disclose information if required by law or to protect the rights and safety of users.`,
  },
  {
    title: '5. Data Retention',
    body: `We retain your account data for as long as your account is active or as needed to provide services. You may request deletion of your account and associated data at any time by contacting support. Anonymised, aggregated usage data may be retained for research and platform improvement.`,
  },
  {
    title: '6. Cookies & Tracking',
    body: `We use essential cookies for authentication and session management. Optional analytics cookies help us understand how users interact with the platform. You can manage cookie preferences in your browser settings. We do not use cross-site advertising trackers.`,
  },
  {
    title: '7. Security',
    body: `We implement industry-standard security measures including encryption in transit (TLS), encrypted storage for sensitive data, and access controls. However, no internet transmission is completely secure; we encourage you to use a strong, unique password and enable any available two-factor authentication.`,
  },
  {
    title: '8. Children\'s Privacy',
    body: `Akoro is designed for use by students, including minors, under the supervision of educational institutions and parents/guardians. We do not knowingly collect personal data from children under 13 without verifiable parental or institutional consent. If you believe a child's data has been collected without consent, contact us immediately.`,
  },
  {
    title: '9. Your Rights',
    body: `Depending on your jurisdiction you may have rights to access, correct, export, or delete your personal data. You can update most information directly in your Settings page. For other requests, email us at privacy@akoro.app and we will respond within 30 days.`,
  },
  {
    title: '10. Changes to This Policy',
    body: `We may update this Privacy Policy from time to time. We will notify you of material changes via email or an in-app notice. Continued use of the platform after changes take effect constitutes acceptance of the revised policy.`,
  },
  {
    title: '11. Contact Us',
    body: `If you have questions or concerns about this Privacy Policy, please contact us at:\n\nAkoro Technologies Ltd\nprivacy@akoro.app`,
  },
];

export default function PrivacyPolicyPage() {
  const navigate = useNavigate();

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Nunito',sans-serif;background:#F3F1FF}
      `}</style>
      <div style={{ minHeight: '100vh', background: '#F3F1FF', fontFamily: "'Nunito', sans-serif" }}>

        {/* Header */}
        <div style={{ background: '#fff', borderBottom: '1px solid #E9E6FF', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14, position: 'sticky', top: 0, zIndex: 100 }}>
          <button onClick={() => navigate(-1)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: BRAND, lineHeight: 1, padding: 4 }}>
            ←
          </button>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#1A1040' }}>Privacy Policy</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600 }}>Last updated: June 2025</div>
          </div>
        </div>

        <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 20px 60px' }}>

          {/* Intro */}
          <div style={{ background: `${BRAND}10`, borderRadius: 16, padding: '18px 20px', marginBottom: 28, borderLeft: `4px solid ${BRAND}` }}>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: '#374151', fontWeight: 600 }}>
              Akoro Technologies Ltd ("Akoro", "we", "us") respects your privacy. This policy explains what data we collect, why we collect it, and how we protect it when you use the Akoro learning platform.
            </p>
          </div>

          {/* Sections */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {SECTIONS.map(({ title, body }) => (
              <div key={title} style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
                <h2 style={{ fontSize: 14, fontWeight: 800, color: '#1A1040', marginBottom: 10 }}>{title}</h2>
                <p style={{ fontSize: 13, lineHeight: 1.75, color: '#4B5563', whiteSpace: 'pre-line' }}>{body}</p>
              </div>
            ))}
          </div>

          {/* Footer links */}
          <div style={{ marginTop: 32, textAlign: 'center' }}>
            <button onClick={() => navigate('/terms')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: BRAND, fontSize: 13, fontWeight: 700, textDecoration: 'underline' }}>
              View Terms of Service
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
