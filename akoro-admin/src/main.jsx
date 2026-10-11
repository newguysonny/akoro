import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

// Akoro design-system Tailwind layer (Tiers & Credits etc.) — preflight is off.
import './tailwind.css';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ConfirmHost from './components/ConfirmHost.jsx';
import ConnectionBanner from './components/ConnectionBanner.jsx';

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
