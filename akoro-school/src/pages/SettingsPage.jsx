import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Languages, Moon, Palette, Bell, MessageCircle, Shield, Key, Lock,
  PauseCircle, Trash2, HelpCircle, Bug, FileText, Info, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { PageLayout } from '../components/Layout.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, RED, FONT } from '../constants.js';

const BRAND = AMBER;
const FONTF = FONT;

const LANGUAGES = ['English', 'Yoruba', 'Igbo', 'Hausa', 'Pidgin', 'French', 'Arabic'];
const ACCENTS   = [AMBER, '#6C3BFF', '#3B82F6', '#10B981', '#EC4899', '#F59E0B', '#EF4444', '#8B5CF6'];

/* ── Micro-components ────────────────────────────────────────────────── */
function Toggle({ on, onChange }) {
  return (
    <div onClick={onChange} style={{
      width: 42, height: 23, borderRadius: 12, position: 'relative',
      background: on ? BRAND : '#E5E7EB', transition: 'background .25s',
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

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: MUTED2, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: FONTF, marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ background: WHITE, borderRadius: 14, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, sublabel, right, onClick, danger }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
        borderBottom: `1px solid ${BORDER}`, cursor: onClick ? 'pointer' : 'default',
        color: danger ? RED : INK,
        transition: 'background .1s',
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = LIGHT; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      {Icon && (
        <div style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
          background: danger ? `${RED}15` : `${BRAND}18`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: danger ? RED : BRAND,
        }}>
          <Icon size={16} />
        </div>
      )}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, fontFamily: FONTF }}>{label}</div>
        {sublabel && <div style={{ fontSize: 12, color: MUTED2, fontFamily: FONTF, marginTop: 2 }}>{sublabel}</div>}
      </div>
      {right ?? (onClick && <ChevronRight size={16} color={MUTED2} />)}
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────── */
export default function SettingsPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [lang, setLang]         = useState('English');
  const [darkMode, setDarkMode] = useState(false);
  const [accent, setAccent]     = useState(AMBER);

  const [notif, setNotif] = useState({
    newStudent: true, sessionReminder: true, battleChallenge: true,
    taskDeadline: true, platformUpdates: false, marketingEmails: false,
    inAppSound: true, desktopPush: false,
  });
  const tog = key => setNotif(p => ({ ...p, [key]: !p[key] }));

  const [showLogout, setShowLogout] = useState(false);

  return (
    <PageLayout title="Settings" subtitle="Manage your preferences and account security">
      <div style={{ maxWidth: 600, margin: '0 auto' }}>

        {/* Personalization */}
        <Section title="Personalization">
          <Row
            icon={Languages}
            label="Language"
            sublabel={lang}
            right={
              <select
                value={lang}
                onChange={e => setLang(e.target.value)}
                style={{
                  border: `1.5px solid ${BORDER}`, borderRadius: 8,
                  padding: '6px 10px', fontFamily: FONTF, fontSize: 13,
                  background: WHITE, color: INK, cursor: 'pointer',
                }}
              >
                {LANGUAGES.map(l => <option key={l}>{l}</option>)}
              </select>
            }
          />
          <Row
            icon={Moon}
            label="Dark Mode"
            sublabel="Currently in preview"
            right={<Toggle on={darkMode} onChange={() => setDarkMode(p => !p)} />}
          />
          <Row
            icon={Palette}
            label="Accent Colour"
            right={
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
        </Section>

        {/* Notifications */}
        <Section title="Notifications">
          <Row icon={Bell}        label="New student enrolled"   right={<Toggle on={notif.newStudent}        onChange={() => tog('newStudent')} />} />
          <Row icon={Bell}        label="Session reminders"      right={<Toggle on={notif.sessionReminder}   onChange={() => tog('sessionReminder')} />} />
          <Row icon={Bell}        label="Battle challenges"      right={<Toggle on={notif.battleChallenge}   onChange={() => tog('battleChallenge')} />} />
          <Row icon={Bell}        label="Task deadlines"         right={<Toggle on={notif.taskDeadline}      onChange={() => tog('taskDeadline')} />} />
          <Row icon={Bell}        label="Platform updates"       right={<Toggle on={notif.platformUpdates}   onChange={() => tog('platformUpdates')} />} />
          <Row icon={MessageCircle} label="In-app sounds"        right={<Toggle on={notif.inAppSound}        onChange={() => tog('inAppSound')} />} />
          <Row icon={Bell}        label="Desktop push"           right={<Toggle on={notif.desktopPush}       onChange={() => tog('desktopPush')} />} />
        </Section>

        {/* Privacy & Security */}
        <Section title="Privacy & Security">
          <Row icon={Key}        label="Change Password"       sublabel="Update your account password"          onClick={() => navigate('/profile')} />
          <Row icon={Shield}     label="Two-Factor Auth"       sublabel="Add an extra layer of security"        onClick={() => navigate('/profile')} />
          <Row icon={Lock}       label="Active Sessions"       sublabel="View and revoke active sessions"       onClick={() => {}} />
          <Row icon={PauseCircle} label="Deactivate Account"  sublabel="Temporarily disable your account"      onClick={() => {}} danger />
          <Row icon={Trash2}     label="Delete Account"        sublabel="Permanently remove all your data"      onClick={() => {}} danger />
        </Section>

        {/* Help & Support */}
        <Section title="Help & Support">
          <Row icon={HelpCircle} label="Help Centre"     sublabel="Browse guides and FAQs"       onClick={() => {}} />
          <Row icon={Bug}        label="Report a Bug"    sublabel="Something not working right?"  onClick={() => {}} />
          <Row icon={MessageCircle} label="Contact Us"   sublabel="Talk to the Akoro team"        onClick={() => {}} />
        </Section>

        {/* About */}
        <Section title="About">
          <Row icon={FileText} label="Terms of Service"  onClick={() => {}} />
          <Row icon={FileText} label="Privacy Policy"    onClick={() => {}} />
          <Row icon={Info}     label="App Version"       right={<span style={{ fontSize: 13, color: MUTED2, fontFamily: FONTF }}>1.0.0</span>} />
        </Section>

        {/* Sign Out */}
        <div style={{ marginBottom: 32 }}>
          {!showLogout ? (
            <button
              onClick={() => setShowLogout(true)}
              style={{
                width: '100%', padding: '14px', borderRadius: 12,
                border: `1.5px solid ${RED}40`, background: `${RED}08`,
                color: RED, fontFamily: FONTF, fontSize: 14, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Sign Out
            </button>
          ) : (
            <div style={{
              background: WHITE, border: `1.5px solid ${BORDER}`,
              borderRadius: 14, padding: 20, textAlign: 'center',
            }}>
              <p style={{ fontFamily: FONTF, fontSize: 14, color: INK, marginBottom: 16 }}>
                Sign out of Akoro?
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => setShowLogout(false)}
                  style={{
                    flex: 1, padding: '11px', borderRadius: 10,
                    border: `1.5px solid ${BORDER}`, background: WHITE,
                    fontFamily: FONTF, fontSize: 14, cursor: 'pointer', color: INK,
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
                    color: WHITE, fontWeight: 600,
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
