import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import RouteMeta from './seo/RouteMeta.jsx';
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
import InstallIntent     from './components/common/InstallIntent.jsx';
import PresenceHeartbeat from './components/network/PresenceHeartbeat.jsx';
import { TARGET, APP_HOME, whereTo } from './config/target.js';

// Which site this build is (see config/target.js). These are literal at build time, so the other site's pages are
// dropped from the bundle entirely — the landing doesn't ship the app, and the app doesn't ship the marketing pages.
const SITE_BUILD    = import.meta.env.VITE_TARGET !== 'app';      // marketing pages: the landing (and a full build)
const PRODUCT_BUILD = import.meta.env.VITE_TARGET !== 'landing';  // the learner product: the app (and a full build)

// Route-level code splitting: each page is its own chunk, fetched on demand, so
// the first load ships only the shell instead of the whole app in one bundle.
const LandingPage = SITE_BUILD ? lazyWithRetry(() => import('./pages/LandingPage.jsx')) : null;
const InstructorInfoPage = SITE_BUILD ? lazyWithRetry(() => import('./pages/InstructorInfoPage.jsx')) : null;
const SchoolInfoPage = SITE_BUILD ? lazyWithRetry(() => import('./pages/SchoolInfoPage.jsx')) : null;
const ContentPage = SITE_BUILD ? lazyWithRetry(() => import('./pages/ContentPage.jsx')) : null;
const StudentInfoPage = SITE_BUILD ? lazyWithRetry(() => import('./pages/StudentInfoPage.jsx')) : null;
const OnboardingPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/OnboardingPage.jsx')) : null;
const LearnerDashboard = PRODUCT_BUILD ? lazyWithRetry(() => import('./features/dashboard/index.js')) : null;
const SettingsPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/SettingsPage.jsx')) : null;
const SigninPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/auth/SigninPage.jsx')) : null;
const SignupPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/auth/SignupPage.jsx')) : null;
const AuthCallback = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/auth/AuthCallback.jsx')) : null;
const ForgotPasswordPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/auth/ForgotPasswordPage.jsx')) : null;
const ResetPasswordPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/auth/ResetPasswordPage.jsx')) : null;
const FDEAdminPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/FDEAdminPage.jsx')) : null;
const NotificationsPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/NotificationsPage.jsx')) : null;
const ActivityPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/ActivityPage.jsx')) : null;
const ActivityDetailPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/ActivityDetailPage.jsx')) : null;
const GradebookPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/GradebookPage.jsx')) : null;
const CommunityPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/CommunityPage.jsx')) : null;
const CommunityActivityPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/CommunityActivityPage.jsx')) : null;
const CommunitySettingsPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/CommunitySettingsPage.jsx')) : null;
const CommunityPeoplePage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/CommunityPeoplePage.jsx')) : null;
const CommunityAnalyticsPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/CommunityAnalyticsPage.jsx')) : null;
const CommunityProfilePage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/CommunityProfilePage.jsx')) : null;
const LibraryPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/LibraryPage.jsx')) : null;
const DrawPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/DrawPage.jsx')) : null;
const PrivacyPolicyPage = SITE_BUILD ? lazyWithRetry(() => import('./pages/PrivacyPolicyPage.jsx')) : null;
const TermsOfServicePage = SITE_BUILD ? lazyWithRetry(() => import('./pages/TermsOfServicePage.jsx')) : null;
const AboutPage = SITE_BUILD ? lazyWithRetry(() => import('./pages/AboutPage.jsx')) : null;
const PricingPage = SITE_BUILD ? lazyWithRetry(() => import('./pages/PricingPage.jsx')) : null;
const PilotApplicationPage = SITE_BUILD ? lazyWithRetry(() => import('./pages/PilotApplicationPage.jsx')) : null;
const UpgradePage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/UpgradePage.jsx')) : null;
const ComparisonPage = SITE_BUILD ? lazyWithRetry(() => import('./pages/ComparisonPage.jsx')) : null;
const ContactPage = SITE_BUILD ? lazyWithRetry(() => import('./pages/ContactPage.jsx')) : null;
const CareersPage = SITE_BUILD ? lazyWithRetry(() => import('./pages/CareersPage.jsx')) : null;
const BlogPage = SITE_BUILD ? lazyWithRetry(() => import('./pages/BlogPage.jsx')) : null;
const BlogPostPage = SITE_BUILD ? lazyWithRetry(() => import('./pages/BlogPostPage.jsx')) : null;
const BlogEditorPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/BlogEditorPage.jsx')) : null;
const PartnersPage = SITE_BUILD ? lazyWithRetry(() => import('./pages/PartnersPage.jsx')) : null;
const AssessmentPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/AssessmentPage.jsx')) : null;
const CourseDetailsPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/CourseDetailsPage.jsx')) : null;
const AgentProfilePage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/AgentProfilePage.jsx')) : null;
const CartPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/CartPage.jsx')) : null;
const WalletPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/WalletPage.jsx')) : null;
const CheckoutPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/CheckoutPage.jsx')) : null;
const OrderHistoryPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/OrderHistoryPage.jsx')) : null;
const NotFoundPage       = lazyWithRetry(() => import('./pages/NotFoundPage.jsx'));
const JoinPage = PRODUCT_BUILD ? lazyWithRetry(() => import('./pages/JoinPage.jsx')) : null;
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
  if (user && user.onboardingCompleted) return <Navigate to={APP_HOME} replace />;
  return children;
}

/* ── GuestRoute: redirects to /app (or ?next=) if already signed in ── */
function GuestRoute({ children }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (isAuthenticated) return <Navigate to={nextPath(location.search) || APP_HOME} replace />;
  return children;
}

/* The old "/app" address (notifications, emails, saved links, the landing's old buttons) → the app's root, query and all. */
function LegacyApp() {
  const { search, hash } = useLocation();
  return <Navigate to={`/${search}${hash}`} replace />;
}

/* A path that belongs to the other site of a split deployment goes there; anything else is a 404. */
function OtherSite() {
  const { pathname, search, hash } = useLocation();
  const where = whereTo(TARGET, pathname, search, hash);
  useEffect(() => { if (where && where.to) window.location.replace(where.to); }, [where]);
  if (where && where.to) return <RouteFallback />;
  return <NotFoundPage />;
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

export function AppRoutes() {
  const site = SITE_BUILD;        // marketing pages: the landing (and a full build)
  const product = PRODUCT_BUILD;  // the learner product: the app (and a full build)
  return (
    <>
      <ScrollToTop />
      {site && <RouteMeta />}
      <Suspense fallback={<RouteFallback />}>
      <Routes>
      {/* The app site's front door IS the dashboard (signed out → sign-in); on the landing and a full build "/" is the marketing home */}
      <Route path="/" element={TARGET === 'app' ? <ProtectedRoute><LearnerDashboard /></ProtectedRoute> : <LandingPage />}/>
      {product && <Route path="/onboarding" element={<OnboardingRoute><OnboardingPage /></OnboardingRoute>}/>}
      {product && <Route path="/app" element={TARGET === 'app' ? <LegacyApp /> : <ProtectedRoute><LearnerDashboard /></ProtectedRoute>}/>}
      {product && <Route path="/settings/*" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>}/>}
      {product && <Route path="/fde-admin" element={<ProtectedRoute><FDEAdminPage /></ProtectedRoute>}/>}
      {product && <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>}/>}
      {product && <Route path="/activities" element={<ProtectedRoute><ActivityPage /></ProtectedRoute>}/>}
      {product && <Route path="/activities/:id" element={<ProtectedRoute><ActivityDetailPage /></ProtectedRoute>}/>}
      {product && <Route path="/gradebook" element={<ProtectedRoute><GradebookPage /></ProtectedRoute>}/>}
      {product && <Route path="/library" element={<ProtectedRoute><LibraryPage /></ProtectedRoute>}/>}
      {product && <Route path="/communities" element={<ProtectedRoute><CommunityPage /></ProtectedRoute>}/>}
      {product && <Route path="/communities/:communityId" element={<ProtectedRoute><CommunityActivityPage /></ProtectedRoute>}/>}
      {product && <Route path="/communities/:communityId/profile" element={<ProtectedRoute><CommunityProfilePage /></ProtectedRoute>}/>}
      {product && <Route path="/communities/:communityId/settings" element={<ProtectedRoute><CommunitySettingsPage /></ProtectedRoute>}/>}
      {product && <Route path="/communities/:communityId/people" element={<ProtectedRoute><CommunityPeoplePage /></ProtectedRoute>}/>}
      {product && <Route path="/communities/:communityId/analytics" element={<ProtectedRoute><CommunityAnalyticsPage /></ProtectedRoute>}/>}
      {product && <Route path="/draw"       element={<ProtectedRoute><DrawPage /></ProtectedRoute>}/>}
      {product && <Route path="/assessment"  element={<ProtectedRoute><AssessmentPage /></ProtectedRoute>}/>}
      {product && <Route path="/course/:slug"  element={<CourseDetailsPage />}/>}
      {product && <Route path="/agent/:id"  element={<ProtectedRoute><AgentProfilePage /></ProtectedRoute>}/>}
      {product && <Route path="/cart"       element={<ProtectedRoute><CartPage /></ProtectedRoute>}/>}
      {product && <Route path="/wallet"     element={<ProtectedRoute><WalletPage /></ProtectedRoute>}/>}
      {product && <Route path="/checkout"   element={<ProtectedRoute><CheckoutPage /></ProtectedRoute>}/>}
      {product && <Route path="/orders"     element={<ProtectedRoute><OrderHistoryPage /></ProtectedRoute>}/>}
      {site && <Route path="/privacy"  element={<PrivacyPolicyPage />}/>}
      {site && <Route path="/terms"    element={<TermsOfServicePage />}/>}
      {site && <Route path="/for-teachers"    element={<InstructorInfoPage />}/>}
      {site && <Route path="/for-students"    element={<StudentInfoPage />}/>}
      {site && <Route path="/for-schools"    element={<SchoolInfoPage />}/>}
      {/* The old addresses (vercel.json also 301s them) */}
      {site && <Route path="/instructor-info" element={<Navigate to="/for-teachers" replace />}/>}
      {site && <Route path="/student-info"    element={<Navigate to="/for-students" replace />}/>}
      {site && <Route path="/school-info"     element={<Navigate to="/for-schools" replace />}/>}
      {site && <Route path="/ai-protege"   element={<ContentPage path="/ai-protege" />}/>}
      {site && <Route path="/how-it-works" element={<ContentPage path="/how-it-works" />}/>}
      {site && <Route path="/exam-prep"    element={<ContentPage path="/exam-prep" />}/>}
        
        
      {site && <Route path="/pricing"  element={<PricingPage />}/>}
      {site && <Route path="/apply"   element={<PilotApplicationPage />}/>}
      {product && <Route path="/upgrade" element={<UpgradePage />}/>}
      {site && <Route path="/compare"  element={<ComparisonPage />}/>}
      {site && <Route path="/about"    element={<AboutPage />}/>}
      {site && <Route path="/contact"  element={<ContactPage />}/>}
      {site && <Route path="/careers"  element={<CareersPage />}/>}
      {site && <Route path="/blog"     element={<BlogPage />}/>}
      {site && <Route path="/blog/:slug" element={<BlogPostPage />}/>}
      {/* Learner-authored blogs (higherEd library) — /blog* is the public marketing blog */}
      {product && <Route path="/write/blog/new" element={<ProtectedRoute><BlogEditorPage /></ProtectedRoute>}/>}
      {product && <Route path="/write/blog/:id" element={<ProtectedRoute><BlogEditorPage /></ProtectedRoute>}/>}
      {site && <Route path="/partners" element={<PartnersPage />}/>}
      {product && <Route path="/signin"          element={<GuestRoute><SigninPage /></GuestRoute>}/>}
      {product && <Route path="/signup"          element={<GuestRoute><SignupPage /></GuestRoute>}/>}
      {product && <Route path="/forgot-password" element={<GuestRoute><ForgotPasswordPage /></GuestRoute>}/>}
      {product && <Route path="/reset-password"  element={<ResetPasswordPage />}/>}
      {product && <Route path="/auth/callback"   element={<AuthCallback />}/>}
      {product && <Route path="/join/:token"     element={<JoinPage />}/>}
      {import.meta.env.DEV && <Route path="/dev/shell" element={<ShellPreviewPage />}/>}
      {/* Anything else: the other site of a split deployment, or a 404 */}
      <Route path="*" element={<OtherSite />}/>
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
                {PRODUCT_BUILD && <UpdatePrompt />}
                {PRODUCT_BUILD && <InstallIntent />}
                {PRODUCT_BUILD && <PresenceHeartbeat />}
              </BrowserRouter>
            </CartProvider>
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
