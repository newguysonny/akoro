/**
 * Finance & Fees module pages (mgmt schema).
 * Custom: Dashboard, Collect Fees, Search Due Fees, Carry Forward,
 * Generate Due Slip. The rest are ResourcePage configs.
 */
import { useState, useEffect, useCallback } from 'react';
import { Banknote, Wallet, TrendingUp, Receipt, Globe, Layers } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import StatCards from '../../components/mgmt/StatCards.jsx';
import { apiGet, apiPost } from '../../services/api.js';
import { GREEN, RED, BLUE, PURPLE } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

const BASE = '/api/school/mgmt';
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const studentOpts = { resource: 'students', labelFn: (r) => `${r.first_name} ${r.last_name} (${r.admission_no})` };
const METHODS = ['cash', 'bank', 'online', 'pos', 'cheque'].map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) }));

const PAYMENT_COLUMNS = [
  { key: 'student_name', label: 'Student' },
  { key: 'amount', label: 'Amount', render: (r) => <b>{naira(r.amount)}</b> },
  { key: 'method', label: 'Method', render: (r) => <span style={{ padding: '3px 9px', borderRadius: 6, background: '#0EA5E9', color: '#fff', fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{r.method}</span> },
  { key: 'reference', label: 'Reference' },
  { key: 'paid_on', label: 'Date' },
  { key: 'received_by', label: 'Received By' },
];

/* ── Fees Dashboard ──────────────────────────────────────────────── */
export function FeesDashboardPage() {
  const [stats, setStats] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/finance`).then((r) => setStats(r.data)).catch(() => setStats({})); }, []);
  const cards = stats ? [
    { n: naira(stats.collected), label: 'Total Collected', icon: Wallet, ti: 'ti-wallet', c: GREEN, to: '/mgmt/all-transactions' },
    { n: naira(stats.outstanding), label: 'Outstanding', icon: TrendingUp, ti: 'ti-trending-up', c: RED, to: '/mgmt/search-due-fees' },
    { n: naira(stats.assigned), label: 'Total Assigned', icon: Banknote, ti: 'ti-cash-banknote', c: BLUE, to: '/mgmt/assign-fees' },
    { n: naira(stats.collectedToday), label: 'Collected Today', icon: Wallet, ti: 'ti-wallet', c: C.brand, to: '/mgmt/collect-fees' },
    { n: stats.transactions, label: 'Transactions', icon: Receipt, ti: 'ti-receipt', c: PURPLE, to: '/mgmt/all-transactions' },
    { n: stats.onlineTransactions, label: 'Online Transactions', icon: Globe, ti: 'ti-world', c: BLUE, to: '/mgmt/online-transactions' },
    { n: stats.feeTypes, label: 'Fee Types', icon: Layers, ti: 'ti-stack-2', c: C.brand, to: '/mgmt/fee-types' },
  ] : [];
  return (
    <PageLayout title="Fees Dashboard" subtitle="Collections, dues and fee setup at a glance">
      <StatCards cards={cards} loading={!stats} />
    </PageLayout>
  );
}

/* ── Collect Fees ────────────────────────────────────────────────── */
export function CollectFeesPage() {
  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState('');
  const [dues, setDues] = useState(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  useEffect(() => { apiGet(`${BASE}/students?status=active`).then((r) => setStudents(r.data || [])).catch(() => {}); }, []);

  const loadDues = useCallback(() => {
    if (!studentId) return setDues(null);
    apiGet(`${BASE}/fees/dues?student_id=${studentId}`).then((r) => setDues(r.data?.[0] || null)).catch(() => {});
  }, [studentId]);
  useEffect(() => { loadDues(); }, [loadDues]);

  const collect = async () => {
    if (!studentId || !amount) return showToast('Pick a student and enter an amount');
    setBusy(true);
    try {
      await apiPost(`${BASE}/fees/collect`, { student_id: studentId, amount: Number(amount), method, reference: reference || undefined, note: note || undefined });
      showToast('Payment recorded ✓');
      setAmount(''); setReference(''); setNote(''); loadDues();
    } catch (e) { showToast(e.message || 'Could not record payment'); }
    finally { setBusy(false); }
  };

  const lbl = { fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 5 };
  return (
    <PageLayout title="Collect Fees" subtitle="Record a fee payment">
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 340px', maxWidth: 480, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 22px' }}>
          <label style={lbl}>Student</label>
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', marginBottom: 14 }}>
            <option value="">— select student —</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name} ({s.admission_no})</option>)}
          </select>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 13, marginBottom: 14 }}>
            <div><label style={lbl}>Amount (₦)</label><input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} /></div>
            <div><label style={lbl}>Method</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select></div>
          </div>
          <label style={lbl}>Reference <span style={{ fontWeight: 500, color: C.muted2 }}>(auto if blank)</span></label>
          <input value={reference} onChange={(e) => setReference(e.target.value)} style={{ ...inputStyle, marginBottom: 14 }} />
          <label style={lbl}>Note</label>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inputStyle, resize: 'vertical', marginBottom: 16 }} />
          <button onClick={collect} disabled={busy} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: busy ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: busy ? C.muted2 : '#fff', fontSize: 13.5, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: C.font }}>
            {busy ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-device-floppy" size={14} />} {busy ? 'Recording…' : 'Record Payment'}
          </button>
        </div>

        {dues && (
          <div style={{ flex: '1 1 260px', maxWidth: 340, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 22px', fontFamily: C.font }}>
            <p style={{ fontSize: 14, fontWeight: 800, color: C.ink, margin: '0 0 14px' }}>{dues.name}</p>
            {[['Assigned', dues.assigned, C.ink], ['Paid', dues.paid, GREEN], ['Balance Due', dues.due, dues.due > 0 ? RED : GREEN]].map(([l, v, c]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 12.5, color: C.muted }}>{l}</span>
                <b style={{ fontSize: 13.5, color: c }}>{naira(v)}</b>
              </div>
            ))}
          </div>
        )}
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.hero, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

/* ── Search Due Fees ─────────────────────────────────────────────── */
export function SearchDueFeesPage() {
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState('');
  const [rows, setRows] = useState(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {}); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiGet(`${BASE}/fees/dues${classId ? `?class_id=${classId}` : ''}`);
      setRows((res.data || []).filter((d) => d.due > 0));
    } catch { setRows([]); }
    finally { setLoading(false); }
  };

  const q = query.trim().toLowerCase();
  const visible = (rows || []).filter((r) => !q || r.name.toLowerCase().includes(q) || r.admission_no.toLowerCase().includes(q));

  return (
    <PageLayout title="Search Due Fees" subtitle="Students with outstanding balances">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={classId} onChange={(e) => setClassId(e.target.value)} style={{ ...inputStyle, width: 170, cursor: 'pointer' }}>
          <option value="">All classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={load} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: BLUE, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
          <Ico ti="ti-search" size={13} /> {loading ? 'Searching…' : 'Search Dues'}
        </button>
        {rows && <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter results…" style={{ ...inputStyle, width: 220 }} />}
      </div>

      {rows && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
          {visible.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: C.muted2, fontSize: 13, fontFamily: C.font }}>No outstanding dues</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: C.font }}>
              <thead><tr style={{ background: C.bg }}>
                {['STUDENT', 'ADMISSION NO', 'ASSIGNED', 'PAID', 'DUE'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: C.muted2 }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.student_id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: '11px 14px', fontSize: 12.5, fontWeight: 700, color: C.ink }}>{r.name}</td>
                    <td style={{ padding: '11px 14px', fontSize: 12.5, color: C.muted }}>{r.admission_no}</td>
                    <td style={{ padding: '11px 14px', fontSize: 12.5, color: C.ink }}>{naira(r.assigned)}</td>
                    <td style={{ padding: '11px 14px', fontSize: 12.5, color: GREEN }}>{naira(r.paid)}</td>
                    <td style={{ padding: '11px 14px', fontSize: 12.5, fontWeight: 800, color: RED }}>{naira(r.due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </PageLayout>
  );
}

/* ── Transactions (config) ───────────────────────────────────────── */
export function AllTransactionsPage() {
  return <ResourcePage title="All Transactions" subtitle="Every fee payment recorded" resource="fee-payments"
    columns={PAYMENT_COLUMNS} fields={[]} canCreate={false} canEdit={false}
    searchKeys={['student_name', 'reference', 'method']}
    listFilters={[{ key: 'method', label: 'Method', options: METHODS }]} />;
}

export function OnlineTransactionsPage() {
  return <ResourcePage title="Online Transactions" subtitle="Payments made online" resource="fee-payments"
    columns={PAYMENT_COLUMNS} fields={[]} fixedFilters={{ method: 'online' }}
    canCreate={false} canEdit={false} canDelete={false} searchKeys={['student_name', 'reference']} />;
}

export function FeeChallansPage() {
  return <ResourcePage title="Fee Challans" subtitle="Bank payment challans" resource="fee-challans"
    columns={[
      { key: 'challan_no', label: 'Challan No' }, { key: 'student_name', label: 'Student' },
      { key: 'amount', label: 'Amount', render: (r) => naira(r.amount) },
      { key: 'status', label: 'Status', render: (r) => <span style={{ padding: '3px 10px', borderRadius: 999, background: tint(8, { unpaid: C.brand, paid: GREEN, cancelled: RED }[r.status]), color: { unpaid: C.brand, paid: GREEN, cancelled: RED }[r.status], fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{r.status}</span> },
      { key: 'due_date', label: 'Due Date' },
    ]}
    fields={[
      { key: 'student_id', label: 'Student', type: 'select', required: true, optionsFrom: studentOpts },
      { key: 'challan_no', label: 'Challan No', required: true },
      { key: 'amount', label: 'Amount (₦)', type: 'number', required: true },
      { key: 'status', label: 'Status', type: 'select', default: 'unpaid', options: [{ value: 'unpaid', label: 'Unpaid' }, { value: 'paid', label: 'Paid' }, { value: 'cancelled', label: 'Cancelled' }] },
      { key: 'due_date', label: 'Due Date', type: 'date' },
    ]} listFilters={[{ key: 'status', label: 'Status', options: [{ value: 'unpaid', label: 'Unpaid' }, { value: 'paid', label: 'Paid' }, { value: 'cancelled', label: 'Cancelled' }] }]}
    createLabel="New Challan" />;
}

export function AssignFeesPage() {
  return <ResourcePage title="Assign Fees" subtitle="Attach a fee to a class or a specific student" resource="fee-assignments"
    columns={[
      { key: 'fee_type_name', label: 'Fee Type' }, { key: 'class_name', label: 'Class' },
      { key: 'student_name', label: 'Student' }, { key: 'amount', label: 'Amount', render: (r) => naira(r.amount) },
      { key: 'due_date', label: 'Due Date' }, { key: 'discount_name', label: 'Discount' },
    ]}
    fields={[
      { key: 'fee_type_id', label: 'Fee Type', type: 'select', required: true, optionsFrom: { resource: 'fee-types' } },
      { key: 'session_id', label: 'Session', type: 'select', optionsFrom: { resource: 'academic-sessions' } },
      { key: 'class_id', label: 'Class (whole class)', type: 'select', optionsFrom: { resource: 'classes' } },
      { key: 'student_id', label: 'Student (individual)', type: 'select', optionsFrom: studentOpts },
      { key: 'amount', label: 'Amount (₦)', type: 'number', required: true },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'discount_id', label: 'Discount', type: 'select', optionsFrom: { resource: 'fee-discounts' } },
    ]} listFilters={[{ key: 'class_id', label: 'Class', optionsFrom: { resource: 'classes' } }]} createLabel="Assign Fee" />;
}

export function FeeGroupsPage() {
  return <ResourcePage title="Fee Groups" subtitle="Group related fee types" resource="fee-groups"
    columns={[{ key: 'name', label: 'Group' }, { key: 'description', label: 'Description' }]}
    fields={[{ key: 'name', label: 'Group Name', required: true }, { key: 'description', label: 'Description', type: 'textarea', full: true }]}
    createLabel="New Group" />;
}

export function FeeDiscountsPage() {
  return <ResourcePage title="Fees Discount" subtitle="Scholarships & waivers" resource="fee-discounts"
    columns={[
      { key: 'name', label: 'Discount' }, { key: 'discount_type', label: 'Type' },
      { key: 'amount', label: 'Amount', render: (r) => r.discount_type === 'percentage' ? `${r.amount}%` : naira(r.amount) },
    ]}
    fields={[
      { key: 'name', label: 'Discount Name', required: true },
      { key: 'discount_type', label: 'Type', type: 'select', default: 'percentage', options: [{ value: 'percentage', label: 'Percentage (%)' }, { value: 'flat', label: 'Flat Amount' }] },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
    ]} createLabel="New Discount" />;
}

export function FeeTypesPage() {
  return <ResourcePage title="Fee Types" subtitle="Individual chargeable items" resource="fee-types"
    columns={[
      { key: 'name', label: 'Fee Type' }, { key: 'code', label: 'Code' },
      { key: 'group_name', label: 'Group' }, { key: 'default_amount', label: 'Default Amount', render: (r) => naira(r.default_amount) },
    ]}
    fields={[
      { key: 'name', label: 'Fee Name', required: true },
      { key: 'code', label: 'Code', placeholder: 'TUI' },
      { key: 'group_id', label: 'Fee Group', type: 'select', optionsFrom: { resource: 'fee-groups' } },
      { key: 'default_amount', label: 'Default Amount (₦)', type: 'number' },
    ]} createLabel="New Fee Type" />;
}

/* ── Generate Due Slip + history ─────────────────────────────────── */
export function GenerateDueSlipPage() {
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState('');
  const [periodLabel, setPeriodLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3200); };

  useEffect(() => { apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {}); }, []);

  const generate = async () => {
    if (!classId) return showToast('Pick a class');
    setBusy(true);
    try {
      const res = await apiPost(`${BASE}/fees/due-slips/generate`, { class_id: classId, period_label: periodLabel || undefined });
      showToast(res.generated ? `Generated ${res.generated} due slip${res.generated === 1 ? '' : 's'} ✓` : (res.message || 'Nothing to generate'));
    } catch (e) { showToast(e.message || 'Could not generate'); }
    finally { setBusy(false); }
  };

  return (
    <PageLayout title="Generate Due Slip" subtitle="Create dues notices for a class">
      <div style={{ maxWidth: 460, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 22px', fontFamily: C.font }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, display: 'block', marginBottom: 5 }}>Class</label>
        <select value={classId} onChange={(e) => setClassId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', marginBottom: 14 }}>
          <option value="">— select class —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, display: 'block', marginBottom: 5 }}>Period Label</label>
        <input value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} placeholder="e.g. JUL 2026" style={{ ...inputStyle, marginBottom: 16 }} />
        <button onClick={generate} disabled={busy} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: busy ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: busy ? C.muted2 : '#fff', fontSize: 13.5, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: C.font }}>
          {busy ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-receipt" size={14} />} {busy ? 'Generating…' : 'Generate Due Slips'}
        </button>
        <p style={{ fontSize: 11.5, color: C.muted2, margin: '10px 0 0', lineHeight: 1.5 }}>A slip is created for every student in the class with an outstanding balance. View them under Due Slip History.</p>
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.hero, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

export function DueSlipHistoryPage() {
  return <ResourcePage title="Due Slip History" subtitle="Previously generated dues notices" resource="due-slips"
    columns={[
      { key: 'slip_no', label: 'Slip No' }, { key: 'student_name', label: 'Student' },
      { key: 'period_label', label: 'Period' }, { key: 'amount_due', label: 'Amount Due', render: (r) => <b style={{ color: RED }}>{naira(r.amount_due)}</b> },
      { key: 'generated_at', label: 'Generated', render: (r) => new Date(r.generated_at).toLocaleDateString() },
    ]}
    fields={[]} canCreate={false} canEdit={false} searchKeys={['slip_no', 'student_name', 'period_label']} />;
}

/* ── Fees Carry Forward ──────────────────────────────────────────── */
export function FeesCarryForwardPage() {
  const [sessions, setSessions] = useState([]);
  const [fromSession, setFromSession] = useState('');
  const [toSession, setToSession] = useState('');
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3200); };

  const loadHistory = useCallback(() => {
    apiGet(`${BASE}/fee-carry-forwards`).then((r) => setHistory(r.data || [])).catch(() => {});
  }, []);
  useEffect(() => {
    apiGet(`${BASE}/academic-sessions`).then((r) => setSessions(r.data || [])).catch(() => {});
    loadHistory();
  }, [loadHistory]);

  const run = async () => {
    if (!fromSession || !toSession) return showToast('Pick both sessions');
    setBusy(true);
    try {
      const res = await apiPost(`${BASE}/fees/carry-forward`, { from_session_id: fromSession, to_session_id: toSession });
      showToast(res.carried ? `Carried forward ${res.carried} balance${res.carried === 1 ? '' : 's'} ✓` : (res.message || 'Nothing to carry'));
      loadHistory();
    } catch (e) { showToast(e.message || 'Carry forward failed'); }
    finally { setBusy(false); }
  };

  return (
    <PageLayout title="Fees Carry Forward" subtitle="Move unpaid balances into a new session">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        <select value={fromSession} onChange={(e) => setFromSession(e.target.value)} style={{ ...inputStyle, width: 190, cursor: 'pointer' }}>
          <option value="">From session…</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={toSession} onChange={(e) => setToSession(e.target.value)} style={{ ...inputStyle, width: 190, cursor: 'pointer' }}>
          <option value="">To session…</option>{sessions.filter((s) => s.id !== fromSession).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={run} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 9, border: 'none', background: busy ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: busy ? C.muted2 : '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
          {busy ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : null} Carry Forward
        </button>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
        {history.length === 0 ? (
          <div style={{ padding: '30px', textAlign: 'center', color: C.muted2, fontSize: 13, fontFamily: C.font }}>No carry-forward records yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: C.font }}>
            <thead><tr style={{ background: C.bg }}>
              {['STUDENT', 'FROM', 'TO', 'AMOUNT', 'DATE'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: C.muted2 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '11px 14px', fontSize: 12.5, fontWeight: 700, color: C.ink }}>{r.student_name}</td>
                  <td style={{ padding: '11px 14px', fontSize: 12.5, color: C.muted }}>{r.from_session_name || '—'}</td>
                  <td style={{ padding: '11px 14px', fontSize: 12.5, color: C.muted }}>{r.to_session_name || '—'}</td>
                  <td style={{ padding: '11px 14px', fontSize: 12.5, fontWeight: 800, color: RED }}>{naira(r.amount)}</td>
                  <td style={{ padding: '11px 14px', fontSize: 12, color: C.muted2 }}>{new Date(r.created_at).toLocaleDateString()}</td>
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
