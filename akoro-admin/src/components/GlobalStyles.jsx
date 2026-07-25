export default function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Instrument+Serif:ital@0;1&display=swap');

      *, *::before, *::after { box-sizing: border-box; }

      body {
        font-family: 'DM Sans', sans-serif;
        background: #FAF8F5;
        color: #1A1A2E;
        -webkit-font-smoothing: antialiased;
      }

      @keyframes fade-up {
        from { opacity: 0; transform: translateY(16px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      @keyframes fade-in {
        from { opacity: 0; }
        to   { opacity: 1; }
      }

      @keyframes sheet-up {
        from { transform: translateY(100%); opacity: 0; }
        to   { transform: translateY(0);    opacity: 1; }
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      @keyframes shimmer {
        0%   { background-position: -200% 0; }
        100% { background-position:  200% 0; }
      }

      @keyframes pulse-dot {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%       { opacity: .5; transform: scale(.85); }
      }

      @keyframes typing-dot {
        0%, 80%, 100% { transform: scale(0.6); opacity: .4; }
        40%            { transform: scale(1);   opacity: 1; }
      }

      @keyframes progress-bar {
        from { width: 0%; }
        to   { width: 100%; }
      }

      .fade-up {
        animation: fade-up 0.4s ease both;
      }

      .fade-in {
        animation: fade-in 0.3s ease both;
      }

      /* Layout */
      .layout {
        display: flex;
        height: 100vh;
        overflow: hidden;
      }

      .sidebar {
        width: 240px;
        flex-shrink: 0;
        background: #1A1A2E;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
      }

      .main-content {
        flex: 1;
        overflow-y: auto;
        background: #FAF8F5;
      }

      /* Scrollbar */
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #EDE8E1; border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: #D4CFC8; }

      /* Skeleton shimmer */
      .skeleton {
        background: linear-gradient(90deg, #EDE8E1 25%, #F5F2EE 50%, #EDE8E1 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
        border-radius: 8px;
      }

      /* Mobile bottom nav */
      @media (max-width: 768px) {
        .sidebar { display: none; }
        .main-content { padding-bottom: 80px; }
        .sidebar-toggle { display: none !important; }
      }
    `}</style>
  );
}
