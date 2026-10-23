import React from 'react';
import ReactDOM from 'react-dom/client';
import '@tabler/icons-webfont/dist/tabler-icons.min.css';
import './ui/base.css';
import { ThemeProvider, learnerVars, applyTheme, readMode } from './ui/theme.jsx';
import { INSTRUCTOR_VARS } from './theme/instructorVars.js';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ConfirmHost from './components/ConfirmHost.jsx';
import ConnectionBanner from './components/ConnectionBanner.jsx';

// The learner app's look: its theme (light + dark) and Nunito. The shared
// kit's base styles apply under <html data-ui="next">.
document.documentElement.setAttribute('data-ui', 'next');
const themeVars = (isDark) => ({ ...learnerVars(isDark), ...INSTRUCTOR_VARS });
const font = document.createElement('link');
font.rel = 'stylesheet';
font.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap';
document.head.appendChild(font);
applyTheme(readMode(), { vars: themeVars, dark: true });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider vars={themeVars} dark>
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
