import { useNavigate } from 'react-router-dom';
import { AMBER, INK, MUTED, BORDER, WHITE, LIGHT, FONT } from '../constants.js';

const SECTIONS = [
  {
    title: '1. Acceptance of Terms',
    body: `By accessing or using the Akoro Instructor platform you agree to be bound by these Terms of Service and our Privacy Policy. If you do not agree, do not use the platform. These terms apply to all instructors, administrators, and institution representatives.`,
  },
  {
    title: '2. Description of Service',
    body: `Akoro provides instructors with tools to create and manage courses, schedule live classes, train AI learning agents, monitor student progress, manage enrollments, and engage students through AI-powered battles and assessments.`,
  },
  {
    title: '3. Account & Eligibility',
    body: `You must be at least 18 years old and provide accurate registration information. Instructor accounts are intended for qualified educators and educational institutions. Akoro reserves the right to verify credentials and suspend accounts that misrepresent qualifications.`,
  },
  {
    title: '4. Instructor Responsibilities',
    body: `As an instructor you agree to:\n• Only enroll students with their (or their guardian's) consent\n• Ensure uploaded course content does not infringe third-party intellectual property rights\n• Comply with applicable educational regulations in your jurisdiction\n• Maintain appropriate student-teacher professional standards\n• Not use the platform to collect student data beyond what is needed for education`,
  },
  {
    title: '5. Content & Intellectual Property',
    body: `You retain ownership of original course materials you create. By uploading content you grant Akoro a non-exclusive licence to host and deliver that content to your enrolled students. Akoro owns the platform, AI models, and all related software. You may not copy, distribute, or reverse-engineer any part of the platform.`,
  },
  {
    title: '6. AI Training',
    body: `Content you upload to train AI agents is used to build knowledge models specific to your courses. You represent that you have the necessary rights to upload all training materials. Akoro does not use your proprietary training content to train AI models for other instructors without explicit consent.`,
  },
  {
    title: '7. Fees & Payments',
    body: `Instructor subscriptions are billed according to the selected plan. Akoro may adjust pricing with 30 days' notice. Revenue sharing from student course purchases is governed by your instructor agreement. Disputes must be raised within 60 days of the charge.`,
  },
  {
    title: '8. Student Data Obligations',
    body: `You act as a data processor for student personal data within your courses. You agree to process student data only for legitimate educational purposes, maintain appropriate security measures, and not share student data with unauthorised third parties. You must promptly notify Akoro of any student data breach in your systems.`,
  },
  {
    title: '9. Disclaimers',
    body: `The platform is provided "as is". Akoro does not guarantee the accuracy of AI-generated assessments or feedback. Instructors should exercise professional judgment and not rely solely on AI outputs for grading or student evaluation. Akoro is not liable for outcomes resulting from AI-generated content.`,
  },
  {
    title: '10. Termination',
    body: `Either party may terminate the agreement with 30 days' written notice. Akoro may immediately suspend accounts for serious breaches (e.g., misuse of student data, illegal content). Upon termination, you retain access to export your course materials for 30 days; student data is handled per our Privacy Policy and applicable law.`,
  },
  {
    title: '11. Governing Law',
    body: `These Terms are governed by the laws of the Federal Republic of Nigeria. Disputes shall first be addressed through good-faith negotiation, then submitted to binding arbitration in Lagos, Nigeria, unless otherwise required by applicable law.`,
  },
  {
    title: '12. Changes to These Terms',
    body: `We may update these Terms with 14 days' notice for material changes. Your continued use after the effective date constitutes acceptance. If you do not accept updated terms, you must stop using the platform and may request account closure.`,
  },
  {
    title: '13. Contact',
    body: `Questions about these Terms:\n\nAkoro Technologies Ltd\nlegal@akoro.app`,
  },
];

export default function TermsOfServicePage() {
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
          <div style={{ fontSize: 16, fontWeight: 700, color: INK, fontFamily: FONT }}>Terms of Service</div>
          <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>Last updated: June 2025</div>
        </div>
      </div>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 24px 60px' }}>
        {/* Intro */}
        <div style={{ background: `${AMBER}12`, borderRadius: 12, padding: '16px 20px', marginBottom: 24, borderLeft: `4px solid ${AMBER}` }}>
          <p style={{ fontSize: 13, lineHeight: 1.7, color: INK, fontFamily: FONT }}>
            Please read these Terms carefully. They govern your use of the Akoro Instructor platform and your responsibilities as an educator using Akoro to manage student learning.
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
          <button onClick={() => navigate('/privacy')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: AMBER, fontSize: 13, fontWeight: 600, fontFamily: FONT, textDecoration: 'underline' }}>
            View Privacy Policy
          </button>
        </div>
      </div>
    </div>
  );
}
