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
import ProfilePage        from './pages/ProfilePage.jsx';
import MarketplacePage     from './pages/MarketplacePage.jsx';
import LibraryPage         from './pages/LibraryPage.jsx';
import AppsCenterPage      from './pages/AppsCenterPage.jsx';
import SettingsBillingPage from './pages/SettingsBillingPage.jsx';
import SocialMediaPage     from './pages/SocialMediaPage.jsx';
import TelegramBotPage     from './pages/TelegramBotPage.jsx';
import DomainPage          from './pages/DomainPage.jsx';
import ModuleManagementPage from './pages/ModuleManagementPage.jsx';
import BackupManagementPage from './pages/BackupManagementPage.jsx';
import RolesPermissionsPage from './pages/RolesPermissionsPage.jsx';
import PaymentGatewayPage from './pages/PaymentGatewayPage.jsx';
import AdmissionSettingsPage from './pages/AdmissionSettingsPage.jsx';
import ManageSubscriptionPage from './pages/ManageSubscriptionPage.jsx';
import SubscriptionHistoryPage from './pages/SubscriptionHistoryPage.jsx';
import AuditTrailPage from './pages/AuditTrailPage.jsx';
import {
  StudentDashboardPage, StudentAdmissionPage, StudentListPage, StudentAttendancePage,
  BehaviorRecordsPage, StudentHousesPage, StudentCategoriesPage, DisabledStudentsPage, HealthRecordsPage,
} from './pages/mgmt/studentPages.jsx';
import {
  AcademicDashboardPage, AcademicSessionsPage, ClassesPage, SectionsPage, SubjectsPage,
  AssignSubjectsPage, AssignElectivesPage, AssignClassTeacherPage, ManagePeriodsPage,
  ClassTimetablePage, PromoteStudentsPage,
} from './pages/mgmt/academicsPages.jsx';
import {
  FeesDashboardPage, CollectFeesPage, SearchDueFeesPage, AllTransactionsPage, OnlineTransactionsPage,
  FeeChallansPage, AssignFeesPage, FeesCarryForwardPage, FeeGroupsPage, FeeDiscountsPage,
  FeeTypesPage, GenerateDueSlipPage, DueSlipHistoryPage,
} from './pages/mgmt/financePages.jsx';
import {
  FrontOfficeDashboardPage, AdmissionEnquiriesPage, VisitorBookPage, ComplaintsPage, PostalRecordsPage,
} from './pages/mgmt/frontOfficePages.jsx';
import SchoolWebsitePage   from './pages/SchoolWebsitePage.jsx';
import WebsiteTemplatesPage from './pages/WebsiteTemplatesPage.jsx';
import WebsiteTemplateEditorPage from './pages/WebsiteTemplateEditorPage.jsx';
import NotificationCenterPage from './pages/NotificationCenterPage.jsx';
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
      <Route path="/settings"       element={<Navigate to="/settings-billing" replace />} />
      <Route path="/profile"        element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
      <Route path="/marketplace"    element={<ProtectedRoute><MarketplacePage /></ProtectedRoute>} />
      <Route path="/library"        element={<ProtectedRoute><LibraryPage /></ProtectedRoute>} />
      <Route path="/apps"           element={<ProtectedRoute><AppsCenterPage /></ProtectedRoute>} />
      <Route path="/settings-billing" element={<ProtectedRoute><SettingsBillingPage /></ProtectedRoute>} />
      <Route path="/settings-social-media" element={<ProtectedRoute><SocialMediaPage /></ProtectedRoute>} />
      <Route path="/settings-telegram" element={<ProtectedRoute><TelegramBotPage /></ProtectedRoute>} />
      <Route path="/settings-domain" element={<ProtectedRoute><DomainPage /></ProtectedRoute>} />
      <Route path="/settings-modules" element={<ProtectedRoute><ModuleManagementPage /></ProtectedRoute>} />
      <Route path="/settings-backup" element={<ProtectedRoute><BackupManagementPage /></ProtectedRoute>} />
      <Route path="/settings-roles" element={<ProtectedRoute><RolesPermissionsPage /></ProtectedRoute>} />
      <Route path="/settings-payment-gateway" element={<ProtectedRoute><PaymentGatewayPage /></ProtectedRoute>} />
      <Route path="/settings-admission" element={<ProtectedRoute><AdmissionSettingsPage /></ProtectedRoute>} />
      <Route path="/settings-subscription" element={<ProtectedRoute><ManageSubscriptionPage /></ProtectedRoute>} />
      <Route path="/settings-subscription-history" element={<ProtectedRoute><SubscriptionHistoryPage /></ProtectedRoute>} />
      <Route path="/settings-audit-trail" element={<ProtectedRoute><AuditTrailPage /></ProtectedRoute>} />
      {/* Management — Student Information */}
      <Route path="/mgmt/student-dashboard"  element={<ProtectedRoute><StudentDashboardPage /></ProtectedRoute>} />
      <Route path="/mgmt/student-admission"  element={<ProtectedRoute><StudentAdmissionPage /></ProtectedRoute>} />
      <Route path="/mgmt/students"           element={<ProtectedRoute><StudentListPage /></ProtectedRoute>} />
      <Route path="/mgmt/student-attendance" element={<ProtectedRoute><StudentAttendancePage /></ProtectedRoute>} />
      <Route path="/mgmt/behavior-records"   element={<ProtectedRoute><BehaviorRecordsPage /></ProtectedRoute>} />
      <Route path="/mgmt/student-houses"     element={<ProtectedRoute><StudentHousesPage /></ProtectedRoute>} />
      <Route path="/mgmt/student-categories" element={<ProtectedRoute><StudentCategoriesPage /></ProtectedRoute>} />
      <Route path="/mgmt/disabled-students"  element={<ProtectedRoute><DisabledStudentsPage /></ProtectedRoute>} />
      <Route path="/mgmt/health-records"     element={<ProtectedRoute><HealthRecordsPage /></ProtectedRoute>} />
      {/* Management — Academics */}
      <Route path="/mgmt/academic-dashboard"   element={<ProtectedRoute><AcademicDashboardPage /></ProtectedRoute>} />
      <Route path="/mgmt/academic-sessions"    element={<ProtectedRoute><AcademicSessionsPage /></ProtectedRoute>} />
      <Route path="/mgmt/classes"              element={<ProtectedRoute><ClassesPage /></ProtectedRoute>} />
      <Route path="/mgmt/sections"             element={<ProtectedRoute><SectionsPage /></ProtectedRoute>} />
      <Route path="/mgmt/subjects"             element={<ProtectedRoute><SubjectsPage /></ProtectedRoute>} />
      <Route path="/mgmt/assign-subjects"      element={<ProtectedRoute><AssignSubjectsPage /></ProtectedRoute>} />
      <Route path="/mgmt/assign-electives"     element={<ProtectedRoute><AssignElectivesPage /></ProtectedRoute>} />
      <Route path="/mgmt/assign-class-teacher" element={<ProtectedRoute><AssignClassTeacherPage /></ProtectedRoute>} />
      <Route path="/mgmt/periods"              element={<ProtectedRoute><ManagePeriodsPage /></ProtectedRoute>} />
      <Route path="/mgmt/class-timetable"      element={<ProtectedRoute><ClassTimetablePage /></ProtectedRoute>} />
      <Route path="/mgmt/promote-students"     element={<ProtectedRoute><PromoteStudentsPage /></ProtectedRoute>} />
      {/* Management — Finance & Fees */}
      <Route path="/mgmt/fees-dashboard"       element={<ProtectedRoute><FeesDashboardPage /></ProtectedRoute>} />
      <Route path="/mgmt/collect-fees"         element={<ProtectedRoute><CollectFeesPage /></ProtectedRoute>} />
      <Route path="/mgmt/search-due-fees"      element={<ProtectedRoute><SearchDueFeesPage /></ProtectedRoute>} />
      <Route path="/mgmt/all-transactions"     element={<ProtectedRoute><AllTransactionsPage /></ProtectedRoute>} />
      <Route path="/mgmt/online-transactions"  element={<ProtectedRoute><OnlineTransactionsPage /></ProtectedRoute>} />
      <Route path="/mgmt/fee-challans"         element={<ProtectedRoute><FeeChallansPage /></ProtectedRoute>} />
      <Route path="/mgmt/assign-fees"          element={<ProtectedRoute><AssignFeesPage /></ProtectedRoute>} />
      <Route path="/mgmt/fees-carry-forward"   element={<ProtectedRoute><FeesCarryForwardPage /></ProtectedRoute>} />
      <Route path="/mgmt/fee-groups"           element={<ProtectedRoute><FeeGroupsPage /></ProtectedRoute>} />
      <Route path="/mgmt/fee-discounts"        element={<ProtectedRoute><FeeDiscountsPage /></ProtectedRoute>} />
      <Route path="/mgmt/fee-types"            element={<ProtectedRoute><FeeTypesPage /></ProtectedRoute>} />
      <Route path="/mgmt/generate-due-slip"    element={<ProtectedRoute><GenerateDueSlipPage /></ProtectedRoute>} />
      <Route path="/mgmt/due-slip-history"     element={<ProtectedRoute><DueSlipHistoryPage /></ProtectedRoute>} />
      {/* Management — Front Office */}
      <Route path="/mgmt/front-office-dashboard" element={<ProtectedRoute><FrontOfficeDashboardPage /></ProtectedRoute>} />
      <Route path="/mgmt/enquiries"            element={<ProtectedRoute><AdmissionEnquiriesPage /></ProtectedRoute>} />
      <Route path="/mgmt/visitor-book"         element={<ProtectedRoute><VisitorBookPage /></ProtectedRoute>} />
      <Route path="/mgmt/complaints"           element={<ProtectedRoute><ComplaintsPage /></ProtectedRoute>} />
      <Route path="/mgmt/postal-records"       element={<ProtectedRoute><PostalRecordsPage /></ProtectedRoute>} />
      <Route path="/settings-website" element={<ProtectedRoute><SchoolWebsitePage /></ProtectedRoute>} />
      <Route path="/settings-website/templates" element={<ProtectedRoute><WebsiteTemplatesPage /></ProtectedRoute>} />
      <Route path="/settings-website/templates/:id" element={<ProtectedRoute><WebsiteTemplateEditorPage /></ProtectedRoute>} />
      <Route path="/settings-notifications" element={<ProtectedRoute><NotificationCenterPage /></ProtectedRoute>} />
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
