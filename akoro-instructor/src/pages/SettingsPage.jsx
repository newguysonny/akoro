import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Languages, Moon, Palette, Bell, MessageCircle, Shield, Key, Lock, PauseCircle, Trash2, HelpCircle, Bug, FileText, Info, Receipt, Wrench } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { PageLayout } from '../components/Layout.jsx';
import { RED } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const BRAND = C.brand;
const FONTF = C.font;

const LANGUAGES = ['English', 'Yoruba', 'Igbo', 'Hausa', 'Pidgin', 'French', 'Arabic'];
const ACCENTS   = [C.brand, '#6C3BFF', '#3B82F6', '#10B981', '#EC4899', '#F59E0B', '#EF4444', '#8B5CF6'];

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
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted2, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: FONTF, marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

function Row({ icon: Icon, ti, label, sublabel, right, onClick, danger }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
        borderBottom: `1px solid ${C.border}`, cursor: onClick ? 'pointer' : 'default',
        color: danger ? RED : C.ink,
        transition: 'background .1s',
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = C.bg; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      {Icon && (
        <div style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
          background: danger ? tint(8, RED) : tint(9, BRAND),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: danger ? RED : BRAND,
        }}>
          <Ico ti={ti} size={16} />
        </div>
      )}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, fontFamily: FONTF }}>{label}</div>
        {sublabel && <div style={{ fontSize: 12, color: C.muted2, fontFamily: FONTF, marginTop: 2 }}>{sublabel}</div>}
      </div>
      {right ?? (onClick && <Ico ti="ti-chevron-right" size={16} color={C.muted2} />)}
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
      <div style={{ maxWidth: 600, margin: '0 auto' }}>

        {/* Billing */}
        <Section title="Billing">
          <Row
            icon={Receipt} ti="ti-receipt"
            label="Order history"
            sublabel="Your tool & asset purchases"
            onClick={() => navigate('/orders')}
            right={<Ico ti="ti-chevron-right" size={18} color={C.muted} />}
          />
        </Section>

        {/* AI agent */}
        <Section title="AI agent">
          <Row
            icon={Wrench} ti="ti-tool"
            label="My agent tools"
            sublabel="Tools your AI Chat agent built for you"
            onClick={() => navigate('/agent-tools')}
            right={<Ico ti="ti-chevron-right" size={18} color={C.muted} />}
          />
        </Section>

        {/* Personalization */}
        <Section title="Personalization">
          <Row
            icon={Languages} ti="ti-language"
            label="Language"
            sublabel={lang}
            right={
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
          <Row
            icon={Moon} ti="ti-moon"
            label="Dark Mode"
            sublabel="Currently in preview"
            right={<Toggle on={darkMode} onChange={() => setDarkMode(p => !p)} />}
          />
          <Row
            icon={Palette} ti="ti-palette"
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
          <Row icon={Bell} ti="ti-bell"        label="New student enrolled"   right={<Toggle on={notif.newStudent}        onChange={() => tog('newStudent')} />} />
          <Row icon={Bell} ti="ti-bell"        label="Session reminders"      right={<Toggle on={notif.sessionReminder}   onChange={() => tog('sessionReminder')} />} />
          <Row icon={Bell} ti="ti-bell"        label="Battle challenges"      right={<Toggle on={notif.battleChallenge}   onChange={() => tog('battleChallenge')} />} />
          <Row icon={Bell} ti="ti-bell"        label="Task deadlines"         right={<Toggle on={notif.taskDeadline}      onChange={() => tog('taskDeadline')} />} />
          <Row icon={Bell} ti="ti-bell"        label="Platform updates"       right={<Toggle on={notif.platformUpdates}   onChange={() => tog('platformUpdates')} />} />
          <Row icon={MessageCircle} ti="ti-message-circle" label="In-app sounds"        right={<Toggle on={notif.inAppSound}        onChange={() => tog('inAppSound')} />} />
          <Row icon={Bell} ti="ti-bell"        label="Desktop push"           right={<Toggle on={notif.desktopPush}       onChange={() => tog('desktopPush')} />} />
        </Section>

        {/* Privacy & Security */}
        <Section title="Privacy & Security">
          <Row icon={Key} ti="ti-key"        label="Change Password"       sublabel="Update your account password"          onClick={() => navigate('/profile')} />
          <Row icon={Shield} ti="ti-shield"     label="Two-Factor Auth"       sublabel="Add an extra layer of security"        onClick={() => navigate('/profile')} />
          <Row icon={Lock} ti="ti-lock"       label="Active Sessions"       sublabel="View and revoke active sessions"       onClick={() => {}} />
          <Row icon={PauseCircle} ti="ti-player-pause" label="Deactivate Account"  sublabel="Temporarily disable your account"      onClick={() => {}} danger />
          <Row icon={Trash2} ti="ti-trash"     label="Delete Account"        sublabel="Permanently remove all your data"      onClick={() => {}} danger />
        </Section>

        {/* Help & Support */}
        <Section title="Help & Support">
          <Row icon={HelpCircle} ti="ti-help-circle" label="Help Centre"     sublabel="Browse guides and FAQs"       onClick={() => {}} />
          <Row icon={Bug} ti="ti-bug"        label="Report a Bug"    sublabel="Something not working right?"  onClick={() => {}} />
          <Row icon={MessageCircle} ti="ti-message-circle" label="Contact Us"   sublabel="Talk to the Akoro team"        onClick={() => {}} />
        </Section>

        {/* About */}
        <Section title="About">
          <Row icon={FileText} ti="ti-file-text" label="Terms of Service"  onClick={() => {}} />
          <Row icon={FileText} ti="ti-file-text" label="Privacy Policy"    onClick={() => {}} />
          <Row icon={Info} ti="ti-info-circle"     label="App Version"       right={<span style={{ fontSize: 13, color: C.muted2, fontFamily: FONTF }}>1.0.0</span>} />
        </Section>

        {/* Sign Out */}
        <div style={{ marginBottom: 32 }}>
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
