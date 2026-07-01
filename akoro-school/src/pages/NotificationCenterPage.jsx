import { useState, useMemo } from 'react';
import {
  Bell, Search, HelpCircle, CheckCircle2, Lock, MessageCircle, Save,
  CreditCard, GraduationCap, ShieldAlert, Send, UserPlus, Wallet, Clock,
  UserX, BookOpen, KeyRound, Laptop, Video, Library, Bus, MapPin,
  CheckSquare, FileText, AlertTriangle, ClipboardList, Cake, LogOut,
  CalendarClock, NotebookPen, PartyPopper, ClipboardCheck, Edit3, Settings,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, FONT } from '../constants.js';

const ALERTS = [
  { id: 1,  name: 'Parent Fee Paid',        desc: 'Sent to parent when an online fee payment is successful.',    icon: CreditCard,      color: BLUE,   active: true,  editable: false, push: true,  email: false },
  { id: 2,  name: 'Exam Result',            desc: 'Sent when exam results are published.',                       icon: GraduationCap,   color: GREEN,  active: true,  editable: true,  push: true,  email: false },
  { id: 3,  name: 'Behaviour Incident',     desc: 'Sent when a behaviour incident is assigned.',                 icon: ShieldAlert,     color: GREEN,  active: true,  editable: true,  push: true,  email: false },
  { id: 4,  name: 'Student Leave Apply',    desc: 'Sent to staff/guardian when leave is applied.',               icon: Send,            color: '#F472B6', active: true, editable: false, push: true, email: false },
  { id: 5,  name: 'Online Admission Submit',desc: 'Sent when online admission form is submitted.',               icon: UserPlus,        color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 6,  name: 'Fee Submission',         desc: 'Sent when fees are successfully paid.',                       icon: Wallet,          color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 7,  name: 'Fee Reminder Due',       desc: 'Sent via Cron Job for pending fees.',                          icon: Clock,           color: AMBER,  active: true,  editable: true,  push: true,  email: false },
  { id: 8,  name: 'Student Absent',         desc: 'Sent when a student is marked absent.',                       icon: UserX,           color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 9,  name: 'Homework Assigned',      desc: 'Sent when new homework is created.',                          icon: BookOpen,        color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 10, name: 'Login Credential',       desc: 'Sent when login details are generated.',                      icon: KeyRound,        color: '#F472B6', active: true, editable: false, push: true, email: false },
  { id: 11, name: 'Online Exam Publish',    desc: 'Sent when an online exam is published.',                      icon: Laptop,          color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 12, name: 'Live Class Start',       desc: 'Sent when a Zoom/GMeet class starts.',                        icon: Video,           color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 13, name: 'Library Book Issue',     desc: 'Sent when a book is issued.',                                 icon: Library,         color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 14, name: 'Transport Fees',         desc: 'Sent for transport fee updates.',                             icon: Bus,             color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 15, name: 'Bus Proximity Alert',    desc: 'Alert parents when the school bus is approaching their child’s stop.', icon: MapPin, color: AMBER, active: true, editable: true, push: true, email: false },
  { id: 16, name: 'Student Attendance',     desc: 'Sent when a student is marked as Present or Late.',           icon: CheckSquare,     color: GREEN,  active: true,  editable: true,  push: true,  email: false },
  { id: 17, name: 'Bulk Marksheet Ready',   desc: 'Sent when a bulk marksheet generation is complete.',          icon: FileText,        color: BLUE,   active: true,  editable: false, push: true,  email: false },
  { id: 18, name: 'Bulk Marksheet Failed',  desc: 'Sent when a bulk marksheet generation fails.',                icon: AlertTriangle,   color: AMBER,  active: true,  editable: false, push: true,  email: false },
  { id: 19, name: 'Due Slip Generated',     desc: 'Notify parents when monthly due slips are generated.',        icon: ClipboardList,   color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 20, name: 'Student Birthday',       desc: 'Sent to parents on student’s birthday.',                 icon: Cake,            color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 21, name: 'Student Punch Out',      desc: 'Sent to parents when a student punches out.',                 icon: LogOut,          color: BLUE,   active: true,  editable: true,  push: true,  email: false },
  { id: 22, name: 'Ptm Scheduled',          desc: 'Sent to guardians when a Parent-Teacher Meeting is scheduled.', icon: CalendarClock, color: MUTED2, active: false, editable: true,  push: false, email: false },
  { id: 23, name: 'Lesson Plan Reminder',   desc: 'Weekly reminder to teachers to submit plans for the coming week.', icon: NotebookPen, color: MUTED2, active: false, editable: true,  push: false, email: false },
  { id: 24, name: 'Staff Birthday',         desc: 'Sent to staff members on their birthday.',                    icon: PartyPopper,     color: MUTED2, active: false, editable: true,  push: false, email: false },
  { id: 25, name: 'Assessment Result Published', desc: 'Sent to a parent/student when a continuous-assessment result is published.', icon: ClipboardCheck, color: MUTED2, active: false, editable: false, push: false, email: false },
];

function MiniToggle({ on, disabled, onChange }) {
  return (
    <button disabled={disabled} onClick={() => onChange(!on)} style={{
      width: 38, height: 21, borderRadius: 999, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
      background: disabled ? '#E5E2DB' : (on ? BLUE : '#D8D5CE'), position: 'relative', flexShrink: 0, opacity: disabled ? .6 : 1,
    }}>
      <span style={{ position: 'absolute', top: 2.5, left: on ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: WHITE, transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.25)' }} />
    </button>
  );
}
function LockedCell() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: MUTED2, fontFamily: FONT }}>
      <Lock size={11} /> Locked
    </span>
  );
}
function StatCard({ n, label, color }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px 18px', minWidth: 130, flex: 1 }}>
      <div style={{ fontSize: 26, fontWeight: 800, color, fontFamily: FONT }}>{n}</div>
      <div style={{ fontSize: 12, color: MUTED2, fontFamily: FONT, marginTop: 2 }}>{label}</div>
    </div>
  );
}

export default function NotificationCenterPage() {
  const [rows, setRows] = useState(ALERTS.map((a) => ({ ...a, push: a.push })));
  const [query, setQuery] = useState('');

  const togglePush = (id) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, push: !r.push } : r)));

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
        <StatCard n={total}       label="Total Alerts"    color={INK} />
        <StatCard n={activeCount} label="Active Alerts"   color={GREEN} />
        <StatCard n={smsLocked}   label="SMS Locked"      color={RED} />
        <StatCard n={whatsapp}    label="WhatsApp Enabled" color={BLUE} />
      </div>

      {/* Search + config toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 220 }}>
          <Search size={15} color={MUTED2} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notifications…"
            style={{ width: '100%', padding: '10px 13px 10px 36px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box' }} />
        </div>
        <button style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
          <HelpCircle size={14} /> How it Works
        </button>
      </div>

      {/* Table */}
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, minWidth: 680 }}>
            <thead>
              <tr style={{ background: LIGHT }}>
                <th style={{ textAlign: 'left',  padding: '11px 12px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .5 }}>#</th>
                <th style={{ textAlign: 'left',  padding: '11px 12px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .5 }}>ALERT &amp; DESCRIPTION</th>
                <th style={{ textAlign: 'left',  padding: '11px 12px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .5 }}>STATUS</th>
                <th style={{ textAlign: 'center', padding: '11px 12px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .5 }}>EMAIL</th>
                <th style={{ textAlign: 'center', padding: '11px 12px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .5 }}>SMS</th>
                <th style={{ textAlign: 'center', padding: '11px 12px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .5 }}>WHATSAPP</th>
                <th style={{ textAlign: 'center', padding: '11px 12px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .5 }}>PUSH</th>
                <th style={{ textAlign: 'center', padding: '11px 12px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .5 }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={{ padding: '11px 12px', fontSize: 12.5, color: MUTED2 }}>{r.id}</td>
                  <td style={{ padding: '11px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: `${r.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <r.icon size={15} color={r.color} />
                      </div>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 700, color: INK, margin: 0 }}>{r.name}</p>
                        <p style={{ fontSize: 11, color: MUTED2, margin: '2px 0 0', lineHeight: 1.4, maxWidth: 260 }}>{r.desc}</p>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '11px 12px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: r.active ? GREEN : MUTED2 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: r.active ? GREEN : MUTED2 }} /> {r.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '11px 12px', textAlign: 'center' }}><MiniToggle on={false} disabled onChange={() => {}} /></td>
                  <td style={{ padding: '11px 12px', textAlign: 'center' }}><LockedCell /></td>
                  <td style={{ padding: '11px 12px', textAlign: 'center' }}><MiniToggle on={false} disabled onChange={() => {}} /></td>
                  <td style={{ padding: '11px 12px', textAlign: 'center' }}><MiniToggle on={r.push} disabled={!r.active} onChange={() => togglePush(r.id)} /></td>
                  <td style={{ padding: '11px 12px', textAlign: 'center' }}>
                    {r.editable ? (
                      <button style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 8, border: `1.5px solid ${BLUE}44`, background: `${BLUE}0C`, color: BLUE, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
                        <Edit3 size={11} /> Edit
                      </button>
                    ) : <span style={{ color: MUTED2 }}>—</span>}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: MUTED2, fontSize: 13 }}>No alerts match your search.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', padding: '14px 16px', borderTop: `1px solid ${BORDER}`, background: LIGHT }}>
          <div style={{ fontSize: 11, color: MUTED2, lineHeight: 1.6, fontFamily: FONT }}>
            <div><Lock size={10} style={{ marginRight: 4, verticalAlign: -1 }} /> SMS requires the feature to be enabled by the Super Admin.</div>
            <div><Lock size={10} style={{ marginRight: 4, verticalAlign: -1 }} /> WhatsApp requires the API configuration to be active above.</div>
            <div><Lock size={10} style={{ marginRight: 4, verticalAlign: -1 }} /> Push requires Firebase to be enabled above.</div>
          </div>
          <button style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 10, border: 'none', background: BLUE, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' }}>
            <Save size={14} /> Save Notification Preferences
          </button>
        </div>
      </div>
    </PageLayout>
  );
}
