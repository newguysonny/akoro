import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import GlobalStyles from './components/GlobalStyles.jsx';
import SigninPage   from './pages/auth/SigninPage.jsx';
import SignupPage   from './pages/auth/SignupPage.jsx';
import OnboardingPage from './pages/auth/OnboardingPage.jsx';
import HomePage     from './pages/HomePage.jsx';
import CoursesPage  from './pages/CoursesPage.jsx';
import StudentsPage from './pages/StudentsPage.jsx';
import BattlesPage  from './pages/BattlesPage.jsx';
import TasksPage    from './pages/TasksPage.jsx';
import ChatPage     from './pages/ChatPage.jsx';
import SettingsPage  from './pages/SettingsPage.jsx';

/* ── ProtectedRoute ─────────────────────────────────────────────────── */
const INSTRUCTOR_ROLES = ['instructor', 'admin'];

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
      <Route path="/students" element={<ProtectedRoute><StudentsPage /></ProtectedRoute>} />
      <Route path="/battles" element={<ProtectedRoute><BattlesPage /></ProtectedRoute>} />
      <Route path="/tasks" element={<ProtectedRoute><TasksPage /></ProtectedRoute>} />
      <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />

      {/* Auth */}
      <Route path="/signin" element={<GuestRoute><SigninPage /></GuestRoute>} />
      <Route path="/signup" element={<GuestRoute><SignupPage /></GuestRoute>} />
      <Route path="/onboarding" element={<OnboardingRoute><OnboardingPage /></OnboardingRoute>} />

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
