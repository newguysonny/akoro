/** Human Resource module pages (mgmt schema). */
import { useState, useEffect, useCallback } from 'react';
import { Users, Building2, CalendarOff, Wallet, HandCoins, BadgeCheck } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import StatCards from '../../components/mgmt/StatCards.jsx';
import { ModuleSettingsForm } from '../../components/mgmt/extras.jsx';
import { apiGet, apiPost } from '../../services/api.js';
import { GREEN, RED, BLUE, PURPLE } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

const BASE = '/api/school/mgmt';
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const staffOpts = { resource: 'staff', labelFn: (r) => `${r.first_name} ${r.last_name} (${r.staff_no})` };
const pill = (v, map) => {
  const c = map[v] || C.muted2;
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: tint(8, c), color: c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{String(v).replace('_', ' ')}</span>;
};
const LEAVE_STATUSES = [{ value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }];
const LEAVE_COLUMNS = [
  { key: 'staff_name', label: 'Staff' }, { key: 'leave_type_name', label: 'Type' },
  { key: 'from_date', label: 'From' }, { key: 'to_date', label: 'To' },
  { key: 'status', label: 'Status', render: (r) => pill(r.status, { pending: C.brand, approved: GREEN, rejected: RED }) },
];
const LEAVE_FIELDS = [
  { key: 'staff_id', label: 'Staff', type: 'select', required: true, optionsFrom: staffOpts },
  { key: 'leave_type_id', label: 'Leave Type', type: 'select', optionsFrom: { resource: 'leave-types' } },
  { key: 'from_date', label: 'From', type: 'date', required: true },
  { key: 'to_date', label: 'To', type: 'date', required: true },
  { key: 'status', label: 'Status', type: 'select', default: 'pending', options: LEAVE_STATUSES },
  { key: 'decided_by', label: 'Decided By' },
  { key: 'reason', label: 'Reason', type: 'textarea', full: true },
];

export function HRDashboardPage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/hr`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const cards = s ? [
    { n: s.staff, label: 'Total Staff', icon: Users, ti: 'ti-users', c: BLUE, to: '/mgmt/staff-directory' },
    { n: s.activeStaff, label: 'Active Staff', icon: BadgeCheck, ti: 'ti-rosette-discount-check', c: GREEN, to: '/mgmt/staff-directory' },
    { n: s.presentToday, label: 'Present Today', icon: Users, ti: 'ti-users', c: GREEN, to: '/mgmt/staff-attendance-hr' },
    { n: s.departments, label: 'Departments', icon: Building2, ti: 'ti-building', c: PURPLE, to: '/mgmt/departments' },
    { n: s.pendingLeaves, label: 'Pending Leaves', icon: CalendarOff, ti: 'ti-calendar-off', c: C.brand, to: '/mgmt/approve-leave' },
    { n: s.pendingPayroll, label: 'Pending Payroll', icon: Wallet, ti: 'ti-wallet', c: RED, to: '/mgmt/payroll' },
    { n: s.activeLoans, label: 'Active Loans', icon: HandCoins, ti: 'ti-coins', c: C.brand, to: '/mgmt/staff-loans' },
  ] : [];
  return (
    <PageLayout title="HR Dashboard" subtitle="Staff, leave and payroll at a glance">
      <StatCards cards={cards} loading={!s} />
    </PageLayout>
  );
}

export function StaffDirectoryPage() {
  return <ResourcePage title="Staff Directory" subtitle="All school staff" resource="staff"
    columns={[
      { key: 'staff_no', label: 'Staff No' },
      { key: 'name', label: 'Name', render: (r) => <b>{r.first_name} {r.last_name}</b> },
      { key: 'department_name', label: 'Department' }, { key: 'designation_name', label: 'Designation' },
      { key: 'phone', label: 'Phone' },
      { key: 'status', label: 'Status', render: (r) => pill(r.status, { active: GREEN, inactive: RED }) },
    ]}
    fields={[
      { key: 'staff_no', label: 'Staff No', required: true },
      { key: 'first_name', label: 'First Name', required: true },
      { key: 'last_name', label: 'Last Name', required: true },
      { key: 'gender', label: 'Gender', type: 'select', options: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }] },
      { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
      { key: 'department_id', label: 'Department', type: 'select', optionsFrom: { resource: 'departments' } },
      { key: 'designation_id', label: 'Designation', type: 'select', optionsFrom: { resource: 'designations' } },
      { key: 'employment_type', label: 'Employment Type', type: 'select', default: 'full_time', options: [{ value: 'full_time', label: 'Full Time' }, { value: 'part_time', label: 'Part Time' }, { value: 'contract', label: 'Contract' }] },
      { key: 'monthly_salary', label: 'Monthly Salary (₦)', type: 'number' },
      { key: 'joined_on', label: 'Joined On', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', default: 'active', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
    ]}
    searchKeys={['staff_no', 'first_name', 'last_name', 'phone']}
    listFilters={[{ key: 'department_id', label: 'Department', optionsFrom: { resource: 'departments' } }]} createLabel="Add Staff" />;
}

/* ── Staff Attendance register ───────────────────────────────────── */
const STAFF_ATT = [
  { key: 'present', label: 'Present', c: GREEN }, { key: 'absent', label: 'Absent', c: RED },
  { key: 'late', label: 'Late', c: C.brand }, { key: 'leave', label: 'Leave', c: BLUE },
];
export function StaffAttendancePage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [register, setRegister] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(() => {
    apiGet(`${BASE}/hr/attendance/register?date=${date}`)
      .then((r) => setRegister((r.data || []).map((s) => ({ ...s, status: s.status || 'present' }))))
      .catch((e) => showToast(e.message || 'Could not load'));
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await apiPost(`${BASE}/hr/attendance/mark`, { date, entries: register.map((s) => ({ staff_id: s.id, status: s.status })) });
      showToast('Attendance saved ✓');
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  return (
    <PageLayout title="Staff Attendance" subtitle="Daily staff register">
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: 170 }} />
      </div>
      {register && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
          {register.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: C.muted2, fontSize: 13, fontFamily: C.font }}>No active staff.</div>
          ) : (
            <>
              {register.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, fontFamily: C.font }}>{s.name}</span>
                    <span style={{ fontSize: 11, color: C.muted2, fontFamily: C.font, marginLeft: 8 }}>{s.staff_no}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {STAFF_ATT.map((st) => (
                      <button key={st.key} onClick={() => setRegister((prev) => prev.map((r) => (r.id === s.id ? { ...r, status: st.key } : r)))}
                        style={{ padding: '6px 12px', borderRadius: 999, border: `1.5px solid ${s.status === st.key ? st.c : C.border}`, background: s.status === st.key ? tint(8, st.c) : C.surface, color: s.status === st.key ? st.c : C.muted2, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 16px', background: C.bg }}>
                <button onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 10, border: 'none', background: saving ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: saving ? C.muted2 : '#fff', fontSize: 13, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: C.font }}>
                  {saving ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-device-floppy" size={14} />} Save Attendance
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.hero, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

/* ── Payroll (generate + list) ───────────────────────────────────── */
export function PayrollPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(() => {
    apiGet(`${BASE}/payroll-records?month=${month}`).then((r) => setRows(r.data || [])).catch(() => {});
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setBusy(true);
    try {
      const res = await apiPost(`${BASE}/hr/payroll/generate`, { month });
      showToast(res.generated ? `Generated ${res.generated} record${res.generated === 1 ? '' : 's'} ✓` : (res.message || 'Already generated for this month'));
      load();
    } catch (e) { showToast(e.message || 'Could not generate'); }
    finally { setBusy(false); }
  };

  return (
    <PageLayout title="Payroll" subtitle="Monthly salary runs">
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ ...inputStyle, width: 180 }} />
        <button onClick={generate} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 9, border: 'none', background: busy ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: busy ? C.muted2 : '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
          {busy ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-player-play" size={13} />} Generate Payroll
        </button>
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
        {rows.length === 0 ? (
          <div style={{ padding: '30px', textAlign: 'center', color: C.muted2, fontSize: 13, fontFamily: C.font }}>No payroll records for {month}. Click "Generate Payroll".</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: C.font }}>
            <thead><tr style={{ background: C.bg }}>
              {['STAFF', 'GROSS', 'DEDUCTIONS', 'NET', 'STATUS'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: C.muted2 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '11px 14px', fontSize: 12.5, fontWeight: 700, color: C.ink }}>{r.staff_name}</td>
                  <td style={{ padding: '11px 14px', fontSize: 12.5 }}>{naira(r.gross)}</td>
                  <td style={{ padding: '11px 14px', fontSize: 12.5, color: RED }}>{naira(r.deductions)}</td>
                  <td style={{ padding: '11px 14px', fontSize: 12.5, fontWeight: 800, color: GREEN }}>{naira(r.net)}</td>
                  <td style={{ padding: '11px 14px' }}>{pill(r.status, { pending: C.brand, paid: GREEN })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.hero, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

export function SetSalaryPage() {
  return <ResourcePage title="Set Salary" subtitle="Update staff monthly salaries" resource="staff"
    columns={[
      { key: 'staff_no', label: 'Staff No' },
      { key: 'name', label: 'Name', render: (r) => <b>{r.first_name} {r.last_name}</b> },
      { key: 'designation_name', label: 'Designation' },
      { key: 'monthly_salary', label: 'Monthly Salary', render: (r) => <b>{naira(r.monthly_salary)}</b> },
    ]}
    fields={[{ key: 'monthly_salary', label: 'Monthly Salary (₦)', type: 'number', required: true }]}
    canCreate={false} canDelete={false} searchKeys={['staff_no', 'first_name', 'last_name']} />;
}

export function ApproveLeavePage() {
  return <ResourcePage title="Approve Leave" subtitle="Pending leave requests" resource="leave-requests"
    columns={LEAVE_COLUMNS} fields={LEAVE_FIELDS} fixedFilters={{ status: 'pending' }} canCreate={false} createLabel="Leave Request" />;
}

export function LeaveManagementPage() {
  return <ResourcePage title="Leave Management" subtitle="All leave requests" resource="leave-requests"
    columns={LEAVE_COLUMNS} fields={LEAVE_FIELDS}
    listFilters={[{ key: 'status', label: 'Status', options: LEAVE_STATUSES }]} createLabel="New Request" />;
}

export function LeaveTypesPage() {
  return <ResourcePage title="Leave Types" subtitle="Leave categories & allowances" resource="leave-types"
    columns={[{ key: 'name', label: 'Type' }, { key: 'days_allowed', label: 'Days Allowed' }]}
    fields={[{ key: 'name', label: 'Type Name', required: true }, { key: 'days_allowed', label: 'Days Allowed', type: 'number' }]}
    createLabel="New Type" />;
}

export function DepartmentsPage() {
  return <ResourcePage title="Departments" subtitle="School departments" resource="departments"
    columns={[{ key: 'name', label: 'Department' }]} fields={[{ key: 'name', label: 'Department Name', required: true }]} createLabel="New Department" />;
}

export function DesignationsPage() {
  return <ResourcePage title="Designations" subtitle="Job titles" resource="designations"
    columns={[{ key: 'name', label: 'Designation' }]} fields={[{ key: 'name', label: 'Designation Name', required: true }]} createLabel="New Designation" />;
}

/* ── Staff ID Card ───────────────────────────────────────────────── */
export function StaffIDCardPage() {
  const [staff, setStaff] = useState([]);
  const [id, setId] = useState('');
  useEffect(() => { apiGet(`${BASE}/staff?status=active`).then((r) => setStaff(r.data || [])).catch(() => {}); }, []);
  const s = staff.find((x) => x.id === id);
  return (
    <PageLayout title="Staff ID Card" subtitle="Preview & print staff identity cards">
      <select value={id} onChange={(e) => setId(e.target.value)} style={{ ...inputStyle, width: 300, cursor: 'pointer', marginBottom: 20 }}>
        <option value="">— select staff —</option>
        {staff.map((x) => <option key={x.id} value={x.id}>{x.first_name} {x.last_name} ({x.staff_no})</option>)}
      </select>
      {s && (
        <div style={{ width: 320, borderRadius: 16, overflow: 'hidden', boxShadow: '0 10px 30px rgba(26,26,46,.15)', fontFamily: C.font }}>
          <div style={{ background: `linear-gradient(135deg, ${C.ink}, #2d2d52)`, padding: '18px 20px', textAlign: 'center' }}>
            <p style={{ fontSize: 14, fontWeight: 800, color: '#fff', margin: 0 }}>Akoro School Portal</p>
            <p style={{ fontSize: 10, color: 'rgba(255,255,255,.6)', margin: '2px 0 0' }}>STAFF IDENTITY CARD</p>
          </div>
          <div style={{ background: C.surface, padding: '18px 20px' }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: tint(13), display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
              <Ico ti="ti-address-book" size={30} color={C.brand} />
            </div>
            <p style={{ fontSize: 16, fontWeight: 800, color: C.ink, margin: '0 0 2px', textAlign: 'center' }}>{s.first_name} {s.last_name}</p>
            <p style={{ fontSize: 12, color: C.muted, margin: '0 0 14px', textAlign: 'center' }}>{s.designation_name || 'Staff'} · {s.department_name || '—'}</p>
            {[['Staff No', s.staff_no], ['Phone', s.phone || '—'], ['Joined', s.joined_on || '—']].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderTop: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 11.5, color: C.muted2 }}>{l}</span>
                <b style={{ fontSize: 12, color: C.ink }}>{v}</b>
              </div>
            ))}
          </div>
          <div style={{ background: C.brand, height: 8 }} />
        </div>
      )}
    </PageLayout>
  );
}

export function HRSettingsPage() {
  return <ModuleSettingsForm module="hr" title="HR Settings" subtitle="Human-resource module preferences"
    fields={[
      { key: 'work_days', label: 'Work Days Per Week', type: 'number', hint: 'Used for attendance and payroll calculations.' },
      { key: 'default_leave_days', label: 'Default Annual Leave Days', type: 'number' },
      { key: 'payroll_day', label: 'Payroll Day of Month', type: 'number', hint: 'Day salaries are due each month.' },
      { key: 'require_leave_approval', label: 'Require Leave Approval', type: 'toggle' },
    ]} />;
}

export function StaffLoansPage() {
  return <ResourcePage title="Manage Staff Loans" subtitle="Loans and deductions" resource="staff-loans"
    columns={[
      { key: 'staff_name', label: 'Staff' },
      { key: 'amount', label: 'Amount', render: (r) => naira(r.amount) },
      { key: 'monthly_deduction', label: 'Monthly Deduction', render: (r) => naira(r.monthly_deduction) },
      { key: 'balance', label: 'Balance', render: (r) => <b style={{ color: RED }}>{naira(r.balance)}</b> },
      { key: 'status', label: 'Status', render: (r) => pill(r.status, { active: C.brand, closed: GREEN }) },
    ]}
    fields={[
      { key: 'staff_id', label: 'Staff', type: 'select', required: true, optionsFrom: staffOpts },
      { key: 'amount', label: 'Loan Amount (₦)', type: 'number', required: true },
      { key: 'monthly_deduction', label: 'Monthly Deduction (₦)', type: 'number' },
      { key: 'balance', label: 'Balance (₦)', type: 'number' },
      { key: 'issued_on', label: 'Issued On', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', default: 'active', options: [{ value: 'active', label: 'Active' }, { value: 'closed', label: 'Closed' }] },
    ]} createLabel="New Loan" />;
}

export function SalaryTemplatesPage() {
  return <ResourcePage title="Salary Templates" subtitle="Reusable salary structures" resource="salary-templates"
    columns={[
      { key: 'name', label: 'Template' }, { key: 'basic', label: 'Basic', render: (r) => naira(r.basic) },
      { key: 'housing', label: 'Housing', render: (r) => naira(r.housing) },
      { key: 'transport', label: 'Transport', render: (r) => naira(r.transport) },
      { key: 'total', label: 'Total', render: (r) => <b>{naira(Number(r.basic || 0) + Number(r.housing || 0) + Number(r.transport || 0) + Number(r.other || 0))}</b> },
    ]}
    fields={[
      { key: 'name', label: 'Template Name', required: true },
      { key: 'basic', label: 'Basic (₦)', type: 'number' },
      { key: 'housing', label: 'Housing (₦)', type: 'number' },
      { key: 'transport', label: 'Transport (₦)', type: 'number' },
      { key: 'other', label: 'Other (₦)', type: 'number' },
    ]} createLabel="New Template" />;
}

export function AppraisalCyclesPage() {
  return <ResourcePage title="Appraisal Cycles" subtitle="Review periods" resource="appraisal-cycles"
    columns={[
      { key: 'name', label: 'Cycle' }, { key: 'starts_on', label: 'Starts' }, { key: 'ends_on', label: 'Ends' },
      { key: 'status', label: 'Status', render: (r) => pill(r.status, { open: GREEN, closed: C.muted2 }) },
    ]}
    fields={[
      { key: 'name', label: 'Cycle Name', required: true },
      { key: 'status', label: 'Status', type: 'select', default: 'open', options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }] },
      { key: 'starts_on', label: 'Starts On', type: 'date' },
      { key: 'ends_on', label: 'Ends On', type: 'date' },
    ]} createLabel="New Cycle" />;
}

export function AppraisalCriteriaPage() {
  return <ResourcePage title="Appraisal Criteria" subtitle="What staff are scored on" resource="appraisal-criteria"
    columns={[{ key: 'title', label: 'Criterion' }, { key: 'weight', label: 'Weight (%)' }]}
    fields={[{ key: 'title', label: 'Criterion', required: true }, { key: 'weight', label: 'Weight (%)', type: 'number' }]}
    createLabel="New Criterion" />;
}

export function AppraisalsPage() {
  return <ResourcePage title="Appraisals" subtitle="Staff performance reviews" resource="appraisals"
    columns={[
      { key: 'staff_name', label: 'Staff' }, { key: 'cycle_name', label: 'Cycle' },
      { key: 'score', label: 'Score', render: (r) => r.score != null ? <b>{r.score}%</b> : '—' },
      { key: 'status', label: 'Status', render: (r) => pill(r.status, { draft: C.brand, final: GREEN }) },
    ]}
    fields={[
      { key: 'staff_id', label: 'Staff', type: 'select', required: true, optionsFrom: staffOpts },
      { key: 'cycle_id', label: 'Cycle', type: 'select', optionsFrom: { resource: 'appraisal-cycles' } },
      { key: 'score', label: 'Score (%)', type: 'number' },
      { key: 'status', label: 'Status', type: 'select', default: 'draft', options: [{ value: 'draft', label: 'Draft' }, { value: 'final', label: 'Final' }] },
      { key: 'strengths', label: 'Strengths', type: 'textarea', full: true },
      { key: 'improvements', label: 'Areas for Improvement', type: 'textarea', full: true },
    ]} createLabel="New Appraisal" />;
}
