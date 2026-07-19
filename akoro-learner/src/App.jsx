import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';
import { AuthProvider, useAuth }   from './contexts/AuthContext.jsx';
import { ThemeProvider }           from './contexts/ThemeContext.jsx';
import { LanguageProvider }        from './contexts/LanguageContext.jsx';
import { CartProvider }            from './contexts/CartContext.jsx';
import ErrorBoundary    from './components/common/ErrorBoundary.jsx';
import OfflineBanner     from './components/common/OfflineBanner.jsx';

// Route-level code splitting: each page is its own chunk, fetched on demand, so
// the first load ships only the shell instead of the whole app in one bundle.
const LandingPage        = lazy(() => import('./pages/LandingPage.jsx'));
const InstructorInfoPage = lazy(() => import('./pages/InstructorInfoPage.jsx'));
const SchoolInfoPage     = lazy(() => import('./pages/SchoolInfoPage.jsx'));
const StudentInfoPage    = lazy(() => import('./pages/StudentInfoPage.jsx'));
const OnboardingPage     = lazy(() => import('./pages/OnboardingPage.jsx'));
const LearnerDashboard   = lazy(() => import('./pages/LearnerDashboard.jsx'));
const SettingsPage       = lazy(() => import('./pages/SettingsPage.jsx'));
const SigninPage         = lazy(() => import('./pages/auth/SigninPage.jsx'));
const SignupPage         = lazy(() => import('./pages/auth/SignupPage.jsx'));
const AuthCallback       = lazy(() => import('./pages/auth/AuthCallback.jsx'));
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPasswordPage.jsx'));
const ResetPasswordPage  = lazy(() => import('./pages/auth/ResetPasswordPage.jsx'));
const FDEAdminPage       = lazy(() => import('./pages/FDEAdminPage.jsx'));
const NotificationsPage  = lazy(() => import('./pages/NotificationsPage.jsx'));
const PrivacyPolicyPage  = lazy(() => import('./pages/PrivacyPolicyPage.jsx'));
const TermsOfServicePage = lazy(() => import('./pages/TermsOfServicePage.jsx'));
const AboutPage          = lazy(() => import('./pages/AboutPage.jsx'));
const ContactPage        = lazy(() => import('./pages/ContactPage.jsx'));
const CareersPage        = lazy(() => import('./pages/CareersPage.jsx'));
const BlogPage           = lazy(() => import('./pages/BlogPage.jsx'));
const BlogPostPage       = lazy(() => import('./pages/BlogPostPage.jsx'));
const PartnersPage       = lazy(() => import('./pages/PartnersPage.jsx'));
const AssessmentPage     = lazy(() => import('./pages/AssessmentPage.jsx'));
const CourseDetailsPage  = lazy(() => import('./pages/CourseDetailsPage.jsx'));
const AgentProfilePage   = lazy(() => import('./pages/AgentProfilePage.jsx'));
const CartPage           = lazy(() => import('./pages/CartPage.jsx'));
const NotFoundPage       = lazy(() => import('./pages/NotFoundPage.jsx'));

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

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

// Shown briefly while a route's chunk loads.
function RouteFallback() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ak-surface, #0B0818)' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid rgba(124,59,255,.25)', borderTopColor: '#6C3BFF', animation: 'ak-spin .7s linear infinite' }} />
      <style>{'@keyframes ak-spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}

function AppRoutes() {
  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<RouteFallback />}>
      <Routes>
      <Route path="/" element={<LandingPage />}/>
      <Route path="/onboarding" element={<OnboardingRoute><OnboardingPage /></OnboardingRoute>}/>
      <Route path="/app" element={<ProtectedRoute><LearnerDashboard /></ProtectedRoute>}/>
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>}/>
      <Route path="/fde-admin" element={<ProtectedRoute><FDEAdminPage /></ProtectedRoute>}/>
      <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>}/>
      <Route path="/assessment"  element={<ProtectedRoute><AssessmentPage /></ProtectedRoute>}/>
      <Route path="/course/:slug"  element={<CourseDetailsPage />}/>
      <Route path="/agent/:id"  element={<ProtectedRoute><AgentProfilePage /></ProtectedRoute>}/>
      <Route path="/cart"       element={<ProtectedRoute><CartPage /></ProtectedRoute>}/>
      <Route path="/privacy"  element={<PrivacyPolicyPage />}/>
      <Route path="/terms"    element={<TermsOfServicePage />}/>
      <Route path="/instructor-info"    element={<InstructorInfoPage />}/>
      <Route path="/student-info"    element={<StudentInfoPage />}/>
      <Route path="/school-info"    element={<SchoolInfoPage />}/>
        
        
      <Route path="/about"    element={<AboutPage />}/>
      <Route path="/contact"  element={<ContactPage />}/>
      <Route path="/careers"  element={<CareersPage />}/>
      <Route path="/blog"     element={<BlogPage />}/>
      <Route path="/blog/:slug" element={<BlogPostPage />}/>
      <Route path="/partners" element={<PartnersPage />}/>
      <Route path="/signin"          element={<GuestRoute><SigninPage /></GuestRoute>}/>
      <Route path="/signup"          element={<GuestRoute><SignupPage /></GuestRoute>}/>
      <Route path="/forgot-password" element={<GuestRoute><ForgotPasswordPage /></GuestRoute>}/>
      <Route path="/reset-password"  element={<ResetPasswordPage />}/>
      <Route path="/auth/callback"   element={<AuthCallback />}/>
      <Route path="*" element={<NotFoundPage />}/>
    </Routes>
      </Suspense>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <LanguageProvider>
          <AuthProvider>
            <CartProvider>
              <BrowserRouter>
                <AppRoutes />
                <OfflineBanner />
              </BrowserRouter>
            </CartProvider>
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
