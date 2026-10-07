import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, REDIRECT_KEY } from '../../contexts/AuthContext.jsx';
import { BRAND, FONT } from '../../constants.js';

/**
 * Landing page for the Google OAuth round-trip. The session cookie is already
 * set by the backend (HttpOnly, agent-scoped) — only the safe user blob comes
 * back on the URL, so there is no fetch here to fail.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const { restoreFromCallback } = useAuth();
  const [status, setStatus] = useState('Processing…');

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const errParam = params.get('error');
      const userRaw = params.get('user');

      if (errParam) {
        setStatus('Sign-in failed. Redirecting…');
        setTimeout(() => navigate(`/signin?error=${errParam}`, { replace: true }), 1400);
        return;
      }
      if (!userRaw) {
        setStatus('Missing session data. Redirecting…');
        setTimeout(() => navigate('/signin', { replace: true }), 1400);
        return;
      }

      restoreFromCallback(JSON.parse(decodeURIComponent(userRaw)));
      const redirect = localStorage.getItem(REDIRECT_KEY) || '/';
      localStorage.removeItem(REDIRECT_KEY);
      setStatus('Signed in! Redirecting…');
      navigate(redirect, { replace: true });
    } catch {
      setStatus('Something went wrong. Redirecting…');
      setTimeout(() => navigate('/signin', { replace: true }), 1400);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB', fontFamily: FONT }}>
      <div style={{ width: 44, height: 44, borderRadius: '50%', border: `3px solid ${BRAND}22`, borderTop: `3px solid ${BRAND}`, animation: 'spin .8s linear infinite', marginBottom: 18 }} />
      <p style={{ fontSize: 14.5, fontWeight: 700, color: '#374151' }}>{status}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
