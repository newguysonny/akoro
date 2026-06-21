import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';

import DashboardPage        from './pages/DashboardPage.jsx';
import UsersPage            from './pages/UsersPage.jsx';
import InstructorsPage      from './pages/InstructorsPage.jsx';
import CoursesPage          from './pages/CoursesPage.jsx';
import BlogAdminPage        from './pages/BlogAdminPage.jsx';
import BlogPostEditorPage   from './pages/BlogPostEditorPage.jsx';
import CareersAdminPage     from './pages/CareersAdminPage.jsx';
import AnalyticsPage        from './pages/AnalyticsPage.jsx';
import PaymentsPage         from './pages/PaymentsPage.jsx';
import ReviewsPage          from './pages/ReviewsPage.jsx';
import CouponsPage          from './pages/CouponsPage.jsx';
import NotificationsPage    from './pages/NotificationsPage.jsx';
import SettingsPage         from './pages/SettingsPage.jsx';
import PrivacyPolicyPage    from './pages/PrivacyPolicyPage.jsx';
import TermsOfServicePage   from './pages/TermsOfServicePage.jsx';
import SigninPage           from './pages/auth/SigninPage.jsx';
import AuthCallback         from './pages/auth/AuthCallback.jsx';
import ForgotPasswordPage   from './pages/auth/ForgotPasswordPage.jsx';
import ResetPasswordPage    from './pages/auth/ResetPasswordPage.jsx';

function AdminRoute({ children }) {
  const { isAuthenticated, user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
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
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) return null;
  if (isAuthenticated && user?.role === 'admin') return <Navigate to="/" replace />;
  return children;
}

const NotFound = () => (
  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', fontFamily:'DM Sans,sans-serif', flexDirection:'column', gap:12 }}>
    <h1 style={{ fontSize:48, fontWeight:800, color:'#E8884A' }}>404</h1>
    <p style={{ color:'#6B6B80' }}>Page not found.</p>
    <a href="/" style={{ color:'#E8884A', fontWeight:600 }}>← Dashboard</a>
  </div>
);

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/"                  element={<AdminRoute><DashboardPage /></AdminRoute>} />
          <Route path="/users"             element={<AdminRoute><UsersPage /></AdminRoute>} />
          <Route path="/instructors"       element={<AdminRoute><InstructorsPage /></AdminRoute>} />
          <Route path="/courses"           element={<AdminRoute><CoursesPage /></AdminRoute>} />
          <Route path="/content/blog"      element={<AdminRoute><BlogAdminPage /></AdminRoute>} />
          <Route path="/content/blog/new"  element={<AdminRoute><BlogPostEditorPage /></AdminRoute>} />
          <Route path="/content/blog/:id"  element={<AdminRoute><BlogPostEditorPage /></AdminRoute>} />
          <Route path="/content/careers"   element={<AdminRoute><CareersAdminPage /></AdminRoute>} />
          <Route path="/analytics"         element={<AdminRoute><AnalyticsPage /></AdminRoute>} />
          <Route path="/payments"          element={<AdminRoute><PaymentsPage /></AdminRoute>} />
          <Route path="/reviews"           element={<AdminRoute><ReviewsPage /></AdminRoute>} />
          <Route path="/coupons"           element={<AdminRoute><CouponsPage /></AdminRoute>} />
          <Route path="/notifications"     element={<AdminRoute><NotificationsPage /></AdminRoute>} />
          <Route path="/settings"          element={<AdminRoute><SettingsPage /></AdminRoute>} />
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
