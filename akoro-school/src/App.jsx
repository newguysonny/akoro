import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import GlobalStyles from './components/GlobalStyles.jsx';
import SigninPage         from './pages/auth/SigninPage.jsx';
import SignupPage         from './pages/auth/SignupPage.jsx';
import OnboardingPage     from './pages/auth/OnboardingPage.jsx';
import AuthCallback       from './pages/auth/AuthCallback.jsx';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage.jsx';
import ResetPasswordPage  from './pages/auth/ResetPasswordPage.jsx';
import HomePage     from './pages/HomePage.jsx';
import CoursesPage  from './pages/CoursesPage.jsx';
import InstructorsPage from './pages/InstructorsPage.jsx';
import ClassroomsPage from './pages/ClassroomsPage.jsx';
import StudentsPage from './pages/StudentsPage.jsx';
import BattlesPage  from './pages/BattlesPage.jsx';
import TasksPage    from './pages/TasksPage.jsx';
import ChatPage     from './pages/ChatPage.jsx';
import AssessmentReviewPage from './pages/AssessmentReviewPage.jsx';
import SettingsPage       from './pages/SettingsPage.jsx';
import ProfilePage        from './pages/ProfilePage.jsx';
import MarketplacePage     from './pages/MarketplacePage.jsx';
import LibraryPage         from './pages/LibraryPage.jsx';
import AppsCenterPage      from './pages/AppsCenterPage.jsx';
import SettingsBillingPage from './pages/SettingsBillingPage.jsx';
import NotificationsPage  from './pages/NotificationsPage.jsx';
import PrivacyPolicyPage  from './pages/PrivacyPolicyPage.jsx';
import TermsOfServicePage from './pages/TermsOfServicePage.jsx';

/* ── ProtectedRoute ─────────────────────────────────────────────────── */
const INSTRUCTOR_ROLES = ['school', 'school_admin', 'instructor', 'admin'];

function ProtectedRoute({ children }) {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) {
    localStorage.setItem('akoro_redirect', location.pathname + location.search);
    return <Navigate to="/signin" replace />;
  }
  // Role guard: a valid session that isn't an instructor (e.g. a student
  // cookie shared across apps, or a non-teacher Google sign-in) is bounced
  // to /signin with a message instead of seeing the dashboard.
  if (user?.role && !INSTRUCTOR_ROLES.includes(user.role)) {
    return <Navigate to="/signin?error=not_instructor" replace />;
  }
  // First-run gate: unfinished onboarding must complete before the dashboard.
  if (user && user.onboardingCompleted === false) {
    return <Navigate to="/onboarding" replace />;
  }
  return children;
}

/* ── OnboardingRoute: requires an instructor session; skips if done ── */
function OnboardingRoute({ children }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/signin" replace />;
  if (user?.role && !INSTRUCTOR_ROLES.includes(user.role)) {
    return <Navigate to="/signin?error=not_instructor" replace />;
  }
  if (user && user.onboardingCompleted) return <Navigate to="/" replace />;
  return children;
}

/* ── GuestRoute ─────────────────────────────────────────────────────── */
function GuestRoute({ children }) {
  const { isAuthenticated, user } = useAuth();
  // Only bounce authenticated *instructors* away from /signin. A logged-in
  // non-instructor must stay here (with the "not_instructor" message) rather
  // than ping-ponging against ProtectedRoute's role guard.
  const isInstructor = !user?.role || INSTRUCTOR_ROLES.includes(user.role);
  if (isAuthenticated && isInstructor) return <Navigate to="/" replace />;
  return children;
}

/* ── NotFound ───────────────────────────────────────────────────────── */
function NotFound() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 12,
      fontFamily: "'DM Sans', sans-serif", color: '#1A1A2E',
    }}>
      <div style={{ fontSize: 64 }}>404</div>
      <p style={{ fontSize: 16, color: '#6B6B80' }}>Page not found</p>
      <a href="/" style={{ color: '#E8884A', fontWeight: 600, textDecoration: 'none' }}>Go home</a>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      {/* Protected */}
      <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
      <Route path="/courses" element={<ProtectedRoute><CoursesPage /></ProtectedRoute>} />
      <Route path="/instructors" element={<ProtectedRoute><InstructorsPage /></ProtectedRoute>} />
      <Route path="/classes" element={<ProtectedRoute><ClassroomsPage /></ProtectedRoute>} />
      <Route path="/students" element={<ProtectedRoute><StudentsPage /></ProtectedRoute>} />
      <Route path="/battles" element={<ProtectedRoute><BattlesPage /></ProtectedRoute>} />
      <Route path="/tasks" element={<ProtectedRoute><TasksPage /></ProtectedRoute>} />
      <Route path="/assessments" element={<ProtectedRoute><AssessmentReviewPage /></ProtectedRoute>} />
      <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
      <Route path="/settings"       element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="/profile"        element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
      <Route path="/marketplace"    element={<ProtectedRoute><MarketplacePage /></ProtectedRoute>} />
      <Route path="/library"        element={<ProtectedRoute><LibraryPage /></ProtectedRoute>} />
      <Route path="/apps"           element={<ProtectedRoute><AppsCenterPage /></ProtectedRoute>} />
      <Route path="/settings-billing" element={<ProtectedRoute><SettingsBillingPage /></ProtectedRoute>} />
      <Route path="/notifications"  element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />

      {/* Legal */}
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/terms"   element={<TermsOfServicePage />} />

      {/* Auth */}
      <Route path="/signin"          element={<GuestRoute><SigninPage /></GuestRoute>} />
      <Route path="/signup"          element={<GuestRoute><SignupPage /></GuestRoute>} />
      <Route path="/auth/callback"   element={<AuthCallback />} />
      <Route path="/forgot-password" element={<GuestRoute><ForgotPasswordPage /></GuestRoute>} />
      <Route path="/reset-password"  element={<ResetPasswordPage />} />
      <Route path="/onboarding"      element={<OnboardingRoute><OnboardingPage /></OnboardingRoute>} />

      {/* 404 */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default function App() {
  return (
    <>
      <GlobalStyles />
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </>
  );
}
