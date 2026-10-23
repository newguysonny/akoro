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
import ScheduleSessionsPage from './pages/ScheduleSessionsPage.jsx';
import CourseCreatorPage from './pages/course-creator/index.jsx';
import SalesPage     from './pages/SalesPage.jsx';
import OrderHistoryPage from './pages/OrderHistoryPage.jsx';
import StudentsPage from './pages/StudentsPage.jsx';
import JoinRequestsPage from './pages/JoinRequestsPage.jsx';
import TasksPage    from './pages/TasksPage.jsx';
import ActivitiesPage from './pages/ActivitiesPage.jsx';
import GradebookPage from './pages/GradebookPage.jsx';
import SubmissionsPage from './pages/SubmissionsPage.jsx';
import SelfStudyAnalyticsPage from './pages/SelfStudyAnalyticsPage.jsx';
import DocumentsPage, { DocumentEditorPage } from './pages/DocumentsPage.jsx';
import ChatPage     from './pages/ChatPage.jsx';
import AssessmentReviewPage from './pages/AssessmentReviewPage.jsx';
import SettingsPage       from './pages/SettingsPage.jsx';
import AgentToolsPage     from './pages/AgentToolsPage.jsx';
import WalletPage         from './pages/WalletPage.jsx';
import PurchaseCheckoutPage from './pages/PurchaseCheckoutPage.jsx';
import LessonReviewPage from './pages/LessonReviewPage.jsx';
import ProfilePage        from './pages/ProfilePage.jsx';
import AppCenterPage       from './pages/AppCenterPage.jsx';
import LibraryPage         from './pages/LibraryPage.jsx';
import NotificationsPage  from './pages/NotificationsPage.jsx';
import { CurriculumPage, SyllabusPage, SubjectsPage, ClassTimetablePage, WeeklyForecastPage, DailySchedulePage, MyTimetablePage } from './pages/mgmt/academic.jsx';
import { StudentAttendancePage, BehaviorRecordsPage } from './pages/mgmt/students.jsx';
import StudentProfilePage from './pages/mgmt/StudentProfilePage.jsx';
import PrivacyPolicyPage  from './pages/PrivacyPolicyPage.jsx';
import TermsOfServicePage from './pages/TermsOfServicePage.jsx';

/* The old Tools & Assets address: purchases still return to /marketplace?tool_ref=…,
   so carry the query to the App Center, which verifies the payment. */
function MarketplaceRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/apps${search}`} replace />;
}

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
      <a href="/" style={{ color: 'var(--ak-brand)', fontWeight: 600, textDecoration: 'none' }}>Go home</a>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      {/* Protected */}
      <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
      {/* No Courses page: courses are made and managed only in Course Creator; Schedule sessions sits in its group. */}
      <Route path="/courses" element={<Navigate to="/course-creator" replace />} />
      <Route path="/courses/new-live"     element={<Navigate to="/course-creator/courses/new" replace />} />
      <Route path="/courses/new-ondemand" element={<Navigate to="/course-creator/courses/new" replace />} />
      <Route path="/courses/manage"       element={<Navigate to="/course-creator" replace />} />
      <Route path="/courses/schedule"     element={<ProtectedRoute><ScheduleSessionsPage /></ProtectedRoute>} />
      {/* Course Creator — the marketplace course builder (sections, lessons, review flow). */}
      <Route path="/course-creator/*" element={<ProtectedRoute><CourseCreatorPage /></ProtectedRoute>} />
      <Route path="/sales" element={<ProtectedRoute><SalesPage /></ProtectedRoute>} />
      <Route path="/orders" element={<ProtectedRoute><OrderHistoryPage /></ProtectedRoute>} />
      {/* Students now live under Management → My Students. */}
      <Route path="/students" element={<Navigate to="/mgmt/students" replace />} />
      {/* Battles live in Activities now (type = battle). */}
      <Route path="/battles" element={<Navigate to="/activities?type=battle" replace />} />
      <Route path="/tasks" element={<ProtectedRoute><TasksPage /></ProtectedRoute>} />
      {/* AI Self Study is an activity type now. */}
      <Route path="/self-study" element={<Navigate to="/activities?type=self_study" replace />} />
      <Route path="/activities" element={<ProtectedRoute><ActivitiesPage /></ProtectedRoute>} />
      {/* Dedicated pages for flows that used to be modals */}
      <Route path="/activities/detail" element={<ProtectedRoute><ActivitiesPage /></ProtectedRoute>} />
      <Route path="/activities/draft"  element={<ProtectedRoute><ActivitiesPage /></ProtectedRoute>} />
      <Route path="/submissions" element={<ProtectedRoute><SubmissionsPage /></ProtectedRoute>} />
      <Route path="/self-study/:id/analytics" element={<ProtectedRoute><SelfStudyAnalyticsPage /></ProtectedRoute>} />
      <Route path="/wallet" element={<ProtectedRoute><WalletPage /></ProtectedRoute>} />
      <Route path="/purchase" element={<ProtectedRoute><PurchaseCheckoutPage /></ProtectedRoute>} />
      <Route path="/lesson-review" element={<ProtectedRoute><LessonReviewPage /></ProtectedRoute>} />
      <Route path="/documents"     element={<ProtectedRoute><DocumentsPage /></ProtectedRoute>} />
      <Route path="/documents/new" element={<ProtectedRoute><DocumentEditorPage /></ProtectedRoute>} />
      <Route path="/documents/:id" element={<ProtectedRoute><DocumentEditorPage /></ProtectedRoute>} />
      <Route path="/assessments" element={<ProtectedRoute><AssessmentReviewPage /></ProtectedRoute>} />
      <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
      {/* Management (teacher-scoped student info + academics) */}
      <Route path="/mgmt/students"        element={<ProtectedRoute><StudentsPage /></ProtectedRoute>} />
      <Route path="/mgmt/join-requests"   element={<ProtectedRoute><JoinRequestsPage /></ProtectedRoute>} />
      <Route path="/mgmt/students/:id"    element={<ProtectedRoute><StudentProfilePage /></ProtectedRoute>} />
      <Route path="/mgmt/attendance"      element={<ProtectedRoute><StudentAttendancePage /></ProtectedRoute>} />
      <Route path="/mgmt/behavior"        element={<ProtectedRoute><BehaviorRecordsPage /></ProtectedRoute>} />
      <Route path="/mgmt/curriculum"      element={<ProtectedRoute><CurriculumPage /></ProtectedRoute>} />
      <Route path="/mgmt/syllabus"        element={<ProtectedRoute><SyllabusPage /></ProtectedRoute>} />
      <Route path="/mgmt/subjects"        element={<ProtectedRoute><SubjectsPage /></ProtectedRoute>} />
      <Route path="/mgmt/gradebook"      element={<ProtectedRoute><GradebookPage /></ProtectedRoute>} />
      <Route path="/mgmt/my-timetable"    element={<ProtectedRoute><MyTimetablePage /></ProtectedRoute>} />
      <Route path="/mgmt/timetable"       element={<ProtectedRoute><ClassTimetablePage /></ProtectedRoute>} />
      <Route path="/mgmt/weekly-forecast" element={<ProtectedRoute><WeeklyForecastPage /></ProtectedRoute>} />
      <Route path="/mgmt/daily-schedule"  element={<ProtectedRoute><DailySchedulePage /></ProtectedRoute>} />
      <Route path="/settings"       element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="/agent-tools"    element={<ProtectedRoute><AgentToolsPage /></ProtectedRoute>} />
      <Route path="/profile"        element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
      {/* Tools & Assets is retired: the payment return (?tool_ref) lands in the App Center. */}
      <Route path="/marketplace"    element={<MarketplaceRedirect />} />
      <Route path="/apps"           element={<ProtectedRoute><AppCenterPage /></ProtectedRoute>} />
      <Route path="/library"        element={<ProtectedRoute><LibraryPage /></ProtectedRoute>} />
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
