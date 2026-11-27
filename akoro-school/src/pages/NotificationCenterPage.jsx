import { useState, useEffect, useMemo } from 'react';
import {
  CreditCard,
  GraduationCap,
  ShieldAlert,
  Send,
  UserPlus,
  Wallet,
  Clock,
  UserX,
  BookOpen,
  KeyRound,
  Laptop,
  Video,
  Library,
  Bus,
  MapPin,
  CheckSquare,
  FileText,
  AlertTriangle,
  ClipboardList,
  Cake,
  LogOut,
  CalendarClock,
  NotebookPen,
  PartyPopper,
  ClipboardCheck,
  UserPlus2,
  Swords,
  ListChecks,
  Megaphone,
  Volume2,
  Monitor,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPut } from '../services/api.js';
import { GREEN, RED, BLUE } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const PREFERENCES = [
  { key: 'newStudent',      label: 'New student enrolled', icon: UserPlus2, ti: 'ti-user-plus', on: true },
  { key: 'sessionReminder', label: 'Session reminders',    icon: Clock, ti: 'ti-clock',     on: true },
  { key: 'battleChallenge', label: 'Battle challenges',    icon: Swords, ti: 'ti-swords',    on: true },
  { key: 'taskDeadline',    label: 'Task deadlines',       icon: ListChecks, ti: 'ti-list-check', on: true },
  { key: 'platformUpdates', label: 'Platform updates',     icon: Megaphone, ti: 'ti-speakerphone', on: false },
  { key: 'inAppSound',      label: 'In-app sounds',        icon: Volume2, ti: 'ti-volume',   on: true },
  { key: 'desktopPush',     label: 'Desktop push',         icon: Monitor, ti: 'ti-device-desktop',   on: false },
];

const ALERTS = [
  { id: 1,  name: 'Parent Fee Paid',        desc: 'Sent to parent when an online fee payment is successful.',    icon: CreditCard, ti: 'ti-credit-card',      color: BLUE,   active: true,  editable: false, push: true,  email: false },
  { id: 2,  name: 'Exam Result',            desc: 'Sent when exam results are published.',                       icon: GraduationCap, ti: 'ti-school',   color: GREEN,  active: true,  editable: true,  push: true,  email: false },
  { id: 3,  name: 'Behaviour Incident',     desc: 'Sent when a behaviour incident is assigned.',                 icon: ShieldAlert, ti: 'ti-shield-exclamation',     color: GREEN,  active: true,  editable: true,  push: true,  email: false },
  { id: 4,  name: 'Student Leave Apply',    desc: 'Sent to staff/guardian when leave is applied.',               icon: Send, ti: 'ti-send',            color: '#F472B6', active: true, editable: false, push: true, email: false },
  { id: 5,  name: 'Online Admission Submit',desc: 'Sent when online admission form is submitted.',               icon: UserPlus, ti: 'ti-user-plus',        color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 6,  name: 'Fee Submission',         desc: 'Sent when fees are successfully paid.',                       icon: Wallet, ti: 'ti-wallet',          color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 7,  name: 'Fee Reminder Due',       desc: 'Sent via Cron Job for pending fees.',                          icon: Clock, ti: 'ti-clock',           color: C.brand,  active: true,  editable: true,  push: true,  email: false },
  { id: 8,  name: 'Student Absent',         desc: 'Sent when a student is marked absent.',                       icon: UserX, ti: 'ti-user-x',           color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 9,  name: 'Homework Assigned',      desc: 'Sent when new homework is created.',                          icon: BookOpen, ti: 'ti-book',        color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 10, name: 'Login Credential',       desc: 'Sent when login details are generated.',                      icon: KeyRound, ti: 'ti-key',        color: '#F472B6', active: true, editable: false, push: true, email: false },
  { id: 11, name: 'Online Exam Publish',    desc: 'Sent when an online exam is published.',                      icon: Laptop, ti: 'ti-device-laptop',          color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 12, name: 'Live Class Start',       desc: 'Sent when a Zoom/GMeet class starts.',                        icon: Video, ti: 'ti-video',           color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 13, name: 'Library Book Issue',     desc: 'Sent when a book is issued.',                                 icon: Library, ti: 'ti-library',         color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 14, name: 'Transport Fees',         desc: 'Sent for transport fee updates.',                             icon: Bus, ti: 'ti-bus',             color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 15, name: 'Bus Proximity Alert',    desc: 'Alert parents when the school bus is approaching their child’s stop.', icon: MapPin, ti: 'ti-map-pin', color: C.brand, active: true, editable: true, push: true, email: false },
  { id: 16, name: 'Student Attendance',     desc: 'Sent when a student is marked as Present or Late.',           icon: CheckSquare, ti: 'ti-square-check',     color: GREEN,  active: true,  editable: true,  push: true,  email: false },
  { id: 17, name: 'Bulk Marksheet Ready',   desc: 'Sent when a bulk marksheet generation is complete.',          icon: FileText, ti: 'ti-file-text',        color: BLUE,   active: true,  editable: false, push: true,  email: false },
  { id: 18, name: 'Bulk Marksheet Failed',  desc: 'Sent when a bulk marksheet generation fails.',                icon: AlertTriangle, ti: 'ti-alert-triangle',   color: C.brand,  active: true,  editable: false, push: true,  email: false },
  { id: 19, name: 'Due Slip Generated',     desc: 'Notify parents when monthly due slips are generated.',        icon: ClipboardList, ti: 'ti-clipboard-list',   color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 20, name: 'Student Birthday',       desc: 'Sent to parents on student’s birthday.',                 icon: Cake, ti: 'ti-cake',            color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 21, name: 'Student Punch Out',      desc: 'Sent to parents when a student punches out.',                 icon: LogOut, ti: 'ti-logout',          color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 22, name: 'Ptm Scheduled',          desc: 'Sent to guardians when a Parent-Teacher Meeting is scheduled.', icon: CalendarClock, ti: 'ti-calendar-clock', color: C.muted2, active: false, editable: true,  push: false, email: false },
  { id: 23, name: 'Lesson Plan Reminder',   desc: 'Weekly reminder to teachers to submit plans for the coming week.', icon: NotebookPen, ti: 'ti-notebook', color: C.muted2, active: false, editable: true,  push: false, email: false },
  { id: 24, name: 'Staff Birthday',         desc: 'Sent to staff members on their birthday.',                    icon: PartyPopper, ti: 'ti-confetti',     color: C.muted2, active: false, editable: true,  push: false, email: false },
  { id: 25, name: 'Assessment Result Published', desc: 'Sent to a parent/student when a continuous-assessment result is published.', icon: ClipboardCheck, ti: 'ti-clipboard-check', color: C.muted2, active: false, editable: false, push: false, email: false },
];

function MiniToggle({ on, disabled, onChange }) {
  return (
    <button disabled={disabled} onClick={() => onChange(!on)} style={{
      width: 38, height: 21, borderRadius: 999, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
      background: disabled ? C.border : (on ? BLUE : C.border), position: 'relative', flexShrink: 0, opacity: disabled ? .6 : 1,
    }}>
      <span style={{ position: 'absolute', top: 2.5, left: on ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: C.surface, transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.25)' }} />
    </button>
  );
}
function LockedCell() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.muted2, fontFamily: C.font }}>
      <Ico ti="ti-lock" size={11} /> Locked
    </span>
  );
}
function StatCard({ n, label, color }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', minWidth: 130, flex: 1 }}>
      <div style={{ fontSize: 26, fontWeight: 800, color, fontFamily: C.font }}>{n}</div>
      <div style={{ fontSize: 12, color: C.muted2, fontFamily: C.font, marginTop: 2 }}>{label}</div>
    </div>
  );
}

export default function NotificationCenterPage() {
  const [rows, setRows] = useState(ALERTS.map((a) => ({ ...a, push: a.push })));
  const [query, setQuery] = useState('');
  const [prefs, setPrefs] = useState(() => Object.fromEntries(PREFERENCES.map((p) => [p.key, p.on])));
  const [loading, setLoading] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    Promise.all([
      apiGet('/api/school/settings'),
      apiGet('/api/school/notifications/alerts'),
    ]).then(([settingsRes, alertsRes]) => {
      const savedPrefs = settingsRes.data?.notificationPrefs || {};
      setPrefs((prev) => ({ ...prev, ...savedPrefs }));

      const overrides = alertsRes.data || {};
      setRows(ALERTS.map((a) => {
        const o = overrides[a.id] || {};
        return { ...a, push: o.push !== undefined ? o.push : a.push };
      }));
    }).catch((e) => showToast(e.message || 'Could not load notification settings'))
      .finally(() => setLoading(false));
  }, []);

  const togglePush = async (id) => {
    const row = rows.find((r) => r.id === id);
    const next = !row.push;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, push: next } : r)));
    try { await apiPut(`/api/school/notifications/alerts/${id}`, { push: next }); }
    catch (e) { showToast(e.message || 'Could not save'); setRows((prev) => prev.map((r) => (r.id === id ? { ...r, push: !next } : r))); }
  };
  const togglePref = (key) => setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));

  const savePrefs = async () => {
    setSavingPrefs(true);
    try {
      await apiPut('/api/school/settings/notification-prefs', prefs);
      showToast('Notification preferences saved ✓');
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setSavingPrefs(false); }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q));
  }, [rows, query]);

  const total       = rows.length;
  const activeCount = rows.filter((r) => r.active).length;
  const smsLocked    = rows.length; // all SMS cells are locked in this mock
  const whatsapp     = 0;

  return (
    <PageLayout title="Notification Center" subtitle="Manage how and when you receive automated alerts">
      {/* Stat cards */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatCard n={total}       label="Total Alerts"    color={C.ink} />
        <StatCard n={activeCount} label="Active Alerts"   color={GREEN} />
        <StatCard n={smsLocked}   label="SMS Locked"      color={RED} />
        <StatCard n={whatsapp}    label="WhatsApp Enabled" color={BLUE} />
      </div>

      {/* Notification preferences */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 20px', marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Ico ti="ti-bell" size={16} color={C.brand} />
            <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, fontFamily: C.font }}>Notification Preferences</span>
          </div>
          <button onClick={savePrefs} disabled={savingPrefs} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: savingPrefs ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: savingPrefs ? C.muted2 : '#fff', fontSize: 12, fontWeight: 800, cursor: savingPrefs ? 'default' : 'pointer', fontFamily: C.font }}>
            {savingPrefs ? <Ico ti="ti-loader-2" size={12} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-device-floppy" size={12} />} {savingPrefs ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 4 }}>
          {PREFERENCES.map((p) => (
            <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 4px' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: tint(8), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Ico lucide={p.icon} ti={p.ti} size={15} color={C.brand} />
              </div>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: C.font }}>{p.label}</span>
              <MiniToggle on={prefs[p.key]} onChange={() => togglePref(p.key)} />
            </div>
          ))}
        </div>
      </div>

      {/* Search + config toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 220 }}>
          <Ico ti="ti-search" size={15} color={C.muted2} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notifications…"
            style={{ width: '100%', padding: '10px 13px 10px 36px', borderRadius: 10, border: `1.5px solid ${C.border}`, outline: 'none', fontSize: 13, fontFamily: C.font, color: C.ink, background: C.surface, boxSizing: 'border-box' }} />
        </div>
        <button style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 9, border: `1.5px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}>
          <Ico ti="ti-help-circle" size={14} /> How it Works
        </button>
      </div>

      {/* Table */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: C.font, minWidth: 680 }}>
            <thead>
              <tr style={{ background: C.bg }}>
                <th style={{ textAlign: 'left',  padding: '11px 12px', fontSize: 10.5, fontWeight: 800, color: C.muted2, letterSpacing: .5 }}>#</th>
                <th style={{ textAlign: 'left',  padding: '11px 12px', fontSize: 10.5, fontWeight: 800, color: C.muted2, letterSpacing: .5 }}>ALERT &amp; DESCRIPTION</th>
                <th style={{ textAlign: 'left',  padding: '11px 12px', fontSize: 10.5, fontWeight: 800, color: C.muted2, letterSpacing: .5 }}>STATUS</th>
                <th style={{ textAlign: 'center', padding: '11px 12px', fontSize: 10.5, fontWeight: 800, color: C.muted2, letterSpacing: .5 }}>EMAIL</th>
                <th style={{ textAlign: 'center', padding: '11px 12px', fontSize: 10.5, fontWeight: 800, color: C.muted2, letterSpacing: .5 }}>SMS</th>
                <th style={{ textAlign: 'center', padding: '11px 12px', fontSize: 10.5, fontWeight: 800, color: C.muted2, letterSpacing: .5 }}>WHATSAPP</th>
                <th style={{ textAlign: 'center', padding: '11px 12px', fontSize: 10.5, fontWeight: 800, color: C.muted2, letterSpacing: .5 }}>PUSH</th>
                <th style={{ textAlign: 'center', padding: '11px 12px', fontSize: 10.5, fontWeight: 800, color: C.muted2, letterSpacing: .5 }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '11px 12px', fontSize: 12.5, color: C.muted2 }}>{r.id}</td>
                  <td style={{ padding: '11px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: tint(9, r.color), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Ico lucide={r.icon} ti={r.ti} size={15} color={r.color} />
                      </div>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 700, color: C.ink, margin: 0 }}>{r.name}</p>
                        <p style={{ fontSize: 11, color: C.muted2, margin: '2px 0 0', lineHeight: 1.4, maxWidth: 260 }}>{r.desc}</p>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '11px 12px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: r.active ? GREEN : C.muted2 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: r.active ? GREEN : C.muted2 }} /> {r.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '11px 12px', textAlign: 'center' }}><MiniToggle on={false} disabled onChange={() => {}} /></td>
                  <td style={{ padding: '11px 12px', textAlign: 'center' }}><LockedCell /></td>
                  <td style={{ padding: '11px 12px', textAlign: 'center' }}><MiniToggle on={false} disabled onChange={() => {}} /></td>
                  <td style={{ padding: '11px 12px', textAlign: 'center' }}><MiniToggle on={r.push} disabled={!r.active} onChange={() => togglePush(r.id)} /></td>
                  <td style={{ padding: '11px 12px', textAlign: 'center' }}>
                    {r.editable ? (
                      <button style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 8, border: `1.5px solid ${BLUE}44`, background: `${BLUE}0C`, color: BLUE, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
                        <Ico ti="ti-edit" size={11} /> Edit
                      </button>
                    ) : <span style={{ color: C.muted2 }}>—</span>}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: C.muted2, fontSize: 13 }}>No alerts match your search.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', padding: '14px 16px', borderTop: `1px solid ${C.border}`, background: C.bg }}>
          <div style={{ fontSize: 11, color: C.muted2, lineHeight: 1.6, fontFamily: C.font }}>
            <div><Ico ti="ti-lock" size={10} style={{ marginRight: 4, verticalAlign: -1 }} /> SMS requires the feature to be enabled by the Super Admin.</div>
            <div><Ico ti="ti-lock" size={10} style={{ marginRight: 4, verticalAlign: -1 }} /> WhatsApp requires the API configuration to be active above.</div>
            <div><Ico ti="ti-lock" size={10} style={{ marginRight: 4, verticalAlign: -1 }} /> Push requires Firebase to be enabled above.</div>
          </div>
          <button onClick={() => showToast('Alert preferences are saved automatically ✓')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 10, border: 'none', background: BLUE, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font, whiteSpace: 'nowrap' }}>
            <Ico ti="ti-device-floppy" size={14} /> Save Notification Preferences
          </button>
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
