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
import { AcademicStaffPage, NonAcademicStaffPage, StaffGroupPage } from './pages/StaffTeamPages.jsx';
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
  AssignClassPage,
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
import {
  OnlineAdmissionsPage, ResultPinsPage, OnlinePaymentsPage,
} from './pages/mgmt/publicPortalPages.jsx';
import {
  AccountsDashboardPage, IncomePage, ExpensePage, IncomeHeadsPage, ExpenseHeadsPage, BankAccountsPage,
} from './pages/mgmt/accountsPages.jsx';
import {
  HRDashboardPage, StaffDirectoryPage, StaffAttendancePage, PayrollPage, SetSalaryPage,
  ApproveLeavePage, LeaveTypesPage, DepartmentsPage, DesignationsPage, LeaveManagementPage,
  StaffIDCardPage, HRSettingsPage, StaffLoansPage, SalaryTemplatesPage,
  AppraisalCyclesPage, AppraisalCriteriaPage, AppraisalsPage,
} from './pages/mgmt/hrPages.jsx';
import { QRAttendancePage, QRSettingsPage, QRReportPage } from './pages/mgmt/qrPages.jsx';
import {
  ExamDashboardPage, ManageOfflineExamsPage, ExamTypesPage, ScheduleMarksSetupPage, EnterMarksPage,
  CocurricularAreasPage, CocurricularGradesPage, ManageGradesPage, ReportCardSetupsPage,
  GenerateMarksheetPage, UploadMarksheetPage, ManageUploadsPage, TeacherRemarksPage,
  ManageOnlineExamsPage, QuestionBankPage,
} from './pages/mgmt/examsPages.jsx';
import {
  CBCDashboardPage, CBCStrandsPage, CBCAssessmentsPage, CoreCompetenciesPage, CBCPathwaysPage, CBCReportsPage,
  PTMDashboardPage, PTMScheduleMeetingsPage, PTMGuidePage, PTMAttendancePage, PTMFollowupsPage, PTMReportsPage,
} from './pages/mgmt/cbcPtmPages.jsx';
import {
  LessonPlannerDashboardPage, LessonPlansPage, LessonPlannerGuidePage, LessonPlanReviewPage,
  LessonPlanApprovalsPage, LessonPlanCoveragePage, LessonPlanReportsPage, LessonPlannerSettingsPage,
  OSMDashboardPage, OSMSessionsPage, OSMEvaluatePage, OSMModerationPage, OSMReportsPage, OSMGuidePage,
} from './pages/mgmt/lessonOsmPages.jsx';
import {
  StudyCenterDashboardPage, ManageSyllabusPage, ClassworkLogbookPage, ManageResourcesPage,
  HomeworkAssignmentsPage, LiveClassesPage,
} from './pages/mgmt/studyCenterPages.jsx';
import {
  CertificateTemplatesPage, GenerateDocumentPage, NoticeBoardPage, EventsHolidaysPage,
  ComposeBroadcastPage, BroadcastHistoryPage, ImageGalleryPage,
} from './pages/mgmt/certsCommsPages.jsx';
import {
  LibraryDashboardPage, IssueReturnBookPage, ManageBooksPage, BookCategoriesPage,
  InventoryDashboardPage, AddStockPage, IssueItemPage, PointOfSalePage, ItemListPage,
  ItemCategoriesPage, SuppliersPage, SalesHistoryPage, PurchaseOrdersPage, GoodsReceiptsPage, SupplierPaymentsPage,
} from './pages/mgmt/libraryInventoryPages.jsx';
import {
  TransportDashboardPage, ManageVehiclesPage, ManageRoutesPage, VehicleTrackingPage,
  HostelDashboardPage, StudentAllocationPage, ManageRoomsPage, RoomTypesPage, ManageHostelsPage,
} from './pages/mgmt/transportHostelPages.jsx';
import {
  HelpCategoriesPage, BrowseArticlesPage, AIChatbotHelpPage,
  AssetDashboardPage, AssetRegisterPage, AssetCategoriesPage, AssetAssignmentsPage,
  AssetDepreciationPage, AssetMaintenancePage, AssetDisposalsPage, AssetAuditsPage, AssetReportsPage,
  ReportsAnalyticsPage,
} from './pages/mgmt/helpAssetsPages.jsx';
import SchoolWebsitePage   from './pages/SchoolWebsitePage.jsx';
import WebsiteTemplatesPage from './pages/WebsiteTemplatesPage.jsx';
import { MediaPage, MediaEditorPage, SitePagesPage, SitePageEditorPage, MenusPage } from './pages/WebsiteBuilderPages.jsx';
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
      <Route path="/staff/academic"          element={<ProtectedRoute><AcademicStaffPage /></ProtectedRoute>} />
      <Route path="/staff/non-academic"      element={<ProtectedRoute><NonAcademicStaffPage /></ProtectedRoute>} />
      <Route path="/staff/:staffClass/:group" element={<ProtectedRoute><StaffGroupPage /></ProtectedRoute>} />
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
      <Route path="/mgmt/assign-class"       element={<ProtectedRoute><AssignClassPage /></ProtectedRoute>} />
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
      <Route path="/mgmt/online-admissions"    element={<ProtectedRoute><OnlineAdmissionsPage /></ProtectedRoute>} />
      <Route path="/mgmt/result-pins"          element={<ProtectedRoute><ResultPinsPage /></ProtectedRoute>} />
      <Route path="/mgmt/online-payments"      element={<ProtectedRoute><OnlinePaymentsPage /></ProtectedRoute>} />
      <Route path="/mgmt/visitor-book"         element={<ProtectedRoute><VisitorBookPage /></ProtectedRoute>} />
      <Route path="/mgmt/complaints"           element={<ProtectedRoute><ComplaintsPage /></ProtectedRoute>} />
      <Route path="/mgmt/postal-records"       element={<ProtectedRoute><PostalRecordsPage /></ProtectedRoute>} />
      {/* Management — Accounts */}
      <Route path="/mgmt/accounts-dashboard" element={<ProtectedRoute><AccountsDashboardPage /></ProtectedRoute>} />
      <Route path="/mgmt/income"             element={<ProtectedRoute><IncomePage /></ProtectedRoute>} />
      <Route path="/mgmt/expense"            element={<ProtectedRoute><ExpensePage /></ProtectedRoute>} />
      <Route path="/mgmt/income-heads"       element={<ProtectedRoute><IncomeHeadsPage /></ProtectedRoute>} />
      <Route path="/mgmt/expense-heads"      element={<ProtectedRoute><ExpenseHeadsPage /></ProtectedRoute>} />
      <Route path="/mgmt/bank-accounts"      element={<ProtectedRoute><BankAccountsPage /></ProtectedRoute>} />
      {/* Management — Human Resource */}
      <Route path="/mgmt/hr-dashboard"        element={<ProtectedRoute><HRDashboardPage /></ProtectedRoute>} />
      <Route path="/mgmt/staff-directory"     element={<ProtectedRoute><StaffDirectoryPage /></ProtectedRoute>} />
      <Route path="/mgmt/staff-attendance-hr" element={<ProtectedRoute><StaffAttendancePage /></ProtectedRoute>} />
      <Route path="/mgmt/payroll"             element={<ProtectedRoute><PayrollPage /></ProtectedRoute>} />
      <Route path="/mgmt/set-salary"          element={<ProtectedRoute><SetSalaryPage /></ProtectedRoute>} />
      <Route path="/mgmt/approve-leave"       element={<ProtectedRoute><ApproveLeavePage /></ProtectedRoute>} />
      <Route path="/mgmt/leave-types"         element={<ProtectedRoute><LeaveTypesPage /></ProtectedRoute>} />
      <Route path="/mgmt/departments"         element={<ProtectedRoute><DepartmentsPage /></ProtectedRoute>} />
      <Route path="/mgmt/designations"        element={<ProtectedRoute><DesignationsPage /></ProtectedRoute>} />
      <Route path="/mgmt/leave-management"    element={<ProtectedRoute><LeaveManagementPage /></ProtectedRoute>} />
      <Route path="/mgmt/staff-id-card"       element={<ProtectedRoute><StaffIDCardPage /></ProtectedRoute>} />
      <Route path="/mgmt/hr-settings"         element={<ProtectedRoute><HRSettingsPage /></ProtectedRoute>} />
      <Route path="/mgmt/staff-loans"         element={<ProtectedRoute><StaffLoansPage /></ProtectedRoute>} />
      <Route path="/mgmt/salary-templates"    element={<ProtectedRoute><SalaryTemplatesPage /></ProtectedRoute>} />
      <Route path="/mgmt/appraisal-cycles"    element={<ProtectedRoute><AppraisalCyclesPage /></ProtectedRoute>} />
      <Route path="/mgmt/appraisal-criteria"  element={<ProtectedRoute><AppraisalCriteriaPage /></ProtectedRoute>} />
      <Route path="/mgmt/appraisals"          element={<ProtectedRoute><AppraisalsPage /></ProtectedRoute>} />
      {/* Management — QR Attendance */}
      <Route path="/mgmt/qr-attendance" element={<ProtectedRoute><QRAttendancePage /></ProtectedRoute>} />
      <Route path="/mgmt/qr-settings"   element={<ProtectedRoute><QRSettingsPage /></ProtectedRoute>} />
      <Route path="/mgmt/qr-report"     element={<ProtectedRoute><QRReportPage /></ProtectedRoute>} />
      {/* Management — Examinations (offline + online) */}
      <Route path="/mgmt/exam-dashboard"      element={<ProtectedRoute><ExamDashboardPage /></ProtectedRoute>} />
      <Route path="/mgmt/offline-exams"       element={<ProtectedRoute><ManageOfflineExamsPage /></ProtectedRoute>} />
      <Route path="/mgmt/exam-types"          element={<ProtectedRoute><ExamTypesPage /></ProtectedRoute>} />
      <Route path="/mgmt/exam-schedules"      element={<ProtectedRoute><ScheduleMarksSetupPage /></ProtectedRoute>} />
      <Route path="/mgmt/enter-marks"         element={<ProtectedRoute><EnterMarksPage /></ProtectedRoute>} />
      <Route path="/mgmt/cocurricular-areas"  element={<ProtectedRoute><CocurricularAreasPage /></ProtectedRoute>} />
      <Route path="/mgmt/cocurricular-grades" element={<ProtectedRoute><CocurricularGradesPage /></ProtectedRoute>} />
      <Route path="/mgmt/manage-grades"       element={<ProtectedRoute><ManageGradesPage /></ProtectedRoute>} />
      <Route path="/mgmt/report-card-setups"  element={<ProtectedRoute><ReportCardSetupsPage /></ProtectedRoute>} />
      <Route path="/mgmt/generate-marksheet"  element={<ProtectedRoute><GenerateMarksheetPage /></ProtectedRoute>} />
      <Route path="/mgmt/upload-marksheet"    element={<ProtectedRoute><UploadMarksheetPage /></ProtectedRoute>} />
      <Route path="/mgmt/manage-uploads"      element={<ProtectedRoute><ManageUploadsPage /></ProtectedRoute>} />
      <Route path="/mgmt/teacher-remarks"     element={<ProtectedRoute><TeacherRemarksPage /></ProtectedRoute>} />
      <Route path="/mgmt/online-exams"        element={<ProtectedRoute><ManageOnlineExamsPage /></ProtectedRoute>} />
      <Route path="/mgmt/question-bank"       element={<ProtectedRoute><QuestionBankPage /></ProtectedRoute>} />
      {/* Management — CBC Academics */}
      <Route path="/mgmt/cbc-dashboard"     element={<ProtectedRoute><CBCDashboardPage /></ProtectedRoute>} />
      <Route path="/mgmt/cbc-strands"       element={<ProtectedRoute><CBCStrandsPage /></ProtectedRoute>} />
      <Route path="/mgmt/cbc-assessments"   element={<ProtectedRoute><CBCAssessmentsPage /></ProtectedRoute>} />
      <Route path="/mgmt/core-competencies" element={<ProtectedRoute><CoreCompetenciesPage /></ProtectedRoute>} />
      <Route path="/mgmt/cbc-pathways"      element={<ProtectedRoute><CBCPathwaysPage /></ProtectedRoute>} />
      <Route path="/mgmt/cbc-reports"       element={<ProtectedRoute><CBCReportsPage /></ProtectedRoute>} />
      {/* Management — PTM Meetings */}
      <Route path="/mgmt/ptm-dashboard"  element={<ProtectedRoute><PTMDashboardPage /></ProtectedRoute>} />
      <Route path="/mgmt/ptm-meetings"   element={<ProtectedRoute><PTMScheduleMeetingsPage /></ProtectedRoute>} />
      <Route path="/mgmt/ptm-guide"      element={<ProtectedRoute><PTMGuidePage /></ProtectedRoute>} />
      <Route path="/mgmt/ptm-attendance" element={<ProtectedRoute><PTMAttendancePage /></ProtectedRoute>} />
      <Route path="/mgmt/ptm-followups"  element={<ProtectedRoute><PTMFollowupsPage /></ProtectedRoute>} />
      <Route path="/mgmt/ptm-reports"    element={<ProtectedRoute><PTMReportsPage /></ProtectedRoute>} />
      {/* Management — Lesson Planner */}
      <Route path="/mgmt/lesson-planner-dashboard" element={<ProtectedRoute><LessonPlannerDashboardPage /></ProtectedRoute>} />
      <Route path="/mgmt/lesson-plans"             element={<ProtectedRoute><LessonPlansPage /></ProtectedRoute>} />
      <Route path="/mgmt/lesson-planner-guide"     element={<ProtectedRoute><LessonPlannerGuidePage /></ProtectedRoute>} />
      <Route path="/mgmt/lesson-plan-review"       element={<ProtectedRoute><LessonPlanReviewPage /></ProtectedRoute>} />
      <Route path="/mgmt/lesson-plan-approvals"    element={<ProtectedRoute><LessonPlanApprovalsPage /></ProtectedRoute>} />
      <Route path="/mgmt/lesson-plan-coverage"     element={<ProtectedRoute><LessonPlanCoveragePage /></ProtectedRoute>} />
      <Route path="/mgmt/lesson-plan-reports"      element={<ProtectedRoute><LessonPlanReportsPage /></ProtectedRoute>} />
      <Route path="/mgmt/lesson-planner-settings"  element={<ProtectedRoute><LessonPlannerSettingsPage /></ProtectedRoute>} />
      {/* Management — OSM */}
      <Route path="/mgmt/osm-dashboard"  element={<ProtectedRoute><OSMDashboardPage /></ProtectedRoute>} />
      <Route path="/mgmt/osm-sessions"   element={<ProtectedRoute><OSMSessionsPage /></ProtectedRoute>} />
      <Route path="/mgmt/osm-evaluate"   element={<ProtectedRoute><OSMEvaluatePage /></ProtectedRoute>} />
      <Route path="/mgmt/osm-reports"    element={<ProtectedRoute><OSMReportsPage /></ProtectedRoute>} />
      <Route path="/mgmt/osm-guide"      element={<ProtectedRoute><OSMGuidePage /></ProtectedRoute>} />
      <Route path="/mgmt/osm-moderation" element={<ProtectedRoute><OSMModerationPage /></ProtectedRoute>} />
      {/* Facilities — Study Center */}
      <Route path="/mgmt/study-center-dashboard" element={<ProtectedRoute><StudyCenterDashboardPage /></ProtectedRoute>} />
      <Route path="/mgmt/manage-syllabus"        element={<ProtectedRoute><ManageSyllabusPage /></ProtectedRoute>} />
      <Route path="/mgmt/classwork-logbook"      element={<ProtectedRoute><ClassworkLogbookPage /></ProtectedRoute>} />
      <Route path="/mgmt/manage-resources"       element={<ProtectedRoute><ManageResourcesPage /></ProtectedRoute>} />
      <Route path="/mgmt/homework-assignments"   element={<ProtectedRoute><HomeworkAssignmentsPage /></ProtectedRoute>} />
      <Route path="/mgmt/live-classes"           element={<ProtectedRoute><LiveClassesPage /></ProtectedRoute>} />
      {/* Facilities — Certificates + Communicate */}
      <Route path="/mgmt/certificate-templates" element={<ProtectedRoute><CertificateTemplatesPage /></ProtectedRoute>} />
      <Route path="/mgmt/generate-document"     element={<ProtectedRoute><GenerateDocumentPage /></ProtectedRoute>} />
      <Route path="/mgmt/notice-board"          element={<ProtectedRoute><NoticeBoardPage /></ProtectedRoute>} />
      <Route path="/mgmt/events-holidays"       element={<ProtectedRoute><EventsHolidaysPage /></ProtectedRoute>} />
      <Route path="/mgmt/compose-broadcast"     element={<ProtectedRoute><ComposeBroadcastPage /></ProtectedRoute>} />
      <Route path="/mgmt/broadcast-history"     element={<ProtectedRoute><BroadcastHistoryPage /></ProtectedRoute>} />
      <Route path="/mgmt/image-gallery"         element={<ProtectedRoute><ImageGalleryPage /></ProtectedRoute>} />
      {/* Facilities — Library */}
      <Route path="/mgmt/library-dashboard" element={<ProtectedRoute><LibraryDashboardPage /></ProtectedRoute>} />
      <Route path="/mgmt/issue-return-book" element={<ProtectedRoute><IssueReturnBookPage /></ProtectedRoute>} />
      <Route path="/mgmt/manage-books"      element={<ProtectedRoute><ManageBooksPage /></ProtectedRoute>} />
      <Route path="/mgmt/book-categories"   element={<ProtectedRoute><BookCategoriesPage /></ProtectedRoute>} />
      {/* Facilities — Inventory */}
      <Route path="/mgmt/inventory-dashboard" element={<ProtectedRoute><InventoryDashboardPage /></ProtectedRoute>} />
      <Route path="/mgmt/issue-item"          element={<ProtectedRoute><IssueItemPage /></ProtectedRoute>} />
      <Route path="/mgmt/add-stock"           element={<ProtectedRoute><AddStockPage /></ProtectedRoute>} />
      <Route path="/mgmt/item-list"           element={<ProtectedRoute><ItemListPage /></ProtectedRoute>} />
      <Route path="/mgmt/item-categories"     element={<ProtectedRoute><ItemCategoriesPage /></ProtectedRoute>} />
      <Route path="/mgmt/suppliers"           element={<ProtectedRoute><SuppliersPage /></ProtectedRoute>} />
      <Route path="/mgmt/point-of-sale"       element={<ProtectedRoute><PointOfSalePage /></ProtectedRoute>} />
      <Route path="/mgmt/sales-history"       element={<ProtectedRoute><SalesHistoryPage /></ProtectedRoute>} />
      <Route path="/mgmt/purchase-orders"     element={<ProtectedRoute><PurchaseOrdersPage /></ProtectedRoute>} />
      <Route path="/mgmt/goods-receipts"      element={<ProtectedRoute><GoodsReceiptsPage /></ProtectedRoute>} />
      <Route path="/mgmt/supplier-payments"   element={<ProtectedRoute><SupplierPaymentsPage /></ProtectedRoute>} />
      {/* Facilities — Transport + Hostel */}
      <Route path="/mgmt/transport-dashboard" element={<ProtectedRoute><TransportDashboardPage /></ProtectedRoute>} />
      <Route path="/mgmt/manage-vehicles"     element={<ProtectedRoute><ManageVehiclesPage /></ProtectedRoute>} />
      <Route path="/mgmt/manage-routes"       element={<ProtectedRoute><ManageRoutesPage /></ProtectedRoute>} />
      <Route path="/mgmt/vehicle-tracking"    element={<ProtectedRoute><VehicleTrackingPage /></ProtectedRoute>} />
      <Route path="/mgmt/hostel-dashboard"    element={<ProtectedRoute><HostelDashboardPage /></ProtectedRoute>} />
      <Route path="/mgmt/student-allocation"  element={<ProtectedRoute><StudentAllocationPage /></ProtectedRoute>} />
      <Route path="/mgmt/manage-rooms"        element={<ProtectedRoute><ManageRoomsPage /></ProtectedRoute>} />
      <Route path="/mgmt/room-types"          element={<ProtectedRoute><RoomTypesPage /></ProtectedRoute>} />
      <Route path="/mgmt/manage-hostels"      element={<ProtectedRoute><ManageHostelsPage /></ProtectedRoute>} />
      {/* Facilities — Help Center + Assets + Reports */}
      <Route path="/mgmt/help-categories"    element={<ProtectedRoute><HelpCategoriesPage /></ProtectedRoute>} />
      <Route path="/mgmt/browse-articles"    element={<ProtectedRoute><BrowseArticlesPage /></ProtectedRoute>} />
      <Route path="/mgmt/ai-chatbot-help"    element={<ProtectedRoute><AIChatbotHelpPage /></ProtectedRoute>} />
      <Route path="/mgmt/asset-dashboard"    element={<ProtectedRoute><AssetDashboardPage /></ProtectedRoute>} />
      <Route path="/mgmt/asset-register"     element={<ProtectedRoute><AssetRegisterPage /></ProtectedRoute>} />
      <Route path="/mgmt/asset-categories"   element={<ProtectedRoute><AssetCategoriesPage /></ProtectedRoute>} />
      <Route path="/mgmt/asset-assignments"  element={<ProtectedRoute><AssetAssignmentsPage /></ProtectedRoute>} />
      <Route path="/mgmt/asset-depreciation" element={<ProtectedRoute><AssetDepreciationPage /></ProtectedRoute>} />
      <Route path="/mgmt/asset-maintenance"  element={<ProtectedRoute><AssetMaintenancePage /></ProtectedRoute>} />
      <Route path="/mgmt/asset-disposals"    element={<ProtectedRoute><AssetDisposalsPage /></ProtectedRoute>} />
      <Route path="/mgmt/asset-audits"       element={<ProtectedRoute><AssetAuditsPage /></ProtectedRoute>} />
      <Route path="/mgmt/asset-reports"      element={<ProtectedRoute><AssetReportsPage /></ProtectedRoute>} />
      <Route path="/mgmt/reports-analytics"  element={<ProtectedRoute><ReportsAnalyticsPage /></ProtectedRoute>} />
      <Route path="/settings-website" element={<ProtectedRoute><SchoolWebsitePage /></ProtectedRoute>} />
      <Route path="/website-builder/media" element={<ProtectedRoute><MediaPage /></ProtectedRoute>} />
      <Route path="/website-builder/media/new" element={<ProtectedRoute><MediaEditorPage /></ProtectedRoute>} />
      <Route path="/website-builder/media/:id" element={<ProtectedRoute><MediaEditorPage /></ProtectedRoute>} />
      <Route path="/website-builder/pages" element={<ProtectedRoute><SitePagesPage /></ProtectedRoute>} />
      <Route path="/website-builder/pages/new" element={<ProtectedRoute><SitePageEditorPage /></ProtectedRoute>} />
      <Route path="/website-builder/pages/:id" element={<ProtectedRoute><SitePageEditorPage /></ProtectedRoute>} />
      <Route path="/website-builder/menus" element={<ProtectedRoute><MenusPage /></ProtectedRoute>} />
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
