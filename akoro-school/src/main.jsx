import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ConfirmHost from './components/ConfirmHost.jsx';
import ConnectionBanner from './components/ConnectionBanner.jsx';

/**
 * School ADMIN portal — this deployment ALWAYS renders the portal app.
 *
 * Public school websites (wildcard subdomains <slug>.akoro.name.ng and
 * verified custom domains) are served by the LEARNER deployment, which holds
 * the wildcard and forwards tenant hosts to the API. So this app never needs
 * to render a tenant site, and its own custom domain (e.g.
 * akoro-school.akoro.name.ng) can never fall through to a "no school" 404.
 */
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
      {/* One host for every confirmDialog() call in the app. */}
      <ConfirmHost />
      {/* Explains an outage that pages would otherwise render as "nothing here". */}
      <ConnectionBanner />
    </ErrorBoundary>
  </React.StrictMode>
);
