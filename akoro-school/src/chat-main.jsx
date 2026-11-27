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
import '@tabler/icons-webfont/dist/tabler-icons.min.css';
import './ui/base.css';
import { ThemeProvider, learnerVars, applyTheme, readMode } from './ui/theme.jsx';
import { SCHOOL_VARS } from './theme/schoolVars.js';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import SiteSignIn from './pages/ai-chat/SiteSignIn.jsx';
import { entryUrlInfo, API } from './services/api.js';
import AiChatPage from './pages/AiChatPage.jsx';
import { C, tint } from './theme/colors.js';

// The learner app's look, same as the portal's (main.jsx): the chat page is
// shared with the portal, so this build bootstraps the same theme — its
// colours come from the theme variables, not the legacy constants.
document.documentElement.setAttribute('data-ui', 'next');
const themeVars = (isDark) => ({ ...learnerVars(isDark), ...SCHOOL_VARS });
const font = document.createElement('link');
font.rel = 'stylesheet';
font.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap';
document.head.appendChild(font);
applyTheme(readMode(), { vars: themeVars, dark: true });

function Centered({ children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24,
      fontFamily: C.font, background: C.bg, textAlign: 'center' }}>
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ width: 34, height: 34, borderRadius: '50%',
      border: `3px solid ${tint(20)}`, borderTopColor: C.brand, animation: 'spin .8s linear infinite' }} />
  );
}

function Gate() {
  const { booting, isAuthenticated, handoffError, handoffReason, exchangeHandoff } = useAuth();

  if (booting) {
    return (
      <Centered>
        <Spinner />
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>Signing you in…</div>
        <div style={{ fontSize: 13, color: C.muted }}>Connecting you to your school's AI assistant.</div>
      </Centered>
    );
  }

  if (isAuthenticated) return <AiChatPage />;

  // No session. This page is reachable straight from the school's menu — it
  // sits at /ai-chat on their own domain — so it signs the visitor in rather
  // than telling them to go and find the assistant they already opened.
  return (
    <Centered>
      <SiteSignIn onSignedIn={exchangeHandoff} />
      {handoffError && handoffReason && (
        <div style={{ fontSize: 12, color: C.muted, maxWidth: 340, lineHeight: 1.5 }}>{handoffReason}</div>
      )}
      <div style={{ fontSize: 10.5, color: C.muted2, maxWidth: 340, wordBreak: 'break-all' }}>
        API <code>{API}</code>
      </div>
    </Centered>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider vars={themeVars} dark>
    <AuthProvider>
      <Gate />
    </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
