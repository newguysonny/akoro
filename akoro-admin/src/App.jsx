import { BrowserRouter, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import AkoroLogo from './components/common/AkoroLogo.jsx';
import { PageLayout } from './components/Layout.jsx';

import DashboardPage        from './pages/DashboardPage.jsx';
import UsersPage            from './pages/UsersPage.jsx';
import InstructorsPage      from './pages/InstructorsPage.jsx';
import SchoolsPage          from './pages/SchoolsPage.jsx';
import CoursesPage          from './pages/CoursesPage.jsx';
import ProgramCoursesSection from './pages/programmes-page/index.jsx';
import CourseApprovalsSection from './pages/course-approvals/index.jsx';
import AppCenterPage        from './pages/AppCenterPage.jsx';
import AgentsPage           from './pages/AgentsPage.jsx';
import PastQuestionsPage    from './pages/PastQuestionsPage.jsx';
import SyllabusPage         from './pages/SyllabusPage.jsx';
import WebsiteTemplatesPage from './pages/WebsiteTemplatesPage.jsx';
import BlogAdminPage        from './pages/BlogAdminPage.jsx';
import BlogPostEditorPage   from './pages/BlogPostEditorPage.jsx';
import CareersAdminPage     from './pages/CareersAdminPage.jsx';
import AnalyticsPage        from './pages/AnalyticsPage.jsx';
import AiSpendPage          from './pages/AiSpendPage.jsx';
import EvalsPage            from './pages/EvalsPage.jsx';
import PaymentsPage         from './pages/PaymentsPage.jsx';
import PayoutsPage          from './pages/PayoutsPage.jsx';
import ReviewsPage          from './pages/ReviewsPage.jsx';
import CouponsPage          from './pages/CouponsPage.jsx';
import TiersPage            from './pages/TiersPage.jsx';
import PilotSchoolsPage     from './pages/PilotSchoolsPage.jsx';
import AuditLogPage         from './pages/AuditLogPage.jsx';
import SubscriptionsPage   from './pages/SubscriptionsPage.jsx';
import CustomersPage       from './pages/CustomersPage.jsx';
import InvoicesPage        from './pages/InvoicesPage.jsx';
import BillingCouponsPage  from './pages/BillingCouponsPage.jsx';
import BillingOverviewPage from './pages/BillingOverviewPage.jsx';
import ReconciliationPage  from './pages/ReconciliationPage.jsx';
import ReportsPage          from './pages/ReportsPage.jsx';
import NotificationsPage    from './pages/NotificationsPage.jsx';
import MessagesPage         from './pages/MessagesPage.jsx';
import MarketingPage        from './pages/MarketingPage.jsx';
import SettingsPage         from './pages/SettingsPage.jsx';
import WalletPage           from './pages/WalletPage.jsx';
import AgentToolRequestsPage from './pages/AgentToolRequestsPage.jsx';
import AgentToolsPage from './pages/AgentToolsPage.jsx';
import AgentCapabilitiesPage from './pages/AgentCapabilitiesPage.jsx';
import RealAccountChecksPage from './pages/RealAccountChecksPage.jsx';
import ProactiveKindsPage from './pages/ProactiveKindsPage.jsx';
import PrivacyPolicyPage    from './pages/PrivacyPolicyPage.jsx';
import TermsOfServicePage   from './pages/TermsOfServicePage.jsx';
import SigninPage           from './pages/auth/SigninPage.jsx';
import AuthCallback         from './pages/auth/AuthCallback.jsx';
import ForgotPasswordPage   from './pages/auth/ForgotPasswordPage.jsx';
import ResetPasswordPage    from './pages/auth/ResetPasswordPage.jsx';

function AdminRoute({ children }) {
  const { isAuthenticated, user, initializing } = useAuth();
  const location = useLocation();
  if (initializing) return null;
  if (!isAuthenticated) return <Navigate to="/signin" state={{ from: location }} replace />;
  if (user?.role !== 'admin') return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', fontFamily:'DM Sans,sans-serif' }}>
      <div style={{ textAlign:'center' }}>
        <h2 style={{ fontSize:22, marginBottom:8 }}>Access denied</h2>
        <p style={{ color:'#6B6B80', marginBottom:20 }}>This portal is for Akoro admins only.</p>
        <a href="https://akoro.app" style={{ color:'#E8884A', fontWeight:600 }}>Back to Akoro</a>
      </div>
    </div>
  );
  return children;
}

function GuestRoute({ children }) {
  const { isAuthenticated, user, initializing } = useAuth();
  if (initializing) return null;
  if (isAuthenticated && user?.role === 'admin') return <Navigate to="/" replace />;
  return children;
}

const NotFound = () => {
  const AMBER = '#E8884A', INK = '#1A1A2E', MUTED = '#6B6B80', BORDER = '#EDE8E1';
  const links = [
    { to: '/',          label: 'Dashboard' },
    { to: '/users',     label: 'Users' },
    { to: '/courses',   label: 'Courses' },
    { to: '/settings',  label: 'Settings' },
  ];
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh',
      fontFamily:'DM Sans,sans-serif', flexDirection:'column', gap:18, background:'#FAF8F5', padding:24, textAlign:'center' }}>
      <AkoroLogo size={44} radius={12} />
      <h1 style={{ fontSize:64, fontWeight:800, color:AMBER, margin:0, lineHeight:1 }}>404</h1>
      <div>
        <p style={{ color:INK, fontWeight:700, fontSize:18, margin:'0 0 4px' }}>Page not found</p>
        <p style={{ color:MUTED, fontSize:14, margin:0 }}>The page you’re looking for doesn’t exist or has moved.</p>
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:10, justifyContent:'center', marginTop:4 }}>
        {links.map(l => (
          <Link key={l.to} to={l.to} style={{
            padding:'8px 16px', borderRadius:10, border:`1.5px solid ${BORDER}`,
            background:'#fff', color:INK, textDecoration:'none', fontSize:13, fontWeight:600,
          }}>{l.label}</Link>
        ))}
      </div>
      <Link to="/" style={{ color:AMBER, fontWeight:700, textDecoration:'none', fontSize:14, marginTop:4 }}>← Back to Dashboard</Link>
    </div>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/"                  element={<AdminRoute><DashboardPage /></AdminRoute>} />
          <Route path="/users"             element={<AdminRoute><UsersPage /></AdminRoute>} />
          <Route path="/instructors"       element={<AdminRoute><InstructorsPage /></AdminRoute>} />
          <Route path="/schools"           element={<AdminRoute><SchoolsPage /></AdminRoute>} />
          <Route path="/courses"           element={<AdminRoute><CoursesPage /></AdminRoute>} />
          {/* Program Courses — keep the same header/sidebar shell as every admin page. */}
          <Route path="/program-courses/*" element={
            <AdminRoute>
              <PageLayout>
                <ProgramCoursesSection />
              </PageLayout>
            </AdminRoute>
          } />
          {/* Course Approvals — the review queue for instructor-built Course Creator courses. */}
          <Route path="/course-approvals/*" element={
            <AdminRoute>
              <PageLayout title="Course Approvals" subtitle="Review and publish courses instructors submit">
                <CourseApprovalsSection />
              </PageLayout>
            </AdminRoute>
          } />
          <Route path="/app-center"        element={<AdminRoute><AppCenterPage /></AdminRoute>} />
          <Route path="/agents"            element={<AdminRoute><AgentsPage /></AdminRoute>} />
          <Route path="/syllabus"          element={<AdminRoute><SyllabusPage /></AdminRoute>} />
          <Route path="/past-questions"    element={<AdminRoute><PastQuestionsPage /></AdminRoute>} />
          <Route path="/website-templates" element={<AdminRoute><WebsiteTemplatesPage /></AdminRoute>} />
          <Route path="/content/blog"      element={<AdminRoute><BlogAdminPage /></AdminRoute>} />
          <Route path="/content/blog/new"  element={<AdminRoute><BlogPostEditorPage /></AdminRoute>} />
          <Route path="/content/blog/:id"  element={<AdminRoute><BlogPostEditorPage /></AdminRoute>} />
          <Route path="/content/careers"   element={<AdminRoute><CareersAdminPage /></AdminRoute>} />
          <Route path="/analytics"         element={<AdminRoute><AnalyticsPage /></AdminRoute>} />
          <Route path="/ai-spend"          element={<AdminRoute><AiSpendPage /></AdminRoute>} />
          <Route path="/evals"             element={<AdminRoute><EvalsPage /></AdminRoute>} />
          <Route path="/payments"          element={<AdminRoute><PaymentsPage /></AdminRoute>} />
          <Route path="/payouts"           element={<AdminRoute><PayoutsPage /></AdminRoute>} />
          <Route path="/reviews"           element={<AdminRoute><ReviewsPage /></AdminRoute>} />
          <Route path="/coupons"           element={<AdminRoute><CouponsPage /></AdminRoute>} />
          <Route path="/tiers"             element={<AdminRoute><TiersPage /></AdminRoute>} />
          <Route path="/pilot-schools"      element={<AdminRoute><PilotSchoolsPage /></AdminRoute>} />
          <Route path="/audit-log"          element={<AdminRoute><AuditLogPage /></AdminRoute>} />
          <Route path="/subscriptions"       element={<AdminRoute><SubscriptionsPage /></AdminRoute>} />
          <Route path="/billing-customers"   element={<AdminRoute><CustomersPage /></AdminRoute>} />
          <Route path="/invoices"            element={<AdminRoute><InvoicesPage /></AdminRoute>} />
          <Route path="/billing/overview"     element={<AdminRoute><BillingOverviewPage /></AdminRoute>} />
          <Route path="/billing/coupons"      element={<AdminRoute><BillingCouponsPage /></AdminRoute>} />
          <Route path="/billing/reconciliation" element={<AdminRoute><ReconciliationPage /></AdminRoute>} />
          <Route path="/reports"           element={<AdminRoute><ReportsPage /></AdminRoute>} />
          <Route path="/notifications"     element={<AdminRoute><NotificationsPage /></AdminRoute>} />
          <Route path="/messages"          element={<AdminRoute><MessagesPage /></AdminRoute>} />
          <Route path="/marketing"         element={<AdminRoute><MarketingPage /></AdminRoute>} />
          <Route path="/settings"          element={<AdminRoute><SettingsPage /></AdminRoute>} />
          <Route path="/wallet"            element={<AdminRoute><WalletPage /></AdminRoute>} />
          <Route path="/agent-tool-requests" element={<AdminRoute><AgentToolRequestsPage /></AdminRoute>} />
          <Route path="/agent-capabilities/tools" element={<AdminRoute><AgentCapabilitiesPage kind="tools" /></AdminRoute>} />
          <Route path="/agent-capabilities/learner-tools" element={<AdminRoute><AgentToolsPage /></AdminRoute>} />
          <Route path="/agent-capabilities/features" element={<AdminRoute><AgentCapabilitiesPage kind="features" /></AdminRoute>} />
          <Route path="/agent-tools" element={<Navigate to="/agent-capabilities/learner-tools" replace />} />
          <Route path="/real-account-checks" element={<AdminRoute><RealAccountChecksPage /></AdminRoute>} />
          <Route path="/proactive-kinds" element={<AdminRoute><ProactiveKindsPage /></AdminRoute>} />
          <Route path="/privacy"           element={<PrivacyPolicyPage />} />
          <Route path="/terms"             element={<TermsOfServicePage />} />
          <Route path="/signin"            element={<GuestRoute><SigninPage /></GuestRoute>} />
          <Route path="/auth/callback"     element={<AuthCallback />} />
          <Route path="/forgot-password"   element={<GuestRoute><ForgotPasswordPage /></GuestRoute>} />
          <Route path="/reset-password"    element={<ResetPasswordPage />} />
          <Route path="*"                  element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
