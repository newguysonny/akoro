import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { StartupProvider } from './contexts/StartupContext.jsx';
import SigninPage from './pages/auth/SigninPage.jsx';
import SignupPage from './pages/auth/SignupPage.jsx';
import CreateStartupPage from './pages/CreateStartupPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ApiKeysPage from './pages/ApiKeysPage.jsx';
import DiscountTiersPage from './pages/DiscountTiersPage.jsx';
import WalletPage from './pages/WalletPage.jsx';
import RedemptionsPage from './pages/RedemptionsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

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
      <Route path="/api-keys"       element={<ProtectedRoute><ApiKeysPage /></ProtectedRoute>} />
      <Route path="/discounts"      element={<ProtectedRoute><DiscountTiersPage /></ProtectedRoute>} />
      <Route path="/wallet"         element={<ProtectedRoute><WalletPage /></ProtectedRoute>} />
      <Route path="/redemptions"    element={<ProtectedRoute><RedemptionsPage /></ProtectedRoute>} />
      <Route path="/settings"       element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="/signin"         element={<GuestRoute><SigninPage /></GuestRoute>} />
      <Route path="/signup"         element={<GuestRoute><SignupPage /></GuestRoute>} />
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
