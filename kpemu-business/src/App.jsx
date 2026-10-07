import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { StartupProvider } from './contexts/StartupContext.jsx';
import SigninPage from './pages/auth/SigninPage.jsx';
import AuthCallback from './pages/auth/AuthCallback.jsx';
import SignupPage from './pages/auth/SignupPage.jsx';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/auth/ResetPasswordPage.jsx';
import CreateStartupPage from './pages/CreateStartupPage.jsx';
import ManageBusinessesPage from './pages/ManageBusinessesPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ApiKeysPage from './pages/ApiKeysPage.jsx';
import ApiKeyLogsPage from './pages/ApiKeyLogsPage.jsx';
import DiscountTiersPage from './pages/DiscountTiersPage.jsx';
import VoucherProductsPage from './pages/VoucherProductsPage.jsx';
import VouchersGeneratedPage from './pages/VouchersGeneratedPage.jsx';
import WalletPage from './pages/WalletPage.jsx';
import RedemptionsPage from './pages/RedemptionsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import DocsPage from './pages/DocsPage.jsx';
import WebhooksPage from './pages/WebhooksPage.jsx';

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/signin" replace />;
  return children;
}
function GuestRoute({ children }) {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/"               element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/create-startup" element={<ProtectedRoute><CreateStartupPage /></ProtectedRoute>} />
      <Route path="/manage-businesses" element={<ProtectedRoute><ManageBusinessesPage /></ProtectedRoute>} />
      <Route path="/api-keys"       element={<ProtectedRoute><ApiKeysPage /></ProtectedRoute>} />
      <Route path="/api-keys/:keyId/logs" element={<ProtectedRoute><ApiKeyLogsPage /></ProtectedRoute>} />
      <Route path="/discounts"      element={<ProtectedRoute><DiscountTiersPage /></ProtectedRoute>} />
      <Route path="/products"       element={<ProtectedRoute><VoucherProductsPage /></ProtectedRoute>} />
      <Route path="/generated"      element={<ProtectedRoute><VouchersGeneratedPage /></ProtectedRoute>} />
      <Route path="/docs"           element={<ProtectedRoute><DocsPage /></ProtectedRoute>} />
      <Route path="/webhooks"       element={<ProtectedRoute><WebhooksPage /></ProtectedRoute>} />
      <Route path="/wallet"         element={<ProtectedRoute><WalletPage /></ProtectedRoute>} />
      <Route path="/redemptions"    element={<ProtectedRoute><RedemptionsPage /></ProtectedRoute>} />
      <Route path="/settings"       element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="/auth/callback"  element={<AuthCallback />} />
      <Route path="/signin"         element={<GuestRoute><SigninPage /></GuestRoute>} />
      <Route path="/signup"         element={<GuestRoute><SignupPage /></GuestRoute>} />
      <Route path="/forgot-password" element={<GuestRoute><ForgotPasswordPage /></GuestRoute>} />
      <Route path="/reset-password"  element={<GuestRoute><ResetPasswordPage /></GuestRoute>} />
      <Route path="*"               element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <StartupProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </StartupProvider>
    </AuthProvider>
  );
}
