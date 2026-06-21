import { useState } from 'react';
import { Settings, Lock, User, Shield } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Inp, Toast } from '../components/Primitives.jsx';
import { apiPost } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, FONT } from '../constants.js';

export default function SettingsPage() {
  const { user } = useAuth();

  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [toast,  setToast]  = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const setPw = (k) => (e) => setPwForm(f => ({ ...f, [k]: e.target.value }));

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (!pwForm.current) { showToast('Current password is required', 'error'); return; }
    if (pwForm.next.length < 8) { showToast('New password must be at least 8 characters', 'error'); return; }
    if (pwForm.next !== pwForm.confirm) { showToast('New passwords do not match', 'error'); return; }
    setPwBusy(true);
    try {
      await apiPost('/api/auth/change-password', {
        currentPassword: pwForm.current,
        newPassword:     pwForm.next,
      });
      showToast('Password changed successfully');
      setPwForm({ current: '', next: '', confirm: '' });
    } catch (err) {
      showToast(err.message || 'Failed to change password', 'error');
    } finally {
      setPwBusy(false);
    }
  };

  const cardStyle = {
    background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16,
    padding: 24, marginBottom: 20,
  };

  const cardTitle = (label, Icon) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, background: `${AMBER}15`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={18} color={AMBER} />
      </div>
      <span style={{ fontSize: 15, fontWeight: 700, color: INK, fontFamily: FONT }}>{label}</span>
    </div>
  );

  return (
    <PageLayout title="Settings" subtitle="Platform settings and account management">
      <div style={{ maxWidth: 640, margin: '0 auto' }}>

        {/* Platform card — coming soon */}
        <div style={cardStyle}>
          {cardTitle('Platform', Settings)}
          <div style={{
            background: LIGHT, borderRadius: 12, padding: '32px 24px',
            textAlign: 'center', border: `1px dashed ${BORDER}`,
          }}>
            <Settings size={32} color={MUTED} style={{ marginBottom: 12 }} />
            <p style={{ fontSize: 14, color: MUTED, fontFamily: FONT, margin: 0, lineHeight: 1.6 }}>
              Platform-level settings are coming soon.<br />
              Configuration options for branding, payments, and integrations will appear here.
            </p>
          </div>
        </div>

        {/* Admin account card */}
        <div style={cardStyle}>
          {cardTitle('Admin Account', User)}

          {/* Current user info */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '16px', background: LIGHT, borderRadius: 12, marginBottom: 24,
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: `linear-gradient(135deg, ${AMBER}, #D4651E)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 700, color: WHITE, flexShrink: 0,
            }}>
              {(user?.fullName || user?.email || 'A')[0].toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: INK, fontFamily: FONT }}>
                {user?.fullName || user?.username || 'Admin'}
              </div>
              <div style={{ fontSize: 12, color: MUTED, fontFamily: FONT, marginTop: 2 }}>
                {user?.email || '—'}
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                marginTop: 6, padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                background: '#FFE4E4', color: RED,
              }}>
                <Shield size={10} /> {user?.role || 'admin'}
              </div>
            </div>
          </div>

          {/* Change password form */}
          <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Lock size={15} color={MUTED} />
              <span style={{ fontSize: 13, fontWeight: 700, color: INK, fontFamily: FONT }}>Change Password</span>
            </div>
            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Inp
                label="Current Password"
                type="password"
                value={pwForm.current}
                onChange={setPw('current')}
                placeholder="Enter your current password"
                autoComplete="current-password"
              />
              <Inp
                label="New Password"
                type="password"
                value={pwForm.next}
                onChange={setPw('next')}
                placeholder="Minimum 8 characters"
                autoComplete="new-password"
              />
              <Inp
                label="Confirm New Password"
                type="password"
                value={pwForm.confirm}
                onChange={setPw('confirm')}
                placeholder="Repeat new password"
                autoComplete="new-password"
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                <Btn type="submit" disabled={pwBusy}>
                  <Lock size={14} /> {pwBusy ? 'Updating…' : 'Update Password'}
                </Btn>
              </div>
            </form>
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
