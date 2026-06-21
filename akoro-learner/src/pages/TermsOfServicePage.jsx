import { useNavigate } from 'react-router-dom';
import { BRAND } from '../constants.js';

const SECTIONS = [
  {
    title: '1. Acceptance of Terms',
    body: `By accessing or using the Akoro platform you agree to be bound by these Terms of Service and our Privacy Policy. If you do not agree, please do not use the platform. If you are under 18, a parent or guardian must review and accept these terms on your behalf.`,
  },
  {
    title: '2. Description of Service',
    body: `Akoro is an AI-powered educational platform that enables students to learn by teaching a personalised AI agent. The platform includes live classes, AI tutoring sessions, peer battles, progress tracking, and related educational tools.`,
  },
  {
    title: '3. Account Registration',
    body: `You must create an account to access most features. You agree to provide accurate information and keep your credentials confidential. You are responsible for all activity under your account. Notify us immediately at support@akoro.app if you suspect unauthorised use.`,
  },
  {
    title: '4. Acceptable Use',
    body: `You agree not to:\n• Use the platform for any unlawful purpose\n• Attempt to reverse-engineer or extract AI model weights\n• Upload content that is harmful, abusive, or infringes intellectual property rights\n• Attempt to disrupt or compromise the platform's security or performance\n• Share your account credentials with others`,
  },
  {
    title: '5. Intellectual Property',
    body: `All platform content, AI models, software, and branding are the intellectual property of Akoro Technologies Ltd unless otherwise noted. You retain ownership of original content you create (e.g., lesson notes you upload). By submitting content you grant Akoro a licence to use it to operate and improve the service.`,
  },
  {
    title: '6. Subscriptions and Payments',
    body: `Certain features require a paid subscription. Prices are displayed at checkout and may change with 30 days' notice. Subscriptions auto-renew unless cancelled before the renewal date. Refund requests are handled on a case-by-case basis within 7 days of a charge. Contact billing@akoro.app for billing issues.`,
  },
  {
    title: '7. AI-Generated Content',
    body: `The platform uses AI to generate learning feedback, assessments, and summaries. AI-generated content is provided for educational purposes and may contain errors. Akoro does not guarantee the accuracy, completeness, or fitness for any particular purpose of AI-generated content. Always verify important information with qualified educators.`,
  },
  {
    title: '8. Privacy and Data',
    body: `Our collection and use of personal data is governed by our Privacy Policy. By using the platform you consent to our data practices as described therein. We take reasonable measures to protect your data, but cannot guarantee absolute security.`,
  },
  {
    title: '9. Third-Party Services',
    body: `The platform may integrate with third-party services (e.g., video conferencing, payment processors). Your use of those services is subject to their own terms and privacy policies. Akoro is not responsible for the practices of third-party providers.`,
  },
  {
    title: '10. Disclaimers',
    body: `The platform is provided "as is" without warranties of any kind. Akoro does not guarantee uninterrupted or error-free operation. To the maximum extent permitted by law, Akoro is not liable for indirect, incidental, or consequential damages arising from your use of the platform.`,
  },
  {
    title: '11. Termination',
    body: `We may suspend or terminate your account if you violate these Terms or engage in behaviour that harms other users or the platform. You may close your account at any time in Settings. Upon termination, your licence to use the platform ceases and we may delete your data in accordance with our retention policy.`,
  },
  {
    title: '12. Governing Law',
    body: `These Terms are governed by the laws of the Federal Republic of Nigeria. Disputes shall first be attempted to be resolved through good-faith negotiation. If unresolved, disputes shall be subject to the jurisdiction of the courts of Lagos State, Nigeria.`,
  },
  {
    title: '13. Changes to These Terms',
    body: `We may update these Terms from time to time. Material changes will be communicated via email or in-app notice at least 14 days before taking effect. Continued use after the effective date constitutes acceptance of the revised Terms.`,
  },
  {
    title: '14. Contact',
    body: `Questions about these Terms?\n\nAkoro Technologies Ltd\nlegal@akoro.app`,
  },
];

export default function TermsOfServicePage() {
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
            <div style={{ fontSize: 16, fontWeight: 900, color: '#1A1040' }}>Terms of Service</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600 }}>Last updated: June 2025</div>
          </div>
        </div>

        <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 20px 60px' }}>

          {/* Intro */}
          <div style={{ background: `${BRAND}10`, borderRadius: 16, padding: '18px 20px', marginBottom: 28, borderLeft: `4px solid ${BRAND}` }}>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: '#374151', fontWeight: 600 }}>
              Please read these Terms of Service carefully before using Akoro. These terms constitute a legally binding agreement between you and Akoro Technologies Ltd governing your use of the platform.
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
            <button onClick={() => navigate('/privacy')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: BRAND, fontSize: 13, fontWeight: 700, textDecoration: 'underline' }}>
              View Privacy Policy
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
