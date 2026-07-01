import { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import AkoroLogo from './common/AkoroLogo.jsx';
import {
  LayoutDashboard, Banknote, Landmark, Users, GraduationCap, DoorOpen,
  ClipboardList, Layers, Laptop, UserCog, CalendarClock, NotebookPen,
  ClipboardCheck, QrCode, ShieldCheck, BookOpenCheck, Award, Megaphone,
  Library, Package, Bus, BedDouble, LifeBuoy, Boxes, BarChart3, CreditCard,
  LayoutGrid, MessageSquare, LogOut, Bell, ChevronDown, Menu,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { apiGet } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, WHITE, FONT } from '../constants.js';

/* ── Nav tree ──────────────────────────────────────────────────────
   Leaves with a real `to` navigate; children (strings) are placeholders
   for now (pages not built yet). Groups expand/collapse. */
const NAV_SECTIONS = [
  { section: 'MAIN NAVIGATION', items: [
    { label: 'Dashboard', icon: LayoutDashboard, to: '/' },
    { label: 'Finance & Fees', icon: Banknote, children: ['Fees Dashboard','Collect Fees','Search Due Fees','All Transactions','Online Transactions','Fee Challans','Assign Fees','Fees Carry Forward','Fee Groups','Fees Discount','Fee Types','Generate Due Slip','Due Slip History'] },
    { label: 'Accounts', icon: Landmark, children: ['Accounts Dashboard','Income','Expense','Income Heads','Expense Heads','Bank Accounts'] },
    { label: 'Student Information', icon: Users, children: ['Student Dashboard','Student Admission','Student List','Student Attendance','Behavior Records','Student Houses','Student Categories','Disabled Students','Health Records'] },
    { label: 'Academics', icon: GraduationCap, children: ['Academic Dashboard','Academic Sessions','Classes','Sections','Subjects','Assign Subjects','Assign Electives','Assign Class Teacher','Manage Periods','Class Timetable','Promote Students'] },
    { label: 'Front Office', icon: DoorOpen, children: ['Front Office Dashboard','Admission Enquiries','Visitor Book','Complaints','Postal Records'] },
    { label: 'Offline Examinations', icon: ClipboardList, children: ['Exam Dashboard','Manage Offline Exams','Exam Types','Schedule & Marks Setup','Enter Marks','Cocurricular Areas','Cocurricular Grades','Manage Grades','Report Card Setups','Generate Marksheet','Upload Marksheet','Manage Uploads','Teacher Remarks'] },
    { label: 'CBC Academics', icon: Layers, children: ['CBC Dashboard','Strands & Outcomes','CBC Assessments','Core Competencies','Pathways & Tracks','CBC Reports'] },
    { label: 'Online Examinations', icon: Laptop, children: ['Manage Online Exams','Question Bank'] },
    { label: 'Human Resource', icon: UserCog, children: ['HR Dashboard','Staff Directory','Staff Attendance','Payroll','Set Salary','Approve Leave','Leave Types','Departments','Designations','Leave Management','Staff ID Card','HR Settings','Manage Staff Loans','Salary Templates','Appraisal Cycles','Appraisal Criteria','Appraisals'] },
    { label: 'PTM Meetings', icon: CalendarClock, children: ['PTM Dashboard','PTM Schedule Meetings','PTM Guide','PTM Attendance & Remarks','PTM Follow-ups','PTM Reports'] },
    { label: 'Lesson Planner', icon: NotebookPen, children: ['Lesson Planner Dashboard','Lesson Plans','Lesson Planner Guide','Lesson Plan Review','Lesson Plan Approvals','Lesson Plan Coverage','Lesson Plan Reports','Lesson Planner Settings'] },
    { label: 'OSM Module', icon: ClipboardCheck, children: ['OSM Dashboard','OSM Sessions','OSM Evaluate','OSM Reports','OSM Guide','OSM Moderation'] },
    { label: 'QR Code Attendance', icon: QrCode, children: ['QR Attendance','QR Attendance Setting','QR Attendance Report'] },
    { label: 'Assessment', icon: ShieldCheck, children: ['Assessment Dashboard','Assessments','Assessment Guide','Assessment Reports'] },
    { label: 'Study Center', icon: BookOpenCheck, children: ['Dashboard','Manage Syllabus','Classwork & Logbook','Manage Resources','Homework & Assignments','Live Classes'] },
    { label: 'Certificates', icon: Award, children: ['Certificate Templates','Generate Document'] },
    { label: 'Communicate', icon: Megaphone, children: ['Notice Board','Events & Holidays','Compose Broadcast','Broadcast History','Image Gallery'] },
    { label: 'Library', icon: Library, children: ['Library Dashboard','Issue/Return Book','Manage Books','Book Categories'] },
    { label: 'Inventory', icon: Package, children: ['Inventory Dashboard','Issue Item','Add Stock','Item List','Item Categories','Suppliers','Point of Sale','Sales History','Purchase Orders','Goods Receipts','Supplier Payments'] },
    { label: 'Transport', icon: Bus, children: ['Transport Dashboard','Manage Vehicles','Manage Routes','Live Vehicle Tracking'] },
    { label: 'Hostel', icon: BedDouble, children: ['Hostel Dashboard','Student Allocation','Manage Rooms','Room Types','Manage Hostels'] },
    { label: 'Help Center', icon: LifeBuoy, children: ['Manage Categories','Browse Articles','AI Chatbot'] },
    { label: 'Asset Management', icon: Boxes, children: ['Asset Dashboard','Asset Register','Asset Categories','Asset Assignments','Asset Depreciation','Asset Maintenance','Asset Disposals','Asset Audits','Asset Reports'] },
  ]},
  { section: 'MODULES', items: [
    { label: 'Reports & Analytics', icon: BarChart3, to: '#' },
    { label: 'Settings & Billing', icon: CreditCard, children: ['School Settings','Backup Management','Custom Fields','Roles & Permissions','Payment Gateway','Notification Settings','Admission Settings','Audit Trail','Subscription','Subscription History','Module Settings','Biometric Devices','School Website'] },
  ]},
  { section: 'SYSTEM', items: [
    { label: 'Apps Center', icon: LayoutGrid, to: '#' },
  ]},
  { section: 'COMMUNICATION', items: [
    { label: 'Comms Wallet', icon: MessageSquare, to: '#' },
  ]},
];

/* ── Leaf (real link or placeholder) ─────────────────────────────── */
function Leaf({ item, collapsed }) {
  const base = {
    display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 12,
    justifyContent: collapsed ? 'center' : 'flex-start',
    padding: collapsed ? '11px 0' : '9px 16px', borderRadius: 10,
    margin: collapsed ? '2px 10px' : '2px 8px', textDecoration: 'none',
    fontFamily: FONT, fontSize: 13.5, cursor: 'pointer', border: 'none',
    background: 'transparent', width: collapsed ? 'auto' : 'calc(100% - 16px)',
  };
  if (item.to && item.to !== '#') {
    return (
      <NavLink to={item.to} end={item.to === '/'} title={collapsed ? item.label : undefined}
        style={({ isActive }) => ({ ...base, color: isActive ? WHITE : MUTED2, background: isActive ? `${AMBER}22` : 'transparent', fontWeight: isActive ? 600 : 400, borderLeft: !collapsed && isActive ? `3px solid ${AMBER}` : '3px solid transparent' })}>
        <item.icon size={18} />{!collapsed && <span>{item.label}</span>}
      </NavLink>
    );
  }
  return (
    <button title={collapsed ? item.label : undefined} style={{ ...base, color: MUTED2, textAlign: 'left' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; e.currentTarget.style.color = WHITE; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = MUTED2; }}>
      <item.icon size={18} />{!collapsed && <span>{item.label}</span>}
    </button>
  );
}

/* ── Group (expandable) ──────────────────────────────────────────── */
function Group({ item, collapsed, open, onToggle }) {
  return (
    <div>
      <button title={collapsed ? item.label : undefined} onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 12, justifyContent: collapsed ? 'center' : 'flex-start', width: 'calc(100% - 16px)', padding: collapsed ? '11px 0' : '9px 16px', margin: '2px 8px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 13.5, background: open && !collapsed ? 'rgba(255,255,255,.04)' : 'transparent', color: open ? WHITE : MUTED2 }}
        onMouseEnter={(e) => { e.currentTarget.style.color = WHITE; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = open ? WHITE : MUTED2; }}>
        <item.icon size={18} />
        {!collapsed && <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>}
        {!collapsed && <ChevronDown size={14} style={{ transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />}
      </button>
      {open && !collapsed && (
        <div style={{ margin: '2px 8px 6px 8px', paddingLeft: 22, borderLeft: '1px solid rgba(255,255,255,.08)' }}>
          {item.children.map((c) => (
            <button key={c} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 10px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, color: MUTED2, textAlign: 'left', borderRadius: 8 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; e.currentTarget.style.color = WHITE; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = MUTED2; }}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />{c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ collapsed }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState({});
  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  return (
    <aside style={{ width: collapsed ? 72 : 256, flexShrink: 0, background: INK, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', transition: 'width .15s' }}>
      {/* Logo */}
      <div style={{ padding: collapsed ? '20px 0 14px' : '20px 20px 14px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 10 }}>
          <AkoroLogo size={34} radius={10} />
          {!collapsed && (
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: WHITE, fontFamily: FONT }}>Akoro</div>
              <div style={{ fontSize: 10, color: MUTED2, fontFamily: FONT }}>School Portal</div>
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto', scrollbarWidth: 'thin' }}>
        {NAV_SECTIONS.map((sec) => (
          <div key={sec.section} style={{ marginBottom: 6 }}>
            {!collapsed && <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1.2, color: 'rgba(255,255,255,.35)', padding: '10px 20px 4px', fontFamily: FONT }}>{sec.section}</div>}
            {collapsed && <div style={{ height: 1, background: 'rgba(255,255,255,.06)', margin: '8px 14px' }} />}
            {sec.items.map((item) => item.children
              ? <Group key={item.label} item={item} collapsed={collapsed} open={!!open[item.label]} onToggle={() => toggle(item.label)} />
              : <Leaf key={item.label} item={item} collapsed={collapsed} />)}
          </div>
        ))}
      </nav>

      {/* Account / user */}
      <div style={{ padding: '14px', borderTop: '1px solid rgba(255,255,255,.07)', display: 'flex', flexDirection: collapsed ? 'column' : 'row', alignItems: 'center', gap: collapsed ? 10 : 10 }}>
        <div title={collapsed ? (user?.fullName || user?.email || '') : undefined} style={{ width: 34, height: 34, borderRadius: '50%', background: `linear-gradient(135deg, ${AMBER}, ${AMBER}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: WHITE, flexShrink: 0 }}>
          {(user?.fullName || user?.email || 'S')[0].toUpperCase()}
        </div>
        {!collapsed && (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: WHITE, fontFamily: FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.fullName || 'School Admin'}</div>
            <div style={{ fontSize: 11, color: MUTED2, fontFamily: FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email || ''}</div>
          </div>
        )}
        <button onClick={logout} title="Sign out" style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED2, padding: 4, borderRadius: 6, flexShrink: 0 }}><LogOut size={16} /></button>
      </div>
    </aside>
  );
}

function BellButton() {
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const poll = useCallback(async () => {
    try { const res = await apiGet('/api/notifications?limit=1'); setUnread(res.unread ?? 0); } catch {}
  }, []);
  useEffect(() => {
    poll();
    const t = setInterval(poll, 60_000);
    const onFocus = () => poll();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [poll]);
  return (
    <button onClick={() => navigate('/notifications')} style={{ position: 'relative', background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 10, padding: '8px', cursor: 'pointer', color: MUTED, display: 'flex', alignItems: 'center' }}>
      <Bell size={16} />
      {unread > 0 && <span style={{ position: 'absolute', top: -4, right: -4, background: AMBER, color: WHITE, borderRadius: '50%', width: 16, height: 16, fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, border: `2px solid ${WHITE}` }}>{unread > 9 ? '9+' : unread}</span>}
    </button>
  );
}

export function TopBar({ title, subtitle, action, onToggleSidebar }) {
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(250,248,245,.95)', backdropFilter: 'blur(8px)', borderBottom: `1px solid ${BORDER}`, padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {/* Hamburger — collapses the sidebar to icons-only */}
        <button onClick={onToggleSidebar} title="Toggle sidebar" style={{ background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 10, padding: '8px', cursor: 'pointer', color: INK, display: 'flex', alignItems: 'center' }}>
          <Menu size={17} />
        </button>
        <div>
          <h1 style={{ fontSize: 19, fontWeight: 700, color: INK, margin: 0, fontFamily: FONT }}>{title}</h1>
          {subtitle && <p style={{ fontSize: 13, color: MUTED, margin: '2px 0 0', fontFamily: FONT }}>{subtitle}</p>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {action}
        <BellButton />
      </div>
    </div>
  );
}

export function BottomNav() { return null; }

export function PageLayout({ children, title, subtitle, action }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar collapsed={collapsed} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar title={title} subtitle={subtitle} action={action} onToggleSidebar={() => setCollapsed((c) => !c)} />
        <main style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>{children}</main>
      </div>
    </div>
  );
}
