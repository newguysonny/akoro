import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ConfirmHost from './components/ConfirmHost.jsx';
import ConnectionBanner from './components/ConnectionBanner.jsx';
import MobileGate from './components/MobileGate.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <MobileGate product="admin console">
        <App />
      </MobileGate>
      {/* One host for every confirmDialog() call in the app. */}
      <ConfirmHost />
      {/* Explains an outage that pages would otherwise render as "nothing here". */}
      <ConnectionBanner />
    </ErrorBoundary>
  </React.StrictMode>
);
