import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, Suspense } from 'react';
import { lazyWithRetry } from './utils/lazyWithRetry.js';
import { nextPath } from './utils/nextPath.js';
import { AuthProvider, useAuth }   from './contexts/AuthContext.jsx';
import { ThemeProvider }           from './contexts/ThemeContext.jsx';
import { LanguageProvider }        from './contexts/LanguageContext.jsx';
import { CartProvider }            from './contexts/CartContext.jsx';
import ErrorBoundary    from './components/common/ErrorBoundary.jsx';
import ConfirmHost      from './components/common/ConfirmHost.jsx';
import OfflineBanner     from './components/common/OfflineBanner.jsx';
import UpdatePrompt      from './components/common/UpdatePrompt.jsx';
import PresenceHeartbeat from './components/network/PresenceHeartbeat.jsx';

// Route-level code splitting: each page is its own chunk, fetched on demand, so
// the first load ships only the shell instead of the whole app in one bundle.
const LandingPage        = lazyWithRetry(() => import('./pages/LandingPage.jsx'));
const InstructorInfoPage = lazyWithRetry(() => import('./pages/InstructorInfoPage.jsx'));
const SchoolInfoPage     = lazyWithRetry(() => import('./pages/SchoolInfoPage.jsx'));
const StudentInfoPage    = lazyWithRetry(() => import('./pages/StudentInfoPage.jsx'));
const OnboardingPage     = lazyWithRetry(() => import('./pages/OnboardingPage.jsx'));
const LearnerDashboard   = lazyWithRetry(() => import('./pages/LearnerDashboard.jsx'));
const SettingsPage       = lazyWithRetry(() => import('./pages/SettingsPage.jsx'));
const SigninPage         = lazyWithRetry(() => import('./pages/auth/SigninPage.jsx'));
const SignupPage         = lazyWithRetry(() => import('./pages/auth/SignupPage.jsx'));
const AuthCallback       = lazyWithRetry(() => import('./pages/auth/AuthCallback.jsx'));
const ForgotPasswordPage = lazyWithRetry(() => import('./pages/auth/ForgotPasswordPage.jsx'));
const ResetPasswordPage  = lazyWithRetry(() => import('./pages/auth/ResetPasswordPage.jsx'));
const FDEAdminPage       = lazyWithRetry(() => import('./pages/FDEAdminPage.jsx'));
const NotificationsPage  = lazyWithRetry(() => import('./pages/NotificationsPage.jsx'));
const ActivityPage       = lazyWithRetry(() => import('./pages/ActivityPage.jsx'));
const ActivityDetailPage = lazyWithRetry(() => import('./pages/ActivityDetailPage.jsx'));
const GradebookPage      = lazyWithRetry(() => import('./pages/GradebookPage.jsx'));
const CommunityPage      = lazyWithRetry(() => import('./pages/CommunityPage.jsx'));
const CommunityActivityPage  = lazyWithRetry(() => import('./pages/CommunityActivityPage.jsx'));
const CommunitySettingsPage  = lazyWithRetry(() => import('./pages/CommunitySettingsPage.jsx'));
const CommunityPeoplePage    = lazyWithRetry(() => import('./pages/CommunityPeoplePage.jsx'));
const CommunityAnalyticsPage = lazyWithRetry(() => import('./pages/CommunityAnalyticsPage.jsx'));
const CommunityProfilePage   = lazyWithRetry(() => import('./pages/CommunityProfilePage.jsx'));
const LibraryPage        = lazyWithRetry(() => import('./pages/LibraryPage.jsx'));
const DrawPage           = lazyWithRetry(() => import('./pages/DrawPage.jsx'));
const PrivacyPolicyPage  = lazyWithRetry(() => import('./pages/PrivacyPolicyPage.jsx'));
const TermsOfServicePage = lazyWithRetry(() => import('./pages/TermsOfServicePage.jsx'));
const AboutPage          = lazyWithRetry(() => import('./pages/AboutPage.jsx'));
const PricingPage        = lazyWithRetry(() => import('./pages/PricingPage.jsx'));
const PilotApplicationPage = lazyWithRetry(() => import('./pages/PilotApplicationPage.jsx'));
const UpgradePage          = lazyWithRetry(() => import('./pages/UpgradePage.jsx'));
const ComparisonPage     = lazyWithRetry(() => import('./pages/ComparisonPage.jsx'));
const ContactPage        = lazyWithRetry(() => import('./pages/ContactPage.jsx'));
const CareersPage        = lazyWithRetry(() => import('./pages/CareersPage.jsx'));
const BlogPage           = lazyWithRetry(() => import('./pages/BlogPage.jsx'));
const BlogPostPage       = lazyWithRetry(() => import('./pages/BlogPostPage.jsx'));
const BlogEditorPage     = lazyWithRetry(() => import('./pages/BlogEditorPage.jsx'));
const PartnersPage       = lazyWithRetry(() => import('./pages/PartnersPage.jsx'));
const AssessmentPage     = lazyWithRetry(() => import('./pages/AssessmentPage.jsx'));
const CourseDetailsPage  = lazyWithRetry(() => import('./pages/CourseDetailsPage.jsx'));
const AgentProfilePage   = lazyWithRetry(() => import('./pages/AgentProfilePage.jsx'));
const CartPage           = lazyWithRetry(() => import('./pages/CartPage.jsx'));
const WalletPage         = lazyWithRetry(() => import('./pages/WalletPage.jsx'));
const CheckoutPage       = lazyWithRetry(() => import('./pages/CheckoutPage.jsx'));
const OrderHistoryPage   = lazyWithRetry(() => import('./pages/OrderHistoryPage.jsx'));
const NotFoundPage       = lazyWithRetry(() => import('./pages/NotFoundPage.jsx'));
const JoinPage           = lazyWithRetry(() => import('./pages/JoinPage.jsx'));
// DEV-ONLY layout preview (/dev/shell) — gated on import.meta.env.DEV so the
// route, this reference and the chunk are all dead-code-eliminated from
// production builds. Lets the AppShell sidebar / rail / bottom-nav behaviour
// be checked without a signed-in session or a running API.
const ShellPreviewPage   = import.meta.env.DEV
  ? lazyWithRetry(() => import('./pages/ShellPreviewPage.jsx'))
  : () => null;

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

/* ── GuestRoute: redirects to /app (or ?next=) if already signed in ── */
function GuestRoute({ children }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (isAuthenticated) return <Navigate to={nextPath(location.search) || '/app'} replace />;
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
      <Route path="/settings/*" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>}/>
      <Route path="/fde-admin" element={<ProtectedRoute><FDEAdminPage /></ProtectedRoute>}/>
      <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>}/>
      <Route path="/activities" element={<ProtectedRoute><ActivityPage /></ProtectedRoute>}/>
      <Route path="/activities/:id" element={<ProtectedRoute><ActivityDetailPage /></ProtectedRoute>}/>
      <Route path="/gradebook" element={<ProtectedRoute><GradebookPage /></ProtectedRoute>}/>
      <Route path="/library" element={<ProtectedRoute><LibraryPage /></ProtectedRoute>}/>
      <Route path="/communities" element={<ProtectedRoute><CommunityPage /></ProtectedRoute>}/>
      <Route path="/communities/:communityId" element={<ProtectedRoute><CommunityActivityPage /></ProtectedRoute>}/>
      <Route path="/communities/:communityId/profile" element={<ProtectedRoute><CommunityProfilePage /></ProtectedRoute>}/>
      <Route path="/communities/:communityId/settings" element={<ProtectedRoute><CommunitySettingsPage /></ProtectedRoute>}/>
      <Route path="/communities/:communityId/people" element={<ProtectedRoute><CommunityPeoplePage /></ProtectedRoute>}/>
      <Route path="/communities/:communityId/analytics" element={<ProtectedRoute><CommunityAnalyticsPage /></ProtectedRoute>}/>
      <Route path="/draw"       element={<ProtectedRoute><DrawPage /></ProtectedRoute>}/>
      <Route path="/assessment"  element={<ProtectedRoute><AssessmentPage /></ProtectedRoute>}/>
      <Route path="/course/:slug"  element={<CourseDetailsPage />}/>
      <Route path="/agent/:id"  element={<ProtectedRoute><AgentProfilePage /></ProtectedRoute>}/>
      <Route path="/cart"       element={<ProtectedRoute><CartPage /></ProtectedRoute>}/>
      <Route path="/wallet"     element={<ProtectedRoute><WalletPage /></ProtectedRoute>}/>
      <Route path="/checkout"   element={<ProtectedRoute><CheckoutPage /></ProtectedRoute>}/>
      <Route path="/orders"     element={<ProtectedRoute><OrderHistoryPage /></ProtectedRoute>}/>
      <Route path="/privacy"  element={<PrivacyPolicyPage />}/>
      <Route path="/terms"    element={<TermsOfServicePage />}/>
      <Route path="/instructor-info"    element={<InstructorInfoPage />}/>
      <Route path="/student-info"    element={<StudentInfoPage />}/>
      <Route path="/school-info"    element={<SchoolInfoPage />}/>
        
        
      <Route path="/pricing"  element={<PricingPage />}/>
      <Route path="/apply"   element={<PilotApplicationPage />}/>
      <Route path="/upgrade" element={<UpgradePage />}/>
      <Route path="/compare"  element={<ComparisonPage />}/>
      <Route path="/about"    element={<AboutPage />}/>
      <Route path="/contact"  element={<ContactPage />}/>
      <Route path="/careers"  element={<CareersPage />}/>
      <Route path="/blog"     element={<BlogPage />}/>
      <Route path="/blog/:slug" element={<BlogPostPage />}/>
      {/* Learner-authored blogs (higherEd library) — /blog* is the public marketing blog */}
      <Route path="/write/blog/new" element={<ProtectedRoute><BlogEditorPage /></ProtectedRoute>}/>
      <Route path="/write/blog/:id" element={<ProtectedRoute><BlogEditorPage /></ProtectedRoute>}/>
      <Route path="/partners" element={<PartnersPage />}/>
      <Route path="/signin"          element={<GuestRoute><SigninPage /></GuestRoute>}/>
      <Route path="/signup"          element={<GuestRoute><SignupPage /></GuestRoute>}/>
      <Route path="/forgot-password" element={<GuestRoute><ForgotPasswordPage /></GuestRoute>}/>
      <Route path="/reset-password"  element={<ResetPasswordPage />}/>
      <Route path="/auth/callback"   element={<AuthCallback />}/>
      <Route path="/join/:token"     element={<JoinPage />}/>
      {import.meta.env.DEV && <Route path="/dev/shell" element={<ShellPreviewPage />}/>}
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
                {/* One host for every confirmDialog() call in the app. */}
                <ConfirmHost />
                <UpdatePrompt />
                <PresenceHeartbeat />
              </BrowserRouter>
            </CartProvider>
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
