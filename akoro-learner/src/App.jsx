import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth }   from './contexts/AuthContext.jsx';
import { ThemeProvider }           from './contexts/ThemeContext.jsx';
import { LanguageProvider }        from './contexts/LanguageContext.jsx';
import ErrorBoundary    from './components/common/ErrorBoundary.jsx';
import LandingPage      from './pages/LandingPage.jsx';
import OnboardingPage   from './pages/OnboardingPage.jsx';
import LearnerDashboard from './pages/LearnerDashboard.jsx';
import SettingsPage     from './pages/SettingsPage.jsx';
import SigninPage       from './pages/auth/SigninPage.jsx';
import SignupPage       from './pages/auth/SignupPage.jsx';
import AuthCallback     from './pages/auth/AuthCallback.jsx';
import FDEAdminPage     from './pages/FDEAdminPage.jsx';
import LiveClassesPage  from './pages/LiveClassesPage.jsx';
import NotFoundPage     from './pages/NotFoundPage.jsx';

/* ── ProtectedRoute: requires auth, then gates on onboarding ── */
function ProtectedRoute({ children }) {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) {
    localStorage.setItem('akoro_redirect', location.pathname + location.search);
    return <Navigate to="/signin" replace />;
  }
  // First-run gate: unfinished onboarding must complete before the app.
  if (user && user.onboardingCompleted === false) {
    return <Navigate to="/onboarding" replace />;
  }
  return children;
}

/* ── OnboardingRoute: requires auth; skips wizard if already done ── */
function OnboardingRoute({ children }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/signin" replace />;
  if (user && user.onboardingCompleted) return <Navigate to="/app" replace />;
  return children;
}

/* ── GuestRoute: redirects to /app if already signed in ─────────── */
function GuestRoute({ children }) {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/app" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />}/>
      <Route path="/onboarding" element={<OnboardingRoute><OnboardingPage /></OnboardingRoute>}/>
      <Route path="/app" element={<ProtectedRoute><LearnerDashboard /></ProtectedRoute>}/>
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>}/>
      <Route path="/fde-admin" element={<ProtectedRoute><FDEAdminPage /></ProtectedRoute>}/>
      <Route path="/live" element={<ProtectedRoute><LiveClassesPage /></ProtectedRoute>}/>
      <Route path="/live/:courseId" element={<ProtectedRoute><LiveClassesPage /></ProtectedRoute>}/>
      <Route path="/signin" element={<GuestRoute><SigninPage /></GuestRoute>}/>
      <Route path="/signup" element={<GuestRoute><SignupPage /></GuestRoute>}/>
      <Route path="/auth/callback" element={<AuthCallback />}/>
      <Route path="*" element={<NotFoundPage />}/>
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <LanguageProvider>
          <AuthProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
