import React from 'react';
import ReactDOM from 'react-dom/client';
// The legacy/next switch first: it sets <html data-ui> before anything renders.
import { UI_MODE } from './theme/uiMode.js';
import '@tabler/icons-webfont/dist/tabler-icons.min.css';
import './ui/base.css';
import { ThemeProvider, learnerVars, applyTheme, readMode } from './ui/theme.jsx';
import { legacyVars, BX_NEXT } from './theme/legacyVars.js';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ConfirmHost from './components/ConfirmHost.jsx';
import ConnectionBanner from './components/ConnectionBanner.jsx';

// The next look: the learner's theme (light + dark) and Nunito. Legacy: today's colours, light only.
const next = UI_MODE === 'next';
const nextVars = (isDark) => ({ ...learnerVars(isDark), ...BX_NEXT });
const themeVars = next ? nextVars : legacyVars;
if (next) {
  const font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap';
  document.head.appendChild(font);
}
applyTheme(readMode(), { vars: themeVars, dark: next });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider vars={themeVars} dark={next}>
    <ErrorBoundary>
        <App />
      {/* One host for every confirmDialog() call in the app. */}
      <ConfirmHost />
      {/* Explains an outage that pages would otherwise render as "nothing here". */}
      <ConnectionBanner />
    </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>
);
