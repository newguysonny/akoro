import { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import AkoroLogo from './common/AkoroLogo.jsx';
import {
  LayoutDashboard, Banknote, Landmark, Users, GraduationCap, DoorOpen,
  ClipboardList, Layers, Laptop, UserCog, UserCheck, CalendarClock, NotebookPen,
  ClipboardCheck, QrCode, ShieldCheck, BookOpenCheck, Award, Megaphone,
  Library, Package, Bus, BedDouble, LifeBuoy, Boxes, BarChart3, CreditCard,
  LayoutGrid, MessageSquare, LogOut, Bell, ChevronDown, Menu, Search,
  User, ShieldQuestion,
  BookOpen, Presentation, Swords, ListTodo, FileCheck, Store,
  PanelsTopLeft,
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
  ]},
  { section: 'STAFF & TEAM', items: [
    { label: 'Academic Staff', icon: GraduationCap, to: '/staff/academic' },
    { label: 'Non-Academic Staff', icon: UserCog, to: '/staff/non-academic' },
    { label: 'Teacher Requests', icon: UserCheck, to: '/staff/teacher-requests' },
  ]},
  { section: 'MANAGEMENT', items: [
    { label: 'Finance & Fees', icon: Banknote, moduleKey: 'fees_collection', children: [
      { label: 'Fees Dashboard', to: '/mgmt/fees-dashboard' },
      { label: 'Collect Fees', to: '/mgmt/collect-fees' },
      { label: 'Search Due Fees', to: '/mgmt/search-due-fees' },
      { label: 'All Transactions', to: '/mgmt/all-transactions' },
      { label: 'Online Transactions', to: '/mgmt/online-transactions' },
      { label: 'Online Payments (Public)', to: '/mgmt/online-payments' },
      { label: 'Fee Challans', to: '/mgmt/fee-challans' },
      { label: 'Assign Fees', to: '/mgmt/assign-fees' },
      { label: 'Fees Carry Forward', to: '/mgmt/fees-carry-forward' },
      { label: 'Fee Groups', to: '/mgmt/fee-groups' },
      { label: 'Fees Discount', to: '/mgmt/fee-discounts' },
      { label: 'Fee Types', to: '/mgmt/fee-types' },
      { label: 'Generate Due Slip', to: '/mgmt/generate-due-slip' },
      { label: 'Due Slip History', to: '/mgmt/due-slip-history' },
    ] },
    { label: 'Accounts', icon: Landmark, moduleKey: 'accounts_finance', children: [
      { label: 'Accounts Dashboard', to: '/mgmt/accounts-dashboard' },
      { label: 'Income', to: '/mgmt/income' },
      { label: 'Expense', to: '/mgmt/expense' },
      { label: 'Income Heads', to: '/mgmt/income-heads' },
      { label: 'Expense Heads', to: '/mgmt/expense-heads' },
      { label: 'Bank Accounts', to: '/mgmt/bank-accounts' },
    ] },
    { label: 'Student Information', icon: Users, children: [
      { label: 'Student Dashboard', to: '/mgmt/student-dashboard' },
      { label: 'Student Admission', to: '/mgmt/student-admission' },
      { label: 'Online Admissions', to: '/mgmt/online-admissions' },
      { label: 'Student List', to: '/mgmt/students' },
      { label: 'Assign to Class', to: '/mgmt/assign-class' },
      { label: 'Attendance Register', to: '/mgmt/attendance-register' },
      { label: 'Student Attendance', to: '/mgmt/student-attendance' },
      { label: 'Behavior Records', to: '/mgmt/behavior-records' },
      { label: 'Student Houses', to: '/mgmt/student-houses' },
      { label: 'Student Categories', to: '/mgmt/student-categories' },
      { label: 'Disabled Students', to: '/mgmt/disabled-students' },
      { label: 'Health Records', to: '/mgmt/health-records' },
    ] },
    { label: 'Academics', icon: GraduationCap, children: [
      { label: 'Academic Dashboard', to: '/mgmt/academic-dashboard' },
      { label: 'Academic Sessions', to: '/mgmt/academic-sessions' },
      { label: 'Academic Levels', to: '/mgmt/academic-levels' },
      { label: 'Curriculum', to: '/mgmt/curriculum' },
      { label: 'Classes', to: '/mgmt/classes' },
      { label: 'Scheme of Work', to: '/mgmt/scheme-of-work' },
      { label: 'Section Types', to: '/mgmt/section-types' },
      { label: 'Sections', to: '/mgmt/sections' },
      { label: 'Subjects', to: '/mgmt/subjects' },
      { label: 'Syllabus', to: '/mgmt/syllabus' },
      { label: 'Assign Subjects', to: '/mgmt/assign-subjects' },
      { label: 'Assign Teacher to Subjects', to: '/mgmt/assign-teacher-subjects' },
      { label: 'Assign Electives', to: '/mgmt/assign-electives' },
      { label: 'Assign Class Teacher', to: '/mgmt/assign-class-teacher' },
      { label: 'Manage Periods', to: '/mgmt/periods' },
      { label: 'Class Timetable', to: '/mgmt/class-timetable' },
      { label: 'Weekly Forecast', to: '/mgmt/weekly-forecast' },
      { label: 'Daily Schedule', to: '/mgmt/daily-schedule' },
      { label: 'Promote Students', to: '/mgmt/promote-students' },
    ] },
    { label: 'Front Office', icon: DoorOpen, moduleKey: 'front_office', children: [
      { label: 'Front Office Dashboard', to: '/mgmt/front-office-dashboard' },
      { label: 'Admission Enquiries', to: '/mgmt/enquiries' },
      { label: 'Visitor Book', to: '/mgmt/visitor-book' },
      { label: 'Complaints', to: '/mgmt/complaints' },
      { label: 'Postal Records', to: '/mgmt/postal-records' },
    ] },
    { label: 'Offline Examinations', icon: ClipboardList, moduleKey: 'offline_examinations', children: [
      { label: 'Exam Dashboard', to: '/mgmt/exam-dashboard' },
      { label: 'Manage Offline Exams', to: '/mgmt/offline-exams' },
      { label: 'Exam Types', to: '/mgmt/exam-types' },
      { label: 'Schedule & Marks Setup', to: '/mgmt/exam-schedules' },
      { label: 'Enter Marks', to: '/mgmt/enter-marks' },
      { label: 'Cocurricular Areas', to: '/mgmt/cocurricular-areas' },
      { label: 'Cocurricular Grades', to: '/mgmt/cocurricular-grades' },
      { label: 'Manage Grades', to: '/mgmt/manage-grades' },
      { label: 'Report Card Setups', to: '/mgmt/report-card-setups' },
      { label: 'Generate Marksheet', to: '/mgmt/generate-marksheet' },
      { label: 'Result PINs', to: '/mgmt/result-pins' },
      { label: 'Upload Marksheet', to: '/mgmt/upload-marksheet' },
      { label: 'Manage Uploads', to: '/mgmt/manage-uploads' },
      { label: 'Teacher Remarks', to: '/mgmt/teacher-remarks' },
    ] },
    { label: 'CBC Academics', icon: Layers, moduleKey: 'cbc_academics', children: [
      { label: 'CBC Dashboard', to: '/mgmt/cbc-dashboard' },
      { label: 'Strands & Outcomes', to: '/mgmt/cbc-strands' },
      { label: 'CBC Assessments', to: '/mgmt/cbc-assessments' },
      { label: 'Core Competencies', to: '/mgmt/core-competencies' },
      { label: 'Pathways & Tracks', to: '/mgmt/cbc-pathways' },
      { label: 'CBC Reports', to: '/mgmt/cbc-reports' },
    ] },
    { label: 'Online Examinations', icon: Laptop, moduleKey: 'online_examinations', children: [
      { label: 'Manage Online Exams', to: '/mgmt/online-exams' },
      { label: 'Question Bank', to: '/mgmt/question-bank' },
    ] },
    { label: 'Human Resource', icon: UserCog, moduleKey: 'human_resource', children: [
      { label: 'HR Dashboard', to: '/mgmt/hr-dashboard' },
      { label: 'Staff Directory', to: '/mgmt/staff-directory' },
      { label: 'Staff Attendance', to: '/mgmt/staff-attendance-hr' },
      { label: 'Payroll', to: '/mgmt/payroll' },
      { label: 'Set Salary', to: '/mgmt/set-salary' },
      { label: 'Approve Leave', to: '/mgmt/approve-leave' },
      { label: 'Leave Types', to: '/mgmt/leave-types' },
      { label: 'Departments', to: '/mgmt/departments' },
      { label: 'Designations', to: '/mgmt/designations' },
      { label: 'Leave Management', to: '/mgmt/leave-management' },
      { label: 'Staff ID Card', to: '/mgmt/staff-id-card' },
      { label: 'HR Settings', to: '/mgmt/hr-settings' },
      { label: 'Manage Staff Loans', to: '/mgmt/staff-loans' },
      { label: 'Salary Templates', to: '/mgmt/salary-templates' },
      { label: 'Appraisal Cycles', to: '/mgmt/appraisal-cycles' },
      { label: 'Appraisal Criteria', to: '/mgmt/appraisal-criteria' },
      { label: 'Appraisals', to: '/mgmt/appraisals' },
    ] },
    { label: 'PTM Meetings', icon: CalendarClock, moduleKey: 'ptm', children: [
      { label: 'PTM Dashboard', to: '/mgmt/ptm-dashboard' },
      { label: 'PTM Schedule Meetings', to: '/mgmt/ptm-meetings' },
      { label: 'PTM Guide', to: '/mgmt/ptm-guide' },
      { label: 'PTM Attendance & Remarks', to: '/mgmt/ptm-attendance' },
      { label: 'PTM Follow-ups', to: '/mgmt/ptm-followups' },
      { label: 'PTM Reports', to: '/mgmt/ptm-reports' },
    ] },
    { label: 'Lesson Planner', icon: NotebookPen, moduleKey: 'lesson_planner', children: [
      { label: 'Lesson Planner Dashboard', to: '/mgmt/lesson-planner-dashboard' },
      { label: 'Lesson Plans', to: '/mgmt/lesson-plans' },
      { label: 'Lesson Planner Guide', to: '/mgmt/lesson-planner-guide' },
      { label: 'Lesson Plan Review', to: '/mgmt/lesson-plan-review' },
      { label: 'Lesson Plan Approvals', to: '/mgmt/lesson-plan-approvals' },
      { label: 'Lesson Plan Coverage', to: '/mgmt/lesson-plan-coverage' },
      { label: 'Lesson Plan Reports', to: '/mgmt/lesson-plan-reports' },
      { label: 'Lesson Planner Settings', to: '/mgmt/lesson-planner-settings' },
    ] },
    { label: 'OSM Module', icon: ClipboardCheck, moduleKey: 'digital_evaluation', children: [
      { label: 'OSM Dashboard', to: '/mgmt/osm-dashboard' },
      { label: 'OSM Sessions', to: '/mgmt/osm-sessions' },
      { label: 'OSM Evaluate', to: '/mgmt/osm-evaluate' },
      { label: 'OSM Reports', to: '/mgmt/osm-reports' },
      { label: 'OSM Guide', to: '/mgmt/osm-guide' },
      { label: 'OSM Moderation', to: '/mgmt/osm-moderation' },
    ] },
    { label: 'QR Code Attendance', icon: QrCode, moduleKey: 'qr_attendance', children: [
      { label: 'QR Attendance', to: '/mgmt/qr-attendance' },
      { label: 'QR Attendance Setting', to: '/mgmt/qr-settings' },
      { label: 'QR Attendance Report', to: '/mgmt/qr-report' },
    ] },
  ]},
  { section: 'MODULES', items: [
    // Real, live pages — the only things this section contains.
    { label: 'Courses', icon: BookOpen, to: '/courses' },
    // Instructors / Classes / Students now live under Academic Staff,
    // Academics → Classes, and Student Information respectively.
    { label: 'Battles', icon: Swords, to: '/battles' },
    { label: 'Tasks', icon: ListTodo, to: '/tasks' },
    { label: 'Assessments', icon: FileCheck, to: '/assessments' },
    { label: 'AI Chat', icon: MessageSquare, to: '/chat' },
    { label: 'Tools & Assets', icon: Store, to: '/marketplace' },
    { label: 'Content Library', icon: Library, to: '/library' },
  ]},
  { section: 'FACILITIES & SERVICES', items: [
    // Auxiliary / supplementary modules — all placeholder groups (pages not built yet).
    { label: 'Study Center', icon: BookOpenCheck, moduleKey: 'study_center', children: [
      { label: 'Dashboard', to: '/mgmt/study-center-dashboard' },
      { label: 'Manage Syllabus', to: '/mgmt/manage-syllabus' },
      { label: 'Classwork & Logbook', to: '/mgmt/classwork-logbook' },
      { label: 'Manage Resources', to: '/mgmt/manage-resources' },
      { label: 'Homework & Assignments', to: '/mgmt/homework-assignments' },
      { label: 'Live Classes', to: '/mgmt/live-classes' },
    ] },
    { label: 'Document Templates', icon: Award, children: [
      { label: 'All Templates', to: '/mgmt/document-templates' },
      { label: 'New Template', to: '/mgmt/document-templates/new' },
    ] },
    { label: 'Communicate', icon: Megaphone, moduleKey: 'communications', children: [
      { label: 'Notice Board', to: '/mgmt/notice-board' },
      { label: 'Events & Holidays', to: '/mgmt/events-holidays' },
      { label: 'Compose Broadcast', to: '/mgmt/compose-broadcast' },
      { label: 'Broadcast History', to: '/mgmt/broadcast-history' },
      { label: 'Image Gallery', to: '/mgmt/image-gallery' },
    ] },
    { label: 'Library', icon: Library, moduleKey: 'library', children: [
      { label: 'Library Dashboard', to: '/mgmt/library-dashboard' },
      { label: 'Issue/Return Book', to: '/mgmt/issue-return-book' },
      { label: 'Manage Books', to: '/mgmt/manage-books' },
      { label: 'Book Categories', to: '/mgmt/book-categories' },
    ] },
    { label: 'Inventory', icon: Package, moduleKey: 'inventory', children: [
      { label: 'Inventory Dashboard', to: '/mgmt/inventory-dashboard' },
      { label: 'Issue Item', to: '/mgmt/issue-item' },
      { label: 'Add Stock', to: '/mgmt/add-stock' },
      { label: 'Item List', to: '/mgmt/item-list' },
      { label: 'Item Categories', to: '/mgmt/item-categories' },
      { label: 'Suppliers', to: '/mgmt/suppliers' },
      { label: 'Point of Sale', to: '/mgmt/point-of-sale' },
      { label: 'Sales History', to: '/mgmt/sales-history' },
      { label: 'Purchase Orders', to: '/mgmt/purchase-orders' },
      { label: 'Goods Receipts', to: '/mgmt/goods-receipts' },
      { label: 'Supplier Payments', to: '/mgmt/supplier-payments' },
    ] },
    { label: 'Transport', icon: Bus, moduleKey: 'transport', children: [
      { label: 'Transport Dashboard', to: '/mgmt/transport-dashboard' },
      { label: 'Manage Vehicles', to: '/mgmt/manage-vehicles' },
      { label: 'Manage Routes', to: '/mgmt/manage-routes' },
      { label: 'Live Vehicle Tracking', to: '/mgmt/vehicle-tracking' },
    ] },
    { label: 'Hostel', icon: BedDouble, moduleKey: 'hostel', children: [
      { label: 'Hostel Dashboard', to: '/mgmt/hostel-dashboard' },
      { label: 'Student Allocation', to: '/mgmt/student-allocation' },
      { label: 'Manage Rooms', to: '/mgmt/manage-rooms' },
      { label: 'Room Types', to: '/mgmt/room-types' },
      { label: 'Manage Hostels', to: '/mgmt/manage-hostels' },
    ] },
    { label: 'Help Center', icon: LifeBuoy, children: [
      { label: 'Manage Categories', to: '/mgmt/help-categories' },
      { label: 'Browse Articles', to: '/mgmt/browse-articles' },
      { label: 'AI Chatbot', to: '/mgmt/ai-chatbot-help' },
    ] },
    { label: 'Asset Management', icon: Boxes, moduleKey: 'asset_management', children: [
      { label: 'Asset Dashboard', to: '/mgmt/asset-dashboard' },
      { label: 'Asset Register', to: '/mgmt/asset-register' },
      { label: 'Asset Categories', to: '/mgmt/asset-categories' },
      { label: 'Asset Assignments', to: '/mgmt/asset-assignments' },
      { label: 'Asset Depreciation', to: '/mgmt/asset-depreciation' },
      { label: 'Asset Maintenance', to: '/mgmt/asset-maintenance' },
      { label: 'Asset Disposals', to: '/mgmt/asset-disposals' },
      { label: 'Asset Audits', to: '/mgmt/asset-audits' },
      { label: 'Asset Reports', to: '/mgmt/asset-reports' },
    ] },
    { label: 'Reports & Analytics', icon: BarChart3, to: '/mgmt/reports-analytics' },
  ]},
  { section: 'SYSTEM', items: [
    { label: 'Settings & Billing', icon: CreditCard, children: [
      { label: 'School Settings', to: '/settings-billing' },
      { label: 'Backup Management', to: '/settings-backup' },
      'Custom Fields',
      { label: 'Roles & Permissions', to: '/settings-roles' },
      { label: 'Payment Gateway', to: '/settings-payment-gateway' },
      'Notification Settings',
      { label: 'Admission Settings', to: '/settings-admission' },
      { label: 'Audit Trail', to: '/settings-audit-trail' },
      { label: 'Subscription', to: '/settings-subscription' },
      { label: 'Subscription History', to: '/settings-subscription-history' },
      { label: 'Module Settings', to: '/settings-modules' },
      'Biometric Devices',
    ] },
    { label: 'Website Builder', icon: PanelsTopLeft, children: [
      { label: 'Media', to: '/website-builder/media' },
      { label: 'Pages', to: '/website-builder/pages' },
      { label: 'Menus', to: '/website-builder/menus' },
      { label: 'Template', to: '/settings-website/templates' },
      { label: 'School Website', to: '/settings-website' },
      { label: 'Appearance', to: '/website-builder/appearance' },
    ] },
    { label: 'Apps Center', icon: LayoutGrid, to: '/apps' },
  ]},
  { section: 'COMMUNICATION', items: [
    { label: 'Comms Wallet', icon: MessageSquare, to: '#' },
  ]},
  { section: 'ACCOUNT', items: [
    { label: 'My Profile', icon: User, to: '/profile' },
    { label: 'Help & Support', icon: ShieldQuestion, to: '/settings-billing?tab=help' },
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
  const navigate = useNavigate();
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
          {item.children.map((c) => {
            const label = typeof c === 'string' ? c : c.label;
            const to = typeof c === 'string' ? null : c.to;
            return (
              <button key={label} onClick={() => to && navigate(to)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 10px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, color: MUTED2, textAlign: 'left', borderRadius: 8 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; e.currentTarget.style.color = WHITE; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = MUTED2; }}>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />{label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ collapsed }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState({});
  const [query, setQuery] = useState('');
  const [modules, setModules] = useState(null);
  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  // Load the school's enabled/disabled modules once, then keep it fresh:
  // re-check whenever the tab regains focus (e.g. after saving on the
  // Module Management page) so a disable/enable shows up without a reload.
  useEffect(() => {
    let cancelled = false;
    const loadModules = () => {
      apiGet('/api/school/settings')
        .then((res) => { if (!cancelled) setModules(res.data?.modules || {}); })
        .catch(() => {});
    };
    loadModules();
    window.addEventListener('focus', loadModules);
    window.addEventListener('akoro:modules-updated', loadModules);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', loadModules);
      window.removeEventListener('akoro:modules-updated', loadModules);
    };
  }, []);

  const isModuleOn = (key) => !key || !modules || modules[key] !== false; // default on until loaded/explicitly off

  const moduleFiltered = NAV_SECTIONS.map((sec) => ({
    ...sec,
    items: sec.items.filter((item) => isModuleOn(item.moduleKey)),
  })).filter((sec) => sec.items.length);

  const q = query.trim().toLowerCase();
  const sections = q
    ? moduleFiltered.map((sec) => ({
        ...sec,
        items: sec.items
          .map((item) => {
            if (item.label.toLowerCase().includes(q)) return item;
            if (item.children) {
              const kids = item.children.filter((c) => (typeof c === 'string' ? c : c.label).toLowerCase().includes(q));
              if (kids.length) return { ...item, children: kids };
            }
            return null;
          })
          .filter(Boolean),
      })).filter((sec) => sec.items.length)
    : moduleFiltered;

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

      {/* Search menu */}
      {!collapsed ? (
        <div style={{ padding: '12px 14px 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, padding: '8px 12px' }}>
            <Search size={15} color={MUTED2} style={{ flexShrink: 0 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search menu…"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: WHITE, fontSize: 13, fontFamily: FONT, minWidth: 0 }}
            />
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <Search size={17} color={MUTED2} />
        </div>
      )}

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto', scrollbarWidth: 'thin' }}>
        {sections.map((sec) => (
          <div key={sec.section} style={{ marginBottom: 6 }}>
            {!collapsed && <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1.2, color: 'rgba(255,255,255,.35)', padding: '10px 20px 4px', fontFamily: FONT }}>{sec.section}</div>}
            {collapsed && <div style={{ height: 1, background: 'rgba(255,255,255,.06)', margin: '8px 14px' }} />}
            {sec.items.map((item) => item.children
              ? <Group key={item.label} item={item} collapsed={collapsed} open={q ? true : !!open[item.label]} onToggle={() => toggle(item.label)} />
              : <Leaf key={item.label} item={item} collapsed={collapsed} />)}
          </div>
        ))}
        {q && sections.length === 0 && (
          <div style={{ padding: '16px 20px', fontSize: 12.5, color: MUTED2, fontFamily: FONT }}>No menu matches “{query}”.</div>
        )}
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
