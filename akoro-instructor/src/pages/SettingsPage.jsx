import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { PageLayout } from '../components/Layout.jsx';
import { RED } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';
import { BRAND } from '../ui/tokens.js';
import { SettingsCard, SettingsGroup } from '../shared/SettingsCard.jsx';

const FONTF = C.font;

const LANGUAGES = ['English', 'Yoruba', 'Igbo', 'Hausa', 'Pidgin', 'French', 'Arabic'];
const ACCENTS   = [C.brand, '#6C3BFF', '#3B82F6', '#10B981', '#EC4899', '#F59E0B', '#EF4444', '#8B5CF6'];

const NOTIF_ROWS = [
  { key: 'newStudent',       ti: 'ti-bell',           label: 'New student enrolled' },
  { key: 'sessionReminder',  ti: 'ti-bell',           label: 'Session reminders' },
  { key: 'battleChallenge',  ti: 'ti-bell',           label: 'Battle challenges' },
  { key: 'taskDeadline',     ti: 'ti-bell',           label: 'Task deadlines' },
  { key: 'platformUpdates',  ti: 'ti-bell',           label: 'Platform updates' },
  { key: 'inAppSound',       ti: 'ti-message-circle', label: 'In-app sounds' },
  { key: 'desktopPush',      ti: 'ti-bell',           label: 'Desktop push' },
];

const CHEVRON = <Ico ti="ti-chevron-right" size={18} color={C.muted} />;
const groupStyle = { marginBottom: 24 };

/* ── Micro-components ────────────────────────────────────────────────── */
function Toggle({ on, onChange }) {
  return (
    <div onClick={onChange} style={{
      width: 42, height: 23, borderRadius: 12, position: 'relative',
      background: on ? C.brand : '#E5E7EB', transition: 'background .25s',
      cursor: 'pointer', flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', top: 2.5, left: on ? 21 : 2.5,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        transition: 'left .25s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
      }} />
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────── */
export default function SettingsPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [lang, setLang]         = useState('English');
  const [darkMode, setDarkMode] = useState(false);
  const [accent, setAccent]     = useState(C.brand);

  const [notif, setNotif] = useState({
    newStudent: true, sessionReminder: true, battleChallenge: true,
    taskDeadline: true, platformUpdates: false, marketingEmails: false,
    inAppSound: true, desktopPush: false,
  });
  const tog = key => setNotif(p => ({ ...p, [key]: !p[key] }));

  const [showLogout, setShowLogout] = useState(false);

  return (
    <PageLayout title="Settings" subtitle="Manage your preferences and account security">
      <div style={{ fontFamily: FONTF }}>

        {/* Billing */}
        <SettingsGroup title="Billing" style={groupStyle}>
          <SettingsCard
            color={BRAND}
            icon={<Ico ti="ti-receipt" size={18} color={BRAND} />}
            title="Order history"
            subtitle="Your tool & asset purchases"
            onClick={() => navigate('/orders')}
            chevron={CHEVRON}
          />
        </SettingsGroup>

        {/* AI agent */}
        <SettingsGroup title="AI agent" style={groupStyle}>
          <SettingsCard
            color={BRAND}
            icon={<Ico ti="ti-tool" size={18} color={BRAND} />}
            title="My agent tools"
            subtitle="Tools your AI Chat agent built for you"
            onClick={() => navigate('/agent-tools')}
            chevron={CHEVRON}
          />
        </SettingsGroup>

        {/* Personalization */}
        <SettingsGroup title="Personalization" style={groupStyle}>
          <SettingsCard
            color={BRAND}
            icon={<Ico ti="ti-language" size={18} color={BRAND} />}
            title="Language"
            subtitle={lang}
            chevron={
              <select
                value={lang}
                onChange={e => setLang(e.target.value)}
                style={{
                  border: `1.5px solid ${C.border}`, borderRadius: 8,
                  padding: '6px 10px', fontFamily: FONTF, fontSize: 13,
                  background: C.surface, color: C.ink, cursor: 'pointer',
                }}
              >
                {LANGUAGES.map(l => <option key={l}>{l}</option>)}
              </select>
            }
          />
          <SettingsCard
            color={BRAND}
            icon={<Ico ti="ti-moon" size={18} color={BRAND} />}
            title="Dark Mode"
            subtitle="Currently in preview"
            chevron={<Toggle on={darkMode} onChange={() => setDarkMode(p => !p)} />}
          />
          <SettingsCard
            color={BRAND}
            icon={<Ico ti="ti-palette" size={18} color={BRAND} />}
            title="Accent Colour"
            chevron={
              <div style={{ display: 'flex', gap: 6 }}>
                {ACCENTS.map(c => (
                  <div
                    key={c}
                    onClick={() => setAccent(c)}
                    style={{
                      width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer',
                      outline: accent === c ? `2px solid ${c}` : 'none',
                      outlineOffset: 2,
                    }}
                  />
                ))}
              </div>
            }
          />
        </SettingsGroup>

        {/* Notifications */}
        <SettingsGroup title="Notifications" style={groupStyle}>
          {NOTIF_ROWS.map(({ key, ti, label }) => (
            <SettingsCard
              key={key}
              color={BRAND}
              icon={<Ico ti={ti} size={18} color={BRAND} />}
              title={label}
              chevron={<Toggle on={notif[key]} onChange={() => tog(key)} />}
            />
          ))}
        </SettingsGroup>

        {/* Privacy & Security */}
        <SettingsGroup title="Privacy & Security" style={groupStyle}>
          <SettingsCard
            color={BRAND}
            icon={<Ico ti="ti-key" size={18} color={BRAND} />}
            title="Change Password"
            subtitle="Update your account password"
            onClick={() => navigate('/profile')}
            chevron={CHEVRON}
          />
          <SettingsCard
            color={BRAND}
            icon={<Ico ti="ti-shield" size={18} color={BRAND} />}
            title="Two-Factor Auth"
            subtitle="Add an extra layer of security"
            onClick={() => navigate('/profile')}
            chevron={CHEVRON}
          />
          <SettingsCard
            color={BRAND}
            icon={<Ico ti="ti-lock" size={18} color={BRAND} />}
            title="Active Sessions"
            subtitle="View and revoke active sessions"
            onClick={() => {}}
            chevron={CHEVRON}
          />
          <SettingsCard
            color={RED}
            icon={<Ico ti="ti-player-pause" size={18} color={RED} />}
            title={<span style={{ color: RED }}>Deactivate Account</span>}
            subtitle="Temporarily disable your account"
            onClick={() => {}}
            chevron={CHEVRON}
          />
          <SettingsCard
            color={RED}
            icon={<Ico ti="ti-trash" size={18} color={RED} />}
            title={<span style={{ color: RED }}>Delete Account</span>}
            subtitle="Permanently remove all your data"
            onClick={() => {}}
            chevron={CHEVRON}
          />
        </SettingsGroup>

        {/* Help & Support */}
        <SettingsGroup title="Help & Support" style={groupStyle}>
          <SettingsCard
            color={BRAND}
            icon={<Ico ti="ti-help-circle" size={18} color={BRAND} />}
            title="Help Centre"
            subtitle="Browse guides and FAQs"
            onClick={() => {}}
            chevron={CHEVRON}
          />
          <SettingsCard
            color={BRAND}
            icon={<Ico ti="ti-bug" size={18} color={BRAND} />}
            title="Report a Bug"
            subtitle="Something not working right?"
            onClick={() => {}}
            chevron={CHEVRON}
          />
          <SettingsCard
            color={BRAND}
            icon={<Ico ti="ti-message-circle" size={18} color={BRAND} />}
            title="Contact Us"
            subtitle="Talk to the Akoro team"
            onClick={() => {}}
            chevron={CHEVRON}
          />
        </SettingsGroup>

        {/* About */}
        <SettingsGroup title="About" style={groupStyle}>
          <SettingsCard
            color={BRAND}
            icon={<Ico ti="ti-file-text" size={18} color={BRAND} />}
            title="Terms of Service"
            onClick={() => {}}
            chevron={CHEVRON}
          />
          <SettingsCard
            color={BRAND}
            icon={<Ico ti="ti-file-text" size={18} color={BRAND} />}
            title="Privacy Policy"
            onClick={() => {}}
            chevron={CHEVRON}
          />
          <SettingsCard
            color={BRAND}
            icon={<Ico ti="ti-info-circle" size={18} color={BRAND} />}
            title="App Version"
            chevron={<span style={{ fontSize: 13, color: C.muted2, fontFamily: FONTF }}>1.0.0</span>}
          />
        </SettingsGroup>

        {/* Sign Out */}
        <div style={{ margin: '0 16px 32px' }}>
          {!showLogout ? (
            <button
              onClick={() => setShowLogout(true)}
              style={{
                width: '100%', padding: '14px', borderRadius: 12,
                border: `1.5px solid ${tint(25, RED)}`, background: tint(3, RED),
                color: RED, fontFamily: FONTF, fontSize: 14, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Sign Out
            </button>
          ) : (
            <div style={{
              background: C.surface, border: `1.5px solid ${C.border}`,
              borderRadius: 14, padding: 20, textAlign: 'center',
            }}>
              <p style={{ fontFamily: FONTF, fontSize: 14, color: C.ink, marginBottom: 16 }}>
                Sign out of Akoro?
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => setShowLogout(false)}
                  style={{
                    flex: 1, padding: '11px', borderRadius: 10,
                    border: `1.5px solid ${C.border}`, background: C.surface,
                    fontFamily: FONTF, fontSize: 14, cursor: 'pointer', color: C.ink,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={logout}
                  style={{
                    flex: 1, padding: '11px', borderRadius: 10,
                    border: 'none', background: RED,
                    fontFamily: FONTF, fontSize: 14, cursor: 'pointer',
                    color: '#fff', fontWeight: 600,
                  }}
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
