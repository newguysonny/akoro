/**
 * chat-main — entry point for the DEDICATED standalone AI-chat build.
 *
 * This is a separate Vite entry from the main portal app (main.jsx). It is
 * built with base '/ai-chat/' (see vite.chat.config.js) and deployed so the
 * public school website can serve the AI assistant at
 *   https://<school-domain>/ai-chat
 * on its OWN origin — so the session cookie set by the ?ai= hand-off exchange
 * is same-origin and sticks (no cross-site cookie problem).
 *
 * It mounts ONLY the AI chat: AuthProvider (which performs the ?ai= hand-off
 * exchange) wrapping a small gate that waits for the session before rendering
 * AiChatPage. No router, no sidebar, no rest of the portal.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import AiChatPage from './pages/AiChatPage.jsx';
import { FONT, INK, MUTED, AMBER } from './constants.js';

function Centered({ children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24,
      fontFamily: FONT, background: '#FAF8F5', textAlign: 'center' }}>
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ width: 34, height: 34, borderRadius: '50%',
      border: `3px solid ${AMBER}33`, borderTopColor: AMBER, animation: 'spin .8s linear infinite' }} />
  );
}

function Gate() {
  const { booting, isAuthenticated, handoffError } = useAuth();

  if (booting) {
    return (
      <Centered>
        <Spinner />
        <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>Signing you in…</div>
        <div style={{ fontSize: 13, color: MUTED }}>Connecting you to your school's AI assistant.</div>
      </Centered>
    );
  }

  if (isAuthenticated) return <AiChatPage />;

  // No session — the hand-off token was missing, expired, or the cookie didn't
  // stick. Send the visitor back to sign in from their school website.
  return (
    <Centered>
      <div style={{ fontSize: 34 }}>🔒</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: INK }}>Please sign in first</div>
      <div style={{ fontSize: 13.5, color: MUTED, maxWidth: 340, lineHeight: 1.55 }}>
        {handoffError
          ? "We couldn't complete your sign-in. Head back to your school website and open the AI assistant again."
          : "Open the AI assistant from your school website to start chatting."}
      </div>
    </Centered>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <Gate />
    </AuthProvider>
  </React.StrictMode>
);
