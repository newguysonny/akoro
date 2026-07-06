import React from 'react';
import ReactDOM from 'react-dom/client';
import { io } from 'socket.io-client';
import App from './App.jsx';
import './index.css';

// The teaching/decay sessions and live cognitive state connect through a
// global `window.io` (the socket.io client). Expose it once here so every
// component that calls `window.io(API, …)` has a real client available.
if (typeof window !== 'undefined') window.io = io;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
