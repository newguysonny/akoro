import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import AkoroLogo from '../../components/common/AkoroLogo.jsx';

const AMBER = '#E8884A';

export default function OnboardingPage() {
  const navigate  = useNavigate();
  const { user, markOnboarded, logout } = useAuth();

  const finish = async () => {
    await markOnboarded?.();
    navigate('/', { replace: true });
  };

  // If already onboarded, skip straight to dashboard
  useEffect(() => {
    if (user?.onboardingCompleted) navigate('/', { replace: true });
  }, [user, navigate]);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#FAF8F5',
      padding: '24px 20px', fontFamily: "'DM Sans', sans-serif",
    }}>
      {/* Escape hatch: never get stuck on onboarding */}
      <button onClick={logout} style={{ position: 'fixed', top: 16, right: 18, zIndex: 50, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, border: '1px solid rgba(0,0,0,0.12)', background: 'rgba(255,255,255,0.92)', color: '#6B6B80', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Log out</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 40 }}>
        <AkoroLogo size={44} radius={13} />
        <div>
          <span style={{ fontSize: 22, fontWeight: 800, color: '#1A1A2E', display: 'block' }}>Akoro</span>
          <span style={{ fontSize: 11, color: '#9490A0', display: 'block', marginTop: -2 }}>Admin Portal</span>
        </div>
      </div>

      <div style={{
        width: '100%', maxWidth: 460, background: '#fff', borderRadius: 24,
        padding: '40px 36px', boxShadow: '0 4px 32px rgba(0,0,0,.07)',
        border: '1px solid #EDE8E1', textAlign: 'center',
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: `linear-gradient(135deg, ${AMBER}, #D4651E)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, margin: '0 auto 20px',
        }}>
          🛡️
        </div>

        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#1A1A2E', margin: '0 0 10px', fontFamily: "'Instrument Serif', serif" }}>
          Welcome, {user?.fullName?.split(' ')[0] || 'Admin'}
        </h1>
        <p style={{ fontSize: 14, color: '#6B6B80', margin: '0 0 32px', lineHeight: 1.7 }}>
          You have full administrative access to the Akoro platform. Manage users, courses, content, payments, and platform settings from your dashboard.
        </p>

        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 32,
        }}>
          {[
            ['👥', 'Users & Instructors', 'Manage accounts and permissions'],
            ['📚', 'Courses & Content', 'Review and moderate all content'],
            ['💳', 'Payments', 'Track revenue and process refunds'],
            ['📊', 'Analytics', 'Monitor platform growth'],
          ].map(([emoji, title, desc]) => (
            <div key={title} style={{
              background: '#FAF8F5', borderRadius: 12, padding: '14px 12px',
              border: '1px solid #EDE8E1', textAlign: 'left',
            }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{emoji}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1A1A2E', marginBottom: 2 }}>{title}</div>
              <div style={{ fontSize: 11, color: '#9490A0' }}>{desc}</div>
            </div>
          ))}
        </div>

        <button
          onClick={finish}
          style={{
            width: '100%', padding: '14px', borderRadius: 14, border: 'none',
            background: `linear-gradient(135deg, ${AMBER}, #D4651E)`,
            color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
            fontFamily: "'DM Sans', sans-serif",
            boxShadow: `0 4px 14px ${AMBER}44`,
          }}
        >
          Go to Dashboard →
        </button>
      </div>
    </div>
  );
}
