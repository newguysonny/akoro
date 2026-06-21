import AkoroLogo from '../../components/common/AkoroLogo.jsx';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, REDIRECT_KEY } from '../../contexts/AuthContext.jsx';

const AMBER = '#E8884A';

export default function AuthCallback() {
  const navigate                = useNavigate();
  const { restoreFromCallback } = useAuth();
  const [status, setStatus]     = useState('Processing...');

  useEffect(() => {
    try {
      const params   = new URLSearchParams(window.location.search);
      const errParam = params.get('error');
      const userRaw  = params.get('user');

      if (errParam) {
        setStatus('Sign-in failed. Redirecting...');
        setTimeout(() => navigate(`/signin?error=${errParam}`), 1500);
        return;
      }

      if (!userRaw) {
        setStatus('Missing session data. Redirecting...');
        setTimeout(() => navigate('/signin'), 1500);
        return;
      }

      const userObj = JSON.parse(decodeURIComponent(userRaw));

      // Role guard — only admins can use this portal
      if (userObj.role !== 'admin') {
        setStatus('Access denied. Redirecting...');
        setTimeout(() => navigate('/signin?error=not_admin'), 1500);
        return;
      }

      restoreFromCallback(userObj);

      const redirect = localStorage.getItem(REDIRECT_KEY) || '/';
      localStorage.removeItem(REDIRECT_KEY);

      setStatus('Signed in! Redirecting...');
      window.history.replaceState({}, document.title, '/auth/callback');
      navigate(redirect, { replace: true });

    } catch {
      setStatus('Something went wrong. Redirecting...');
      setTimeout(() => navigate('/signin'), 1500);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#FAF8F5',
      fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ width: 48, height: 48, borderRadius: '50%',
        border: `3px solid ${AMBER}22`, borderTop: `3px solid ${AMBER}`,
        animation: 'spin 0.8s linear infinite', marginBottom: 20 }} />
      <p style={{ fontSize: 15, fontWeight: 700, color: '#1A1A2E' }}>{status}</p>
      <p style={{ fontSize: 12, color: '#9490A0', marginTop: 6 }}>Akoro · Admin Portal</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
