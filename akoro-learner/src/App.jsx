import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import ErrorBoundary    from './components/common/ErrorBoundary.jsx';
import LearnerDashboard from './pages/LearnerDashboard.jsx';
import SettingsPage     from './pages/SettingsPage.jsx';
import SigninPage       from './pages/auth/SigninPage.jsx';
import SignupPage       from './pages/auth/SignupPage.jsx';
import AuthCallback     from './pages/auth/AuthCallback.jsx';
import NotFoundPage     from './pages/NotFoundPage.jsx';

/* ── ProtectedRoute: redirects to /signin if not authenticated ── */
function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) {
    // Store the path they wanted so we can restore after login
    localStorage.setItem('akoro_redirect', location.pathname + location.search);
    return <Navigate to="/signin" replace />;
  }
  return children;
}

/* ── GuestRoute: redirects to / if already signed in ─────────── */
function GuestRoute({ children }) {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Protected */}
      <Route path="/" element={
        <ProtectedRoute>
          <LearnerDashboard />
        </ProtectedRoute>
      }/>
      <Route path="/settings" element={
        <ProtectedRoute>
          <SettingsPage />
        </ProtectedRoute>
      }/>

      {/* Auth */}
      <Route path="/signin" element={
        <GuestRoute><SigninPage /></GuestRoute>
      }/>
      <Route path="/signup" element={
        <GuestRoute><SignupPage /></GuestRoute>
      }/>
      <Route path="/auth/callback" element={<AuthCallback />}/>

      {/* 404 */}
      <Route path="*" element={<NotFoundPage />}/>
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
