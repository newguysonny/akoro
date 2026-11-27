import { useState, useEffect } from 'react';
import {
  LayoutDashboard, Banknote, Landmark, Users, GraduationCap, DoorOpen,
  ClipboardList, Layers, Laptop, UserCog, UserCheck, CalendarClock, NotebookPen,
  ClipboardCheck, QrCode, BookOpenCheck, Award, Megaphone, Coins,
  Library, Package, Bus, BedDouble, LifeBuoy, Boxes, BarChart3, CreditCard,
  LayoutGrid, MessageSquare, User, ShieldQuestion,
  BookOpen, Swords, ListTodo, FileCheck, Store,
  PanelsTopLeft,
} from 'lucide-react';
import NextLayout from './NextLayout.jsx';

/* The page frame: the shared frame (NextLayout, the learner app's look).
   NAV_SECTIONS below stays the nav's data source — NextLayout's
   schoolNav() converts it to the shared frame's nav data, module gates
   included. The legacy Sidebar/TopBar frame is retired; AppHeader went
   with it (the shared frame supplies the header and the phone bottom nav). */

const MOBILE_QUERY = '(max-width: 767px)';

export function useIsMobile() {
  const [mobile, setMobile] = useState(() => {
    try { return window.matchMedia(MOBILE_QUERY).matches; } catch { return false; }
  });
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia(MOBILE_QUERY); } catch { return; }
    const onChange = (e) => setMobile(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return mobile;
}

export function PageLayout(props) {
  return <NextLayout {...props}/>;
}

/* ── Nav tree ──────────────────────────────────────────────────────
   Leaves with a real `to` navigate; children (strings) are placeholders
   for now (pages not built yet). Groups expand/collapse. */
export const NAV_SECTIONS = [
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
      { label: 'Learner Struggles', to: '/mgmt/learner-struggles' },
    ] },
    { label: 'Academics', icon: GraduationCap, children: [
      { label: 'Academic Dashboard', to: '/mgmt/academic-dashboard' },
      { label: 'Academic Sessions', to: '/mgmt/academic-sessions' },
      { label: 'Academic Calendar', to: '/mgmt/academic-calendar' },
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
      { label: 'Teaching Materials', to: '/mgmt/teaching-materials' },
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
    { label: 'AI Self Study', icon: GraduationCap, to: '/self-study' },
    { label: 'Assessments', icon: FileCheck, to: '/assessments' },
    { label: 'Review AI Lessons', icon: BookOpenCheck, to: '/lesson-review' },
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
      { label: 'Tool Purchases', to: '/settings-tool-purchases' },
      { label: 'Module Settings', to: '/settings-modules' },
      'Biometric Devices',
    ] },
    { label: 'Website Builder', icon: PanelsTopLeft, children: [
      { label: 'Media', to: '/website-builder/media' },
      { label: 'Pages', to: '/website-builder/pages' },
      { label: 'Menus', to: '/website-builder/menus' },
      { label: 'Template', to: '/settings-website/templates' },
      { label: 'School Website', to: '/settings-website' },
      { label: 'AI Website Sync', to: '/settings-website/ai-sync' },
      { label: 'Appearance', to: '/website-builder/appearance' },
    ] },
    { label: 'Apps Center', icon: LayoutGrid, to: '/apps' },
  ]},
  { section: 'COMMUNICATION', items: [
    { label: 'Content', icon: Megaphone, to: '/content' },
    { label: 'Comms Wallet', icon: MessageSquare, to: '#' },
  ]},
  { section: 'ACCOUNT', items: [
    { label: 'Wallet & AI Credits', icon: Coins, to: '/wallet' },
    { label: 'My Profile', icon: User, to: '/profile' },
    { label: 'Help & Support', icon: ShieldQuestion, to: '/settings-billing?tab=help' },
  ]},
];
