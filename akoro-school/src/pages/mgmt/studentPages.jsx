/**
 * Student Information module pages (mgmt schema).
 * Most pages are ResourcePage configs; Dashboard + Attendance are custom.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Users, UserCheck, UserX, Home, Tags, ShieldAlert, Loader2, Save, ClipboardCheck,
  Eye, Pencil, Trash2, UserPlus, Search, ArrowLeft, Phone, Mail, MapPin, Droplet,
  Cake, CreditCard, ShieldCheck, CircleDot, X, Copy, Printer, Columns, Image,
  FileUp, Upload, Sheet, Download, CheckSquare, FileText,
  FolderOpen, Key, HeartPulse, Bus, Bed, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, RefreshCw,
  ClipboardList, ThumbsUp, ThumbsDown, Plus,
} from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import { API, apiGet, apiPost, apiPut, apiDelete } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../constants.js';

const BASE = '/api/school/mgmt';
const fullName = (r) => [r.first_name, r.last_name].filter(Boolean).join(' ');
const studentOpts = { resource: 'students', labelFn: (r) => `${fullName(r)} (${r.admission_no})` };

const STATUS_PILL = (v, map) => {
  const m = map[v] || { c: MUTED2 };
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: `${m.c}15`, color: m.c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{v}</span>;
};

const STUDENT_FIELDS = [
  { key: 'admission_no', label: 'Admission No', required: true },
  { key: 'roll_no', label: 'Roll No' },
  { key: 'first_name', label: 'First Name', required: true },
  { key: 'last_name', label: 'Last Name', required: true },
  { key: 'gender', label: 'Gender', type: 'select', options: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }] },
  { key: 'dob', label: 'Date of Birth', type: 'date' },
  { key: 'class_id', label: 'Class', type: 'select', optionsFrom: { resource: 'classes' } },
  { key: 'section_id', label: 'Section', type: 'select', optionsFrom: { resource: 'sections', labelFn: (r) => `${r.class_name || ''} — ${r.name}` } },
  { key: 'category_id', label: 'Category', type: 'select', optionsFrom: { resource: 'student-categories' } },
  { key: 'house_id', label: 'House', type: 'select', optionsFrom: { resource: 'student-houses' } },
  { key: 'guardian_name', label: 'Guardian Name' },
  { key: 'guardian_phone', label: 'Guardian Phone' },
  { key: 'guardian_email', label: 'Guardian Email' },
  { key: 'blood_group', label: 'Blood Group' },
  { key: 'address', label: 'Address', type: 'textarea', full: true },
  { key: 'is_disabled', label: 'Has Disability', type: 'toggle' },
  { key: 'disability_note', label: 'Disability Note', full: true },
  { key: 'status', label: 'Status', type: 'select', default: 'active', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'alumni', label: 'Alumni' }] },
  { key: 'admitted_on', label: 'Admitted On', type: 'date' },
];

const STUDENT_COLUMNS = [
  { key: 'admission_no', label: 'Admission No' },
  { key: 'name', label: 'Name', render: (r) => <b>{fullName(r)}</b> },
  { key: 'class_name', label: 'Class' },
  { key: 'section_name', label: 'Section' },
  { key: 'guardian_phone', label: 'Guardian Phone' },
  { key: 'status', label: 'Status', render: (r) => STATUS_PILL(r.status, { active: { c: GREEN }, inactive: { c: RED }, alumni: { c: BLUE } }) },
];
const STUDENT_SEARCH = ['admission_no', 'first_name', 'last_name', 'guardian_phone'];
const CLASS_FILTER = { key: 'class_id', label: 'Class', optionsFrom: { resource: 'classes' } };

/* ── Student Dashboard ───────────────────────────────────────────── */
export function StudentDashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/students`).then((r) => setStats(r.data)).catch(() => setStats({})); }, []);
  const cards = stats ? [
    { n: stats.total, label: 'Total Students', icon: Users, c: BLUE, to: '/mgmt/students' },
    { n: stats.active, label: 'Active Students', icon: UserCheck, c: GREEN, to: '/mgmt/students' },
    { n: stats.presentToday, label: 'Present Today', icon: ClipboardCheck, c: GREEN, to: '/mgmt/student-attendance' },
    { n: stats.absentToday, label: 'Absent Today', icon: UserX, c: RED, to: '/mgmt/student-attendance' },
    { n: stats.disabled, label: 'Disabled Students', icon: ShieldAlert, c: AMBER, to: '/mgmt/disabled-students' },
    { n: stats.behaviorIncidents, label: 'Behavior Records', icon: ShieldAlert, c: PURPLE, to: '/mgmt/behavior-records' },
    { n: stats.houses, label: 'Houses', icon: Home, c: BLUE, to: '/mgmt/student-houses' },
    { n: stats.categories, label: 'Categories', icon: Tags, c: AMBER, to: '/mgmt/student-categories' },
  ] : [];
  return (
    <PageLayout title="Student Dashboard" subtitle="Overview of your student body">
      {!stats ? (
        <div style={{ padding: '50px 0', textAlign: 'center', color: MUTED2 }}><Loader2 size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {cards.map((c) => (
            <div key={c.label} onClick={() => navigate(c.to)} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '18px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 42, height: 42, borderRadius: 11, background: `${c.c}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <c.icon size={19} color={c.c} />
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, color: INK, fontFamily: FONT }}>{c.n ?? 0}</div>
                <div style={{ fontSize: 12, color: MUTED2, fontFamily: FONT }}>{c.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageLayout>
  );
}

/* ── Student Admission (create-first) + Student List ─────────────── */
export function StudentAdmissionPage() {
  return <ResourcePage title="Student Admission" subtitle="Admit a new student" resource="students"
    columns={STUDENT_COLUMNS} fields={STUDENT_FIELDS} searchKeys={STUDENT_SEARCH}
    createLabel="Admit Student" startOpen listFilters={[CLASS_FILTER]} />;
}

const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const STATUS_OPTS = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'alumni', label: 'Alumni' }];

/* ── CSV / export / print helpers (no external deps) ─────────────────────── */
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function openPrintTable(title, headers, rows) {
  const w = window.open('', '_blank');
  if (!w) return;
  const html = `<!doctype html><html><head><title>${title}</title><style>
    body{font-family:Arial,sans-serif;padding:20px} h1{font-size:18px}
    table{width:100%;border-collapse:collapse;font-size:12px} th,td{border:1px solid #999;padding:6px 8px;text-align:left}
    th{background:#f1f1f4}</style></head><body>
    <h1>${title}</h1>
    <table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <script>window.onload=()=>window.print()</script></body></html>`;
  w.document.write(html); w.document.close();
}

const ALL_COLUMNS = [
  { key: 'admission_no', label: 'Adm No.' }, { key: 'roll_no', label: 'Roll No.' },
  { key: 'name', label: 'Name' }, { key: 'class_name', label: 'Class' }, { key: 'section_name', label: 'Section' },
  { key: 'fee_assigned', label: 'Total Assigned' }, { key: 'fee_due', label: 'Total Due' }, { key: 'status', label: 'Status' },
];

/* ── Student List — table with fee dues, filters, bulk tools ─────────────── */
export function StudentListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [status, setStatus] = useState('active');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [visibleCols, setVisibleCols] = useState(Object.fromEntries(ALL_COLUMNS.map((c) => [c.key, true])));
  const [colMenu, setColMenu] = useState(false);
  const [modal, setModal] = useState(null); // 'bulk-edit'
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(() => {
    setRows(null);
    const params = new URLSearchParams();
    if (classId) params.set('class_id', classId);
    if (sectionId) params.set('section_id', sectionId);
    if (status) params.set('status', status);
    apiGet(`${BASE}/students/list?${params}`)
      .then((r) => { setRows(r.data || []); setSelected({}); setPage(1); })
      .catch((e) => { showToast(e.message || 'Could not load students'); setRows([]); });
  }, [classId, sectionId, status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/sections`).then((r) => setSections(r.data || [])).catch(() => {});
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = (rows || []).filter((r) => !q ||
    [r.admission_no, r.first_name, r.last_name, r.guardian_phone].some((v) => String(v || '').toLowerCase().includes(q)));
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize);

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const allPageSelected = pageRows.length > 0 && pageRows.every((r) => selected[r.id]);
  const toggleAll = (on) => setSelected((prev) => { const next = { ...prev }; pageRows.forEach((r) => { next[r.id] = on; }); return next; });

  const remove = async (r) => {
    if (!window.confirm(`Remove ${fullName(r)} (${r.admission_no})? This cannot be undone.`)) return;
    setBusyId(r.id);
    try { await apiDelete(`${BASE}/students/${r.id}`); setRows((p) => p.filter((x) => x.id !== r.id)); showToast('Removed'); }
    catch (e) { showToast(e.message || 'Could not remove'); }
    finally { setBusyId(null); }
  };

  const bulkDelete = async () => {
    if (!selectedIds.length) return;
    if (!window.confirm(`Delete ${selectedIds.length} selected student(s)? This cannot be undone.`)) return;
    try { await apiPost(`${BASE}/students/bulk-delete`, { ids: selectedIds }); showToast(`Deleted ${selectedIds.length} student(s)`); load(); }
    catch (e) { showToast(e.message || 'Bulk delete failed'); }
  };

  const exportRows = filtered.map((r) => ALL_COLUMNS.filter((c) => visibleCols[c.key]).map((c) => c.key === 'name' ? fullName(r) : r[c.key]));
  const exportHeaders = ALL_COLUMNS.filter((c) => visibleCols[c.key]).map((c) => c.label);
  const doCopy = () => {
    const text = [exportHeaders.join('\t'), ...exportRows.map((r) => r.join('\t'))].join('\n');
    navigator.clipboard?.writeText(text).then(() => showToast(`Copied ${exportRows.length} rows`)).catch(() => showToast('Could not copy'));
  };
  const doCSV = () => downloadBlob([exportHeaders.join(','), ...exportRows.map((r) => r.map(csvCell).join(','))].join('\n'), 'students.csv', 'text/csv');
  const doExcel = () => {
    const html = `<table><tr>${exportHeaders.map((h) => `<th>${h}</th>`).join('')}</tr>${exportRows.map((r) => `<tr>${r.map((c) => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('')}</table>`;
    downloadBlob(html, 'students.xls', 'application/vnd.ms-excel');
  };
  const doPDF = () => openPrintTable('Student List', exportHeaders, exportRows);
  const doPrint = () => openPrintTable('Student List', exportHeaders, exportRows);

  const th = { textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .4, whiteSpace: 'nowrap' };
  const td = { padding: '11px 14px', fontSize: 13, color: INK, borderTop: `1px solid ${BORDER}`, whiteSpace: 'nowrap' };
  const iconBtn = (color) => ({ width: 30, height: 30, borderRadius: 7, border: 'none', background: `${color}15`, color, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' });
  const selStyle = { ...inputStyle, width: 'auto', minWidth: 150, cursor: 'pointer' };
  const toolBtn = (color, disabled) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: `1px solid ${color}44`, background: disabled ? LIGHT : `${color}0C`, color: disabled ? MUTED2 : color, fontSize: 12, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: FONT, opacity: disabled ? 0.6 : 1 });

  const colCount = 2 + ALL_COLUMNS.filter((c) => visibleCols[c.key]).length + 1;

  return (
    <PageLayout title="Student List" subtitle="All students in your school">
      {/* Admit / bulk-action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <button onClick={() => navigate('/mgmt/student-admission')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          <UserPlus size={15} /> Admit Student
        </button>
        <button onClick={() => navigate('/mgmt/students/bulk-upload')} style={{ ...toolBtn(BLUE), background: `${BLUE}12` }}><Upload size={14} /> Bulk Upload</button>
        <button onClick={() => navigate('/mgmt/students/bulk-photos')} style={{ ...toolBtn(PURPLE), background: `${PURPLE}12` }}><Image size={14} /> Bulk Photos</button>
        <button onClick={() => navigate('/mgmt/students/bulk-docs')} style={{ ...toolBtn(GREEN), background: `${GREEN}12` }}><FileUp size={14} /> Bulk Docs</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }} style={selStyle}>
          <option value="">All Classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={selStyle}>
          <option value="">All Sections</option>{sections.filter((s) => !classId || s.class_id === classId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={selStyle}>
          <option value="">All Statuses</option>{STATUS_OPTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {/* Utility toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: MUTED, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 6 }}>
          Show
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ ...inputStyle, width: 72, padding: '6px 8px', cursor: 'pointer' }}>
            <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option><option value={0}>All</option>
          </select>
          entries
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={doCopy} style={toolBtn(MUTED)}><Copy size={13} /> Copy</button>
          <button onClick={doCSV} style={toolBtn(GREEN)}><Download size={13} /> CSV</button>
          <button onClick={doExcel} style={toolBtn(GREEN)}><Sheet size={13} /> Excel</button>
          <button onClick={doPDF} style={toolBtn(RED)}><FileText size={13} /> PDF</button>
          <button onClick={doPrint} style={toolBtn(INK)}><Printer size={13} /> Print</button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setColMenu((v) => !v)} style={toolBtn(BLUE)}><Columns size={13} /> Column Visibility</button>
            {colMenu && (
              <div onMouseLeave={() => setColMenu(false)} style={{ position: 'absolute', top: '110%', left: 0, zIndex: 20, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 10, minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,.12)' }}>
                {ALL_COLUMNS.map((c) => (
                  <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', fontSize: 12.5, fontFamily: FONT, color: INK, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!visibleCols[c.key]} onChange={(e) => setVisibleCols((p) => ({ ...p, [c.key]: e.target.checked }))} />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => selectedIds.length ? setModal('bulk-edit') : showToast('Select at least one student first')} style={toolBtn(AMBER, !selectedIds.length)}><Pencil size={13} /> Bulk Edit{selectedIds.length ? ` (${selectedIds.length})` : ''}</button>
          <button onClick={bulkDelete} disabled={!selectedIds.length} style={toolBtn(RED, !selectedIds.length)}><Trash2 size={13} /> Bulk Delete{selectedIds.length ? ` (${selectedIds.length})` : ''}</button>
        </div>
        <div style={{ position: 'relative', marginLeft: 'auto', minWidth: 200 }}>
          <Search size={15} color={MUTED2} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search name, adm no, phone…" style={{ ...inputStyle, paddingLeft: 34 }} />
        </div>
      </div>

      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
          <thead><tr>
            <th style={{ ...th, width: 34 }}><input type="checkbox" checked={allPageSelected} onChange={(e) => toggleAll(e.target.checked)} /></th>
            {visibleCols.admission_no && <th style={th}>ADM NO.</th>}
            {visibleCols.roll_no && <th style={th}>ROLL NO.</th>}
            {visibleCols.name && <th style={th}>NAME</th>}
            {visibleCols.class_name && <th style={th}>CLASS</th>}
            {visibleCols.section_name && <th style={th}>SECTION</th>}
            {visibleCols.fee_assigned && <th style={th}>TOTAL ASSIGNED</th>}
            {visibleCols.fee_due && <th style={th}>TOTAL DUE</th>}
            {visibleCols.status && <th style={th}>STATUS</th>}
            <th style={{ ...th, textAlign: 'right' }}>ACTIONS</th>
          </tr></thead>
          <tbody>
            {rows === null && <tr><td style={{ ...td, textAlign: 'center', color: MUTED2 }} colSpan={colCount}><Loader2 size={18} style={{ animation: 'spin .8s linear infinite' }} /></td></tr>}
            {rows && pageRows.length === 0 && <tr><td style={{ ...td, textAlign: 'center', color: MUTED2 }} colSpan={colCount}>No students found.</td></tr>}
            {pageRows.map((r) => (
              <tr key={r.id}>
                <td style={td}><input type="checkbox" checked={!!selected[r.id]} onChange={(e) => setSelected((p) => ({ ...p, [r.id]: e.target.checked }))} /></td>
                {visibleCols.admission_no && <td style={{ ...td, fontWeight: 700 }}>{r.admission_no}</td>}
                {visibleCols.roll_no && <td style={td}>{r.roll_no || '—'}</td>}
                {visibleCols.name && (
                  <td style={{ ...td, whiteSpace: 'normal' }}>
                    <button onClick={() => navigate(`/mgmt/students/${r.id}`)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: FONT, fontWeight: 700, color: BLUE, textAlign: 'left' }}>{fullName(r)}</button>
                  </td>
                )}
                {visibleCols.class_name && <td style={td}>{r.class_name || '—'}</td>}
                {visibleCols.section_name && <td style={td}>{r.section_name || '—'}</td>}
                {visibleCols.fee_assigned && <td style={td}>{naira(r.fee_assigned)}</td>}
                {visibleCols.fee_due && <td style={td}>{r.fee_due > 0 ? <span style={{ padding: '3px 10px', borderRadius: 999, background: `${RED}15`, color: RED, fontSize: 11.5, fontWeight: 800 }}>{naira(r.fee_due)}</span> : <span style={{ padding: '3px 10px', borderRadius: 999, background: `${GREEN}15`, color: GREEN, fontSize: 11.5, fontWeight: 800 }}>Paid</span>}</td>}
                {visibleCols.status && <td style={td}>{STATUS_PILL(r.status, { active: { c: GREEN }, inactive: { c: RED }, alumni: { c: BLUE } })}</td>}
                <td style={{ ...td, textAlign: 'right' }}>
                  {busyId === r.id ? <Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> : (
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button onClick={() => navigate(`/mgmt/students/${r.id}`)} title="View Profile" style={iconBtn(GREEN)}><Eye size={14} /></button>
                      <button onClick={() => navigate(`/mgmt/students/${r.id}?edit=1`)} title="Edit" style={iconBtn(BLUE)}><Pencil size={14} /></button>
                      <button onClick={() => remove(r)} title="Delete" style={iconBtn(RED)}><Trash2 size={14} /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows && filtered.length > 0 && pageSize > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 12, color: MUTED2, fontFamily: FONT }}>
            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, filtered.length)} of {filtered.length} entries
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={{ ...toolBtn(MUTED, page === 1) }}>Previous</button>
            <span style={{ fontSize: 12, color: INK, fontFamily: FONT, padding: '7px 10px' }}>{page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ ...toolBtn(MUTED, page === totalPages) }}>Next</button>
          </div>
        </div>
      )}

      {modal === 'bulk-edit' && <BulkEditModal count={selectedIds.length} classes={classes} sections={sections} onClose={() => setModal(null)} onSave={async (patch) => { try { await apiPost(`${BASE}/students/bulk-update`, { ids: selectedIds, ...patch }); showToast(`Updated ${selectedIds.length} student(s)`); setModal(null); load(); } catch (e) { showToast(e.message || 'Bulk update failed'); } }} />}

      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, maxWidth: '80vw' }}>{toast}</div>}
    </PageLayout>
  );
}

/* ── Modal shell ──────────────────────────────────────────────────────────── */
function ModalShell({ title, onClose, width = 460, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: width, maxHeight: '86vh', overflowY: 'auto', background: WHITE, borderRadius: 16, padding: '20px 22px', fontFamily: FONT }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: INK }}>{title}</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: MUTED2 }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── Bulk Edit (apply Class/Section/Status to selected students) ─────────── */
function BulkEditModal({ count, classes, sections, onClose, onSave }) {
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [status, setStatus] = useState('');
  const lbl = { fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT, display: 'block', margin: '10px 0 5px' };

  return (
    <ModalShell title={`Bulk Edit (${count} selected)`} onClose={onClose} width={420}>
      <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>Leave a field blank to keep it unchanged for the selected students.</p>
      <label style={lbl}>Class</label>
      <select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }} style={inputStyle}>
        <option value="">— leave unchanged —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <label style={lbl}>Section</label>
      <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={inputStyle}>
        <option value="">— leave unchanged —</option>{sections.filter((s) => !classId || s.class_id === classId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <label style={lbl}>Status</label>
      <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
        <option value="">— leave unchanged —</option>{STATUS_OPTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <button onClick={() => onSave({ class_id: classId, section_id: sectionId, status })} disabled={!classId && !sectionId && !status} style={{ width: '100%', marginTop: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: (!classId && !sectionId && !status) ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: (!classId && !sectionId && !status) ? '#9CA3AF' : WHITE, fontSize: 13.5, fontWeight: 800, cursor: (!classId && !sectionId && !status) ? 'default' : 'pointer', fontFamily: FONT }}>
        <CheckSquare size={14} /> Apply to {count} student(s)
      </button>
    </ModalShell>
  );
}

export function DisabledStudentsPage() {
  return <ResourcePage title="Disabled Students" subtitle="Students flagged with a disability" resource="students"
    columns={[...STUDENT_COLUMNS.slice(0, 4), { key: 'disability_note', label: 'Note' }]}
    fields={STUDENT_FIELDS} searchKeys={STUDENT_SEARCH}
    fixedFilters={{ is_disabled: 'true' }} canCreate={false} listFilters={[CLASS_FILTER]} />;
}

/* ── Student Attendance (register) ───────────────────────────────── */
const ATT_STATUSES = [
  { key: 'present', label: 'Present', c: GREEN },
  { key: 'absent', label: 'Absent', c: RED },
  { key: 'late', label: 'Late', c: AMBER },
  { key: 'excused', label: 'Excused', c: BLUE },
];

export function StudentAttendancePage() {
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [register, setRegister] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/sections`).then((r) => setSections(r.data || [])).catch(() => {});
  }, []);

  const loadRegister = async () => {
    if (!classId || !date) return showToast('Pick a class and date first');
    setLoading(true);
    try {
      const params = new URLSearchParams({ class_id: classId, date });
      if (sectionId) params.set('section_id', sectionId);
      const res = await apiGet(`${BASE}/attendance/register?${params}`);
      setRegister((res.data || []).map((s) => ({ ...s, status: s.status || 'present' })));
    } catch (e) { showToast(e.message || 'Could not load register'); }
    finally { setLoading(false); }
  };

  const saveMarks = async () => {
    setSaving(true);
    try {
      await apiPost(`${BASE}/attendance/mark`, { date, entries: register.map((s) => ({ student_id: s.id, status: s.status })) });
      showToast('Attendance saved ✓');
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  return (
    <PageLayout title="Student Attendance" subtitle="Mark the daily register">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18, alignItems: 'flex-end' }}>
        <div><label style={{ fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT, display: 'block', marginBottom: 5 }}>Class</label>
          <select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }} style={{ ...inputStyle, width: 160, cursor: 'pointer' }}>
            <option value="">— select —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <div><label style={{ fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT, display: 'block', marginBottom: 5 }}>Section</label>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ ...inputStyle, width: 140, cursor: 'pointer' }}>
            <option value="">All</option>{sections.filter((s) => s.class_id === classId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
        <div><label style={{ fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT, display: 'block', marginBottom: 5 }}>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: 160 }} /></div>
        <button onClick={loadRegister} style={{ padding: '10px 18px', borderRadius: 9, border: 'none', background: BLUE, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          {loading ? 'Loading…' : 'Load Register'}
        </button>
      </div>

      {register && (
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
          {register.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: MUTED2, fontSize: 13, fontFamily: FONT }}>No active students in that class/section.</div>
          ) : (
            <>
              {register.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: `1px solid ${BORDER}`, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: INK, fontFamily: FONT }}>{s.name}</span>
                    <span style={{ fontSize: 11, color: MUTED2, fontFamily: FONT, marginLeft: 8 }}>{s.admission_no}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {ATT_STATUSES.map((st) => (
                      <button key={st.key} onClick={() => setRegister((prev) => prev.map((r) => (r.id === s.id ? { ...r, status: st.key } : r)))}
                        style={{ padding: '6px 12px', borderRadius: 999, border: `1.5px solid ${s.status === st.key ? st.c : BORDER}`, background: s.status === st.key ? `${st.c}15` : WHITE, color: s.status === st.key ? st.c : MUTED2, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 16px', background: LIGHT }}>
                <button onClick={saveMarks} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 10, border: 'none', background: saving ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: saving ? '#9CA3AF' : WHITE, fontSize: 13, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>
                  {saving ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={14} />} {saving ? 'Saving…' : 'Save Attendance'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>}
    </PageLayout>
  );
}

/* ── Simple config pages ─────────────────────────────────────────── */
export function BehaviorRecordsPage() {
  return <ResourcePage title="Behavior Records" subtitle="Student behavior incidents" resource="behavior-records"
    columns={[
      { key: 'student_name', label: 'Student' }, { key: 'incident_type', label: 'Incident' },
      { key: 'severity', label: 'Severity', render: (r) => STATUS_PILL(r.severity, { low: { c: GREEN }, medium: { c: AMBER }, high: { c: RED } }) },
      { key: 'action_taken', label: 'Action Taken' }, { key: 'recorded_on', label: 'Date' },
    ]}
    fields={[
      { key: 'student_id', label: 'Student', type: 'select', required: true, optionsFrom: studentOpts },
      { key: 'incident_type', label: 'Incident Type', required: true, placeholder: 'e.g. Lateness' },
      { key: 'severity', label: 'Severity', type: 'select', default: 'low', options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }] },
      { key: 'recorded_on', label: 'Date', type: 'date' },
      { key: 'description', label: 'Description', type: 'textarea', full: true },
      { key: 'action_taken', label: 'Action Taken', type: 'textarea', full: true },
    ]} createLabel="New Incident" />;
}

export function StudentHousesPage() {
  return <ResourcePage title="Student Houses" subtitle="Sports/pastoral houses" resource="student-houses"
    columns={[
      { key: 'name', label: 'House' },
      { key: 'color', label: 'Color', render: (r) => r.color ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><span style={{ width: 14, height: 14, borderRadius: '50%', background: r.color, display: 'inline-block' }} />{r.color}</span> : '—' },
    ]}
    fields={[{ key: 'name', label: 'House Name', required: true }, { key: 'color', label: 'Color (hex)', placeholder: '#EF4444' }]}
    createLabel="New House" />;
}

export function StudentCategoriesPage() {
  return <ResourcePage title="Student Categories" subtitle="e.g. Day / Boarding" resource="student-categories"
    columns={[{ key: 'name', label: 'Category' }]}
    fields={[{ key: 'name', label: 'Category Name', required: true }]} createLabel="New Category" />;
}

export function HealthRecordsPage() {
  return <ResourcePage title="Health Records" subtitle="Allergies, conditions, vaccinations & checkups" resource="health-records"
    columns={[
      { key: 'student_name', label: 'Student' },
      { key: 'record_type', label: 'Type', render: (r) => STATUS_PILL(r.record_type, { allergy: { c: RED }, condition: { c: AMBER }, vaccination: { c: GREEN }, checkup: { c: BLUE } }) },
      { key: 'title', label: 'Title' }, { key: 'recorded_on', label: 'Date' },
    ]}
    fields={[
      { key: 'student_id', label: 'Student', type: 'select', required: true, optionsFrom: studentOpts },
      { key: 'record_type', label: 'Type', type: 'select', default: 'condition', options: [{ value: 'allergy', label: 'Allergy' }, { value: 'condition', label: 'Condition' }, { value: 'vaccination', label: 'Vaccination' }, { value: 'checkup', label: 'Checkup' }] },
      { key: 'title', label: 'Title', required: true },
      { key: 'recorded_on', label: 'Date', type: 'date' },
      { key: 'details', label: 'Details', type: 'textarea', full: true },
    ]} createLabel="New Record" />;
}

/* ── Assign to Class (bulk — includes students with no class yet) ──── */
export function AssignClassPage() {
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [filterClass, setFilterClass] = useState('__null__'); // default: unassigned
  const [toClass, setToClass] = useState('');
  const [toSection, setToSection] = useState('');
  const [students, setStudents] = useState(null);
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/sections`).then((r) => setSections(r.data || [])).catch(() => {});
  }, []);

  const load = () => {
    const cls = filterClass ? `&class_id=${filterClass}` : '';
    apiGet(`${BASE}/students?status=active${cls}`).then((r) => {
      setStudents(r.data || []);
      setSelected({});
    }).catch(() => setStudents([]));
  };
  useEffect(load, [filterClass]);

  const chosen = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  const allChecked = students?.length && chosen.length === students.length;

  const assign = async () => {
    if (!toClass) return showToast('Pick a target class');
    if (!chosen.length) return showToast('Select at least one student');
    setBusy(true);
    try {
      const res = await apiPost(`${BASE}/students/assign-class`, { to_class_id: toClass, section_id: toSection || undefined, student_ids: chosen });
      showToast(`Assigned ${res.assigned} student${res.assigned === 1 ? '' : 's'} ✓`);
      load();
    } catch (e) { showToast(e.message || 'Assignment failed'); }
    finally { setBusy(false); }
  };

  const disabled = busy || !chosen.length || !toClass;
  return (
    <PageLayout title="Assign to Class" subtitle="Bulk-place students into a class — including students without one">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18, alignItems: 'center' }}>
        <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} style={{ ...inputStyle, width: 190, cursor: 'pointer' }}>
          <option value="__null__">Unassigned students</option>
          <option value="">All students</option>
          {classes.map((c) => <option key={c.id} value={c.id}>In {c.name}</option>)}
        </select>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: MUTED2, fontFamily: FONT }}>→ assign to</span>
        <select value={toClass} onChange={(e) => { setToClass(e.target.value); setToSection(''); }} style={{ ...inputStyle, width: 170, cursor: 'pointer' }}>
          <option value="">Target class…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={toSection} onChange={(e) => setToSection(e.target.value)} style={{ ...inputStyle, width: 170, cursor: 'pointer' }}>
          <option value="">Section (optional)</option>
          {sections.filter((s) => s.class_id === toClass).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={assign} disabled={disabled} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 9, border: 'none', background: disabled ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: disabled ? '#9CA3AF' : WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          {busy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : null} Assign {chosen.length ? `(${chosen.length})` : ''}
        </button>
      </div>

      {students && (
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
          {students.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: MUTED2, fontSize: 13, fontFamily: FONT }}>
              {filterClass === '__null__' ? 'No unassigned students — everyone has a class. 🎉' : 'No active students matched.'}
            </div>
          ) : (<>
            <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: `1px solid ${BORDER}`, cursor: 'pointer', fontFamily: FONT, background: LIGHT }}>
              <input type="checkbox" checked={!!allChecked} onChange={(e) => setSelected(e.target.checked ? Object.fromEntries(students.map((s) => [s.id, true])) : {})} style={{ width: 15, height: 15, accentColor: AMBER }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: MUTED }}>Select all ({students.length})</span>
            </label>
            {students.map((s) => (
              <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: `1px solid ${BORDER}`, cursor: 'pointer', fontFamily: FONT }}>
                <input type="checkbox" checked={!!selected[s.id]} onChange={(e) => setSelected((p) => ({ ...p, [s.id]: e.target.checked }))} style={{ width: 15, height: 15, accentColor: AMBER }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{fullName(s)}</span>
                <span style={{ fontSize: 11, color: MUTED2 }}>{s.admission_no}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: s.class_name ? BLUE : MUTED2 }}>{s.class_name || 'No class'}</span>
              </label>
            ))}
          </>)}
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

/* ── Student Profile — dedicated page (view + inline edit) ──────────────── */
function InfoRow({ icon: Icon, label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0' }}>
      {Icon && <Icon size={14} color={MUTED2} style={{ marginTop: 2, flexShrink: 0 }} />}
      <div style={{ minWidth: 130, fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT }}>{label}</div>
      <div style={{ flex: 1, fontSize: 13, color: INK, fontFamily: FONT }}>{value ?? <span style={{ color: MUTED2 }}>—</span>}</div>
    </div>
  );
}
// Grid cell: small uppercase label above the value — used for the Profile
// tab's read-only sections, which lay out as a 2-column grid (not a stacked
// list), matching the reference design.
function GridInfo({ icon: Icon, label, value }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 800, color: MUTED2, textTransform: 'uppercase', letterSpacing: .4, marginBottom: 4, fontFamily: FONT }}>
        {Icon && <Icon size={11} />} {label}
      </div>
      <div style={{ fontSize: 13, color: INK, fontFamily: FONT, fontWeight: 600 }}>{value ?? <span style={{ color: MUTED2, fontWeight: 400 }}>N/A</span>}</div>
    </div>
  );
}
function InfoGrid({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '14px 18px' }}>{children}</div>;
}
function SectionCard({ title, color = BLUE, action, children }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '16px 18px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: INK, fontFamily: FONT, textTransform: 'uppercase', letterSpacing: .4 }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

const PROFILE_TABS = [
  { key: 'profile', label: 'Profile', icon: Users },
  { key: 'fees', label: 'Fees', icon: CreditCard },
  { key: 'documents', label: 'Documents', icon: FolderOpen },
  { key: 'credentials', label: 'Credentials', icon: Key },
  { key: 'health', label: 'Health', icon: HeartPulse },
  { key: 'exams', label: 'Exams', icon: ClipboardList },
  { key: 'attendance', label: 'Attendance', icon: ClipboardCheck },
  { key: 'behavior', label: 'Behavior', icon: ShieldAlert },
  { key: 'transport', label: 'Transport', icon: Bus },
];

export function StudentProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params] = [new URLSearchParams(window.location.search)];
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(PROFILE_TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'profile');
  const [editing, setEditing] = useState(params.get('edit') === '1');
  const [form, setForm] = useState({});
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [categories, setCategories] = useState([]);
  const [houses, setHouses] = useState([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(() => {
    apiGet(`${BASE}/students/${id}/profile`)
      .then((r) => { setData(r.data); setForm(r.data); })
      .catch((e) => showToast(e.message || 'Could not load student'))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/sections`).then((r) => setSections(r.data || [])).catch(() => {});
    apiGet(`${BASE}/student-categories`).then((r) => setCategories(r.data || [])).catch(() => {});
    apiGet(`${BASE}/student-houses`).then((r) => setHouses(r.data || [])).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setSaving(true);
    try {
      const patch = {};
      for (const f of STUDENT_FIELDS) if (form[f.key] !== undefined) patch[f.key] = form[f.key] === '' ? null : form[f.key];
      const EXTRA_KEYS = ['biometric_id','place_of_birth','nationality','religion','caste','sub_caste','mother_tongue','quota',
        'student_email','student_phone','aadhaar_no','pen_no','father_name','father_phone','father_occupation','father_qualification','father_income','father_aadhaar',
        'mother_name','mother_phone','mother_occupation','mother_qualification','mother_aadhaar','emergency_name','emergency_phone',
        'height_cm','weight_kg','medical_history','bank_name','bank_account_no','bank_ifsc','permanent_address','previous_school','extra_fields'];
      for (const k of EXTRA_KEYS) if (form[k] !== undefined) patch[k] = form[k] === '' ? null : form[k];
      await apiPut(`${BASE}/students/${id}`, patch);
      showToast('Saved ✓'); setEditing(false); load();
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  if (loading) return <PageLayout title="Student Profile" subtitle=""><div style={{ padding: '60px 0', textAlign: 'center', color: MUTED2 }}><Loader2 size={22} style={{ animation: 'spin .8s linear infinite' }} /></div></PageLayout>;
  if (!data) return <PageLayout title="Student Profile" subtitle=""><div style={{ padding: '40px', textAlign: 'center', color: MUTED2, fontFamily: FONT }}>Student not found.</div></PageLayout>;

  const statCard = (label, value, color) => (
    <div style={{ flex: '1 1 140px', background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: FONT }}>{value}</div>
      <div style={{ fontSize: 11, color: MUTED2, fontFamily: FONT, marginTop: 2 }}>{label}</div>
    </div>
  );

  return (
    <PageLayout title={fullName(data)} subtitle={`Admission No: ${data.admission_no}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/mgmt/students')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
          <ArrowLeft size={14} /> Back to Student List
        </button>
        {tab === 'profile' && (editing ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setEditing(false); setForm(data); }} style={{ padding: '9px 16px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 9, border: 'none', background: saving ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: saving ? '#9CA3AF' : WHITE, fontSize: 12.5, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>
              {saving ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={14} />} Save Changes
            </button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
            <Pencil size={14} /> Edit Profile
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        {statCard('Total Fees', naira(data.fees?.assigned), INK)}
        {statCard('Amount Paid', naira(data.fees?.paid), GREEN)}
        {statCard('Balance Due', naira(data.fees?.due), data.fees?.due > 0 ? RED : GREEN)}
        {statCard('Attendance (Present)', data.attendance?.total ? `${Math.round((data.attendance.present / data.attendance.total) * 100)}%` : '—', BLUE)}
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left: photo + quick facts (constant across tabs) */}
        <div style={{ flex: '1 1 240px', maxWidth: 280 }}>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '22px 18px', textAlign: 'center' }}>
            <div style={{ width: 88, height: 88, borderRadius: '50%', margin: '0 auto 12px', overflow: 'hidden', background: LIGHT, border: `3px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {data.photo_url ? <img src={data.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Users size={34} color={MUTED2} />}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: INK, fontFamily: FONT }}>{fullName(data)}</div>
            <div style={{ display: 'inline-block', marginTop: 6, padding: '3px 12px', borderRadius: 999, background: `${AMBER}15`, color: AMBER, fontSize: 11.5, fontWeight: 800, fontFamily: FONT }}>{data.class_name || 'No class'}{data.section_name ? ` — ${data.section_name}` : ''}</div>
            <div style={{ marginTop: 14, textAlign: 'left' }}>
              <InfoRow icon={CreditCard} label="Admission No" value={data.admission_no} />
              <InfoRow icon={CircleDot} label="Roll No" value={data.roll_no} />
              <InfoRow icon={Droplet} label="Blood Group" value={data.blood_group} />
              <InfoRow icon={ShieldCheck} label="Status" value={STATUS_PILL(data.status, { active: { c: GREEN }, inactive: { c: RED }, alumni: { c: BLUE } })} />
            </div>
          </div>
        </div>

        {/* Right: tab bar + tab content */}
        <div style={{ flex: '2 1 420px', minWidth: 320 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: `1px solid ${BORDER}`, marginBottom: 16 }}>
            {PROFILE_TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 13px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: FONT,
                fontSize: 12.5, fontWeight: 700, color: tab === t.key ? AMBER : MUTED2, borderBottom: `2px solid ${tab === t.key ? AMBER : 'transparent'}`, marginBottom: -1,
              }}>
                <t.icon size={13} /> {t.label}
              </button>
            ))}
          </div>

          {tab === 'profile' && <ProfileTab data={data} editing={editing} form={form} set={set} classes={classes} sections={sections} categories={categories} houses={houses} />}
          {tab === 'fees' && <FeesTab studentId={id} showToast={showToast} />}
          {tab === 'documents' && <DocumentsTab studentId={id} showToast={showToast} />}
          {tab === 'credentials' && <CredentialsTab studentId={id} data={data} onChanged={load} showToast={showToast} />}
          {tab === 'health' && <HealthTab studentId={id} showToast={showToast} />}
          {tab === 'exams' && <ExamsTab studentId={id} showToast={showToast} />}
          {tab === 'attendance' && <AttendanceTab studentId={id} showToast={showToast} />}
          {tab === 'behavior' && <BehaviorTab studentId={id} showToast={showToast} />}
          {tab === 'transport' && <TransportTab studentId={id} showToast={showToast} />}
        </div>
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, maxWidth: '80vw' }}>{toast}</div>}
    </PageLayout>
  );
}

/* ── Profile tab (view + inline edit) ────────────────────────────────────── */
function ProfileTab({ data, editing, form, set, classes, sections, categories, houses }) {
  const lbl = { fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT, display: 'block', marginBottom: 5 };
  const editSel = (key, options, labelKey = 'name') => (
    <select value={form[key] || ''} onChange={set(key)} style={{ ...inputStyle, marginBottom: 8 }}>
      <option value="">— none —</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o[labelKey]}</option>)}
    </select>
  );
  const extra = Array.isArray(data.extra_fields) ? data.extra_fields : [];
  const formExtra = Array.isArray(form.extra_fields) ? form.extra_fields : extra;
  const setExtra = (i, patch) => set('extra_fields')({ target: { value: formExtra.map((f, j) => j === i ? { ...f, ...patch } : f) } });
  const addExtra = () => set('extra_fields')({ target: { value: [...formExtra, { label: '', value: '' }] } });
  const delExtra = (i) => set('extra_fields')({ target: { value: formExtra.filter((_, j) => j !== i) } });

  const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();
  const parentCard = (title, color, initialSrc, fields) => (
    <div style={{ flex: '1 1 240px', minWidth: 220, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: `${color}18`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, fontFamily: FONT }}>{initial(initialSrc)}</div>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: INK, fontFamily: FONT }}>{title}</span>
      </div>
      <InfoGrid>{fields.map(([label, value]) => <GridInfo key={label} label={label} value={value} />)}</InfoGrid>
    </div>
  );

  if (!editing) return (
    <>
      <SectionCard title="Academic Information" color={BLUE}>
        <InfoGrid>
          <GridInfo label="Admission No" value={data.admission_no} />
          <GridInfo label="Admission Date" value={data.admitted_on} />
          <GridInfo label="Biometric ID" value={data.biometric_id} />
          <GridInfo label="Roll Number" value={data.roll_no} />
          <GridInfo label="House" value={data.house_name} />
          <GridInfo label="Category" value={data.category_name} />
        </InfoGrid>
      </SectionCard>
      <SectionCard title="Personal Details" color={PURPLE}>
        <InfoGrid>
          <GridInfo icon={Cake} label="Date of Birth" value={data.dob} />
          <GridInfo label="Place of Birth" value={data.place_of_birth} />
          <GridInfo label="Gender" value={data.gender} />
          <GridInfo label="Nationality" value={data.nationality} />
          <GridInfo label="Religion" value={data.religion} />
          <GridInfo label="Caste" value={data.caste} />
          <GridInfo label="Sub-Caste" value={data.sub_caste} />
          <GridInfo label="Mother Tongue" value={data.mother_tongue} />
          <GridInfo icon={Droplet} label="Blood Group" value={data.blood_group} />
          <GridInfo label="Quotas" value={data.quota} />
          <GridInfo icon={ShieldAlert} label="Disability" value={data.is_disabled ? (data.disability_note || 'Yes') : 'None'} />
        </InfoGrid>
      </SectionCard>
      <SectionCard title="Contact & Identity" color={GREEN}>
        <InfoGrid>
          <GridInfo icon={Mail} label="Student Email" value={data.student_email} />
          <GridInfo icon={Phone} label="Student Phone" value={data.student_phone} />
          <GridInfo label="Aadhaar / NID" value={data.aadhaar_no} />
          <GridInfo label="PEN / SSSM ID" value={data.pen_no} />
        </InfoGrid>
      </SectionCard>
      <SectionCard title="Parent & Guardian Details" color={AMBER}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
          {parentCard('Father Details', BLUE, data.father_name, [
            ['Name', data.father_name], ['Phone', data.father_phone], ['Occupation', data.father_occupation],
            ['Qualification', data.father_qualification], ['Income', data.father_income], ['Aadhaar', data.father_aadhaar],
          ])}
          {parentCard('Mother Details', PURPLE, data.mother_name, [
            ['Name', data.mother_name], ['Phone', data.mother_phone], ['Occupation', data.mother_occupation],
            ['Qualification', data.mother_qualification], ['Aadhaar', data.mother_aadhaar],
          ])}
        </div>
        <InfoGrid>
          <GridInfo label="Guardian" value={data.guardian_name ? `${data.guardian_name} (${data.guardian_phone || ''})` : null} />
          <GridInfo label="Emergency" value={data.emergency_name ? `${data.emergency_name} (${data.emergency_phone || ''})` : null} />
        </InfoGrid>
      </SectionCard>
      <SectionCard title="Health & Medical" color={RED}>
        <InfoGrid>
          <GridInfo label="Height" value={data.height_cm ? `${data.height_cm} cm` : null} />
          <GridInfo label="Weight" value={data.weight_kg ? `${data.weight_kg} kg` : null} />
          <GridInfo label="Medical History" value={data.medical_history} />
        </InfoGrid>
      </SectionCard>
      <SectionCard title="Bank Details" color={BLUE}>
        <InfoGrid>
          <GridInfo label="Bank Name" value={data.bank_name} />
          <GridInfo label="Account No" value={data.bank_account_no} />
          <GridInfo label="IFSC Code" value={data.bank_ifsc} />
        </InfoGrid>
      </SectionCard>
      <SectionCard title="Address" color={PURPLE}>
        <InfoGrid>
          <GridInfo label="Current" value={data.address} />
          <GridInfo label="Permanent" value={data.permanent_address} />
        </InfoGrid>
      </SectionCard>
      <SectionCard title="Previous School" color={AMBER}>
        <GridInfo label="Details" value={data.previous_school || 'NO DATA'} />
      </SectionCard>
      {extra.length > 0 && (
        <SectionCard title="Additional Information" color={GREEN}>
          <InfoGrid>{extra.map((f, i) => <GridInfo key={i} label={f.label} value={f.value} />)}</InfoGrid>
        </SectionCard>
      )}
    </>
  );

  return (
    <>
      <SectionCard title="Academic Information" color={BLUE}>
        <label style={lbl}>Class</label>{editSel('class_id', classes)}
        <label style={lbl}>Section</label>{editSel('section_id', sections.filter((s) => !form.class_id || s.class_id === form.class_id))}
        <label style={lbl}>Category</label>{editSel('category_id', categories)}
        <label style={lbl}>House</label>{editSel('house_id', houses)}
        <label style={lbl}>Admitted On</label><input type="date" value={form.admitted_on || ''} onChange={set('admitted_on')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Biometric ID</label><input value={form.biometric_id || ''} onChange={set('biometric_id')} style={inputStyle} />
      </SectionCard>
      <SectionCard title="Personal Details" color={PURPLE}>
        <label style={lbl}>First Name</label><input value={form.first_name || ''} onChange={set('first_name')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Last Name</label><input value={form.last_name || ''} onChange={set('last_name')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Date of Birth</label><input type="date" value={form.dob || ''} onChange={set('dob')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Place of Birth</label><input value={form.place_of_birth || ''} onChange={set('place_of_birth')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Gender</label>
        <select value={form.gender || ''} onChange={set('gender')} style={{ ...inputStyle, marginBottom: 8 }}>
          <option value="">— select —</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
        </select>
        <label style={lbl}>Nationality</label><input value={form.nationality || ''} onChange={set('nationality')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Religion</label><input value={form.religion || ''} onChange={set('religion')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Caste</label><input value={form.caste || ''} onChange={set('caste')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Sub-Caste</label><input value={form.sub_caste || ''} onChange={set('sub_caste')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Mother Tongue</label><input value={form.mother_tongue || ''} onChange={set('mother_tongue')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Blood Group</label><input value={form.blood_group || ''} onChange={set('blood_group')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Quota</label><input value={form.quota || ''} onChange={set('quota')} style={inputStyle} />
      </SectionCard>
      <SectionCard title="Contact & Identity" color={GREEN}>
        <label style={lbl}>Student Email</label><input value={form.student_email || ''} onChange={set('student_email')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Student Phone</label><input value={form.student_phone || ''} onChange={set('student_phone')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Aadhaar / NID</label><input value={form.aadhaar_no || ''} onChange={set('aadhaar_no')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>PEN / SSSM ID</label><input value={form.pen_no || ''} onChange={set('pen_no')} style={inputStyle} />
      </SectionCard>
      <SectionCard title="Parent & Guardian Details" color={AMBER}>
        <div style={{ fontSize: 12, fontWeight: 800, color: INK, marginBottom: 6 }}>Father Details</div>
        <label style={lbl}>Name</label><input value={form.father_name || ''} onChange={set('father_name')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Phone</label><input value={form.father_phone || ''} onChange={set('father_phone')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Occupation</label><input value={form.father_occupation || ''} onChange={set('father_occupation')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Qualification</label><input value={form.father_qualification || ''} onChange={set('father_qualification')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Income</label><input value={form.father_income || ''} onChange={set('father_income')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Aadhaar</label><input value={form.father_aadhaar || ''} onChange={set('father_aadhaar')} style={{ ...inputStyle, marginBottom: 8 }} />
        <div style={{ fontSize: 12, fontWeight: 800, color: INK, margin: '10px 0 6px' }}>Mother Details</div>
        <label style={lbl}>Name</label><input value={form.mother_name || ''} onChange={set('mother_name')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Phone</label><input value={form.mother_phone || ''} onChange={set('mother_phone')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Occupation</label><input value={form.mother_occupation || ''} onChange={set('mother_occupation')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Qualification</label><input value={form.mother_qualification || ''} onChange={set('mother_qualification')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Aadhaar</label><input value={form.mother_aadhaar || ''} onChange={set('mother_aadhaar')} style={{ ...inputStyle, marginBottom: 8 }} />
        <div style={{ fontSize: 12, fontWeight: 800, color: INK, margin: '10px 0 6px' }}>Guardian &amp; Emergency</div>
        <label style={lbl}>Guardian Name</label><input value={form.guardian_name || ''} onChange={set('guardian_name')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Guardian Phone</label><input value={form.guardian_phone || ''} onChange={set('guardian_phone')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Guardian Email</label><input value={form.guardian_email || ''} onChange={set('guardian_email')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Emergency Contact Name</label><input value={form.emergency_name || ''} onChange={set('emergency_name')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Emergency Contact Phone</label><input value={form.emergency_phone || ''} onChange={set('emergency_phone')} style={inputStyle} />
      </SectionCard>
      <SectionCard title="Health & Medical" color={RED}>
        <label style={lbl}>Height (cm)</label><input type="number" value={form.height_cm || ''} onChange={set('height_cm')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Weight (kg)</label><input type="number" value={form.weight_kg || ''} onChange={set('weight_kg')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Medical History</label><textarea value={form.medical_history || ''} onChange={set('medical_history')} style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} />
      </SectionCard>
      <SectionCard title="Bank Details" color={BLUE}>
        <label style={lbl}>Bank Name</label><input value={form.bank_name || ''} onChange={set('bank_name')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Account No</label><input value={form.bank_account_no || ''} onChange={set('bank_account_no')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>IFSC Code</label><input value={form.bank_ifsc || ''} onChange={set('bank_ifsc')} style={inputStyle} />
      </SectionCard>
      <SectionCard title="Address" color={PURPLE}>
        <label style={lbl}>Current Address</label><textarea value={form.address || ''} onChange={set('address')} style={{ ...inputStyle, minHeight: 60, resize: 'vertical', marginBottom: 8 }} />
        <label style={lbl}>Permanent Address</label><textarea value={form.permanent_address || ''} onChange={set('permanent_address')} style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} />
      </SectionCard>
      <SectionCard title="Previous School" color={AMBER}>
        <textarea value={form.previous_school || ''} onChange={set('previous_school')} style={{ ...inputStyle, minHeight: 50, resize: 'vertical' }} />
      </SectionCard>
      <SectionCard title="Additional Information" color={GREEN}>
        {formExtra.map((f, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input value={f.label} onChange={(e) => setExtra(i, { label: e.target.value })} placeholder="Field name" style={{ ...inputStyle, flex: 1 }} />
            <input value={f.value} onChange={(e) => setExtra(i, { value: e.target.value })} placeholder="Value" style={{ ...inputStyle, flex: 1 }} />
            <button onClick={() => delExtra(i)} style={{ border: 'none', background: `${RED}12`, color: RED, borderRadius: 7, width: 32, cursor: 'pointer' }}><Trash2 size={12} /></button>
          </div>
        ))}
        <button onClick={addExtra} style={{ border: `1px dashed ${BORDER}`, background: WHITE, color: MUTED, borderRadius: 8, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>+ Add Field</button>
      </SectionCard>
    </>
  );
}

/* ── Fees tab ─────────────────────────────────────────────────────────────── */
// A small ring/donut stat, built with conic-gradient (no chart library).
function Ring({ percent, label, color = GREEN, size = 96 }) {
  const p = Math.max(0, Math.min(100, percent || 0));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: size, height: size, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `conic-gradient(${color} ${p * 3.6}deg, ${BORDER} 0deg)`,
      }}>
        <div style={{ width: size - 18, height: size - 18, borderRadius: '50%', background: WHITE, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: INK, fontFamily: FONT }}>{p}%</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: MUTED2, fontFamily: FONT, textTransform: 'uppercase' }}>{label}</span>
        </div>
      </div>
    </div>
  );
}
const statPill = (label, value, color) => (
  <div style={{ flex: '1 1 110px', background: `${color}12`, border: `1px solid ${color}33`, borderRadius: 10, padding: '10px 12px' }}>
    <div style={{ fontSize: 15, fontWeight: 800, color, fontFamily: FONT }}>{value}</div>
    <div style={{ fontSize: 10, color: MUTED, fontFamily: FONT, textTransform: 'uppercase', letterSpacing: .3, marginTop: 2 }}>{label}</div>
  </div>
);
const FEE_STATUS_COLOR = { paid: GREEN, partial: AMBER, unpaid: RED };

function FeesTab({ studentId, showToast }) {
  const [data, setData] = useState(null);
  const [openGroups, setOpenGroups] = useState({});
  useEffect(() => { apiGet(`${BASE}/students/${studentId}/fees`).then((r) => { setData(r.data); setOpenGroups(Object.fromEntries((r.data.groups || []).map((g, i) => [i, true]))); }).catch(() => showToast('Could not load fees')); }, [studentId]);
  if (!data) return <SectionCard title="Fees" color={BLUE}><Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /></SectionCard>;

  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 10.5, fontWeight: 800, color: MUTED2 };
  const td = { padding: '8px 10px', fontSize: 12.5, color: INK, borderTop: `1px solid ${BORDER}` };
  const toggle = (i) => setOpenGroups((p) => ({ ...p, [i]: !p[i] }));

  return (
    <SectionCard title="Fees" color={BLUE}>
      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <Ring percent={data.percentCollected} label="Collected" color={GREEN} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1, minWidth: 260 }}>
          {statPill('Assigned', naira(data.assigned), BLUE)}
          {statPill('Collected', naira(data.collected), GREEN)}
          {statPill('Concession', naira(data.concession), AMBER)}
          {statPill('Fine', naira(data.fine), PURPLE)}
          {statPill('Balance', naira(data.balance), RED)}
        </div>
      </div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: MUTED, fontFamily: FONT, marginBottom: 5 }}>
          <span>Payment Progress</span><span>{data.percentCollected}% Complete</span>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: BORDER, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${data.percentCollected}%`, background: GREEN, borderRadius: 999 }} />
        </div>
      </div>

      {data.groups.length === 0 ? <p style={{ fontSize: 12.5, color: MUTED2 }}>No fees assigned yet.</p> : data.groups.map((g, i) => (
        <div key={i} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
          <button onClick={() => toggle(i)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: LIGHT, border: 'none', cursor: 'pointer', fontFamily: FONT, textAlign: 'left' }}>
            {openGroups[i] ? <ChevronUp size={14} color={MUTED2} /> : <ChevronDown size={14} color={MUTED2} />}
            <span style={{ fontSize: 12.5, fontWeight: 800, color: INK, flex: 1 }}>{g.title}</span>
            {g.unpaidCount > 0 && <span style={{ padding: '2px 9px', borderRadius: 999, background: `${RED}15`, color: RED, fontSize: 10.5, fontWeight: 800 }}>{g.unpaidCount} Unpaid</span>}
            <span style={{ fontSize: 11.5, color: MUTED2 }}>Total: {naira(g.total)} · Due: {naira(g.due)}</span>
          </button>
          {openGroups[i] && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Fee Type</th><th style={th}>Due Date</th><th style={th}>Amount</th><th style={th}>Paid</th><th style={th}>Due</th><th style={th}>Status</th></tr></thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{r.fee_type_name}</td><td style={td}>{r.due_date || '—'}</td><td style={td}>{naira(r.amount)}</td>
                    <td style={{ ...td, color: GREEN }}>{naira(r.paid)}</td><td style={{ ...td, color: r.due > 0 ? RED : GREEN }}>{naira(r.due)}</td>
                    <td style={td}><span style={{ padding: '2px 9px', borderRadius: 999, background: `${FEE_STATUS_COLOR[r.status]}15`, color: FEE_STATUS_COLOR[r.status], fontSize: 10.5, fontWeight: 800, textTransform: 'capitalize' }}>{r.status}</span></td>
                  </tr>
                ))}
                <tr><td style={{ ...td, fontWeight: 800 }}>Sub-Total ({g.rows.length} items)</td><td style={td} /><td style={{ ...td, fontWeight: 800 }}>{naira(g.total)}</td><td style={td} /><td style={{ ...td, fontWeight: 800 }}>{naira(g.due)}</td><td style={td} /></tr>
              </tbody>
            </table>
          )}
        </div>
      ))}
    </SectionCard>
  );
}

/* ── Documents tab ────────────────────────────────────────────────────────── */
function DocumentsTab({ studentId, showToast }) {
  const [docs, setDocs] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => apiGet(`${BASE}/student-documents?student_id=${studentId}`).then((r) => setDocs(r.data || [])).catch(() => setDocs([])), [studentId]);
  useEffect(() => { load(); }, [load]);

  const upload = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('files', f));
      const r = await fetch(`${API}${BASE}/students/${studentId}/documents/upload`, { method: 'POST', credentials: 'include', body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      showToast('Uploaded ✓'); load();
    } catch (e) { showToast(e.message || 'Upload failed'); }
    finally { setBusy(false); }
  };
  const remove = async (d) => { if (!window.confirm(`Delete "${d.title}"?`)) return; try { await apiDelete(`${BASE}/student-documents/${d.id}`); load(); } catch (e) { showToast(e.message); } };

  return (
    <SectionCard title="Documents" color={GREEN}>
      <div style={{ marginBottom: 12 }}>
        <input type="file" multiple onChange={(e) => upload(e.target.files)} disabled={busy} />
      </div>
      {docs === null ? <Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /> : docs.length === 0 ? <p style={{ fontSize: 12.5, color: MUTED2 }}>No documents uploaded yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {docs.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: `1px solid ${BORDER}`, borderRadius: 8 }}>
              <FolderOpen size={14} color={MUTED2} />
              <a href={d.url} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: 12.5, color: BLUE, fontFamily: FONT, textDecoration: 'none', fontWeight: 700 }}>{d.title}</a>
              <span style={{ fontSize: 11, color: MUTED2 }}>{d.uploaded_at?.slice(0, 10)}</span>
              <button onClick={() => remove(d)} style={{ border: 'none', background: `${RED}12`, color: RED, borderRadius: 7, width: 26, height: 26, cursor: 'pointer' }}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/* ── Credentials tab ─────────────────────────────────────────────────────── */
function CredentialsTab({ studentId, data, onChanged, showToast }) {
  const [busy, setBusy] = useState(null);
  const [revealed, setRevealed] = useState({});

  const regenerate = async (target) => {
    setBusy(target);
    try {
      const r = await apiPost(`${BASE}/students/${studentId}/credentials/regenerate`, { target });
      setRevealed((p) => ({ ...p, [target]: { username: r.username, password: r.password } }));
      onChanged();
    } catch (e) { showToast(e.message || 'Could not regenerate'); }
    finally { setBusy(null); }
  };

  const block = (target, title, username, has) => (
    <SectionCard title={title} color={target === 'student' ? BLUE : PURPLE}>
      <InfoRow icon={Key} label="Username" value={revealed[target]?.username || username || '—'} />
      {revealed[target] ? (
        <div style={{ background: `${GREEN}10`, border: `1px solid ${GREEN}44`, borderRadius: 8, padding: '10px 12px', marginTop: 8, fontFamily: FONT }}>
          <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 4 }}>New password (shown once — copy it now):</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: INK, letterSpacing: 1 }}>{revealed[target].password}</div>
        </div>
      ) : (
        <p style={{ fontSize: 11.5, color: MUTED2, fontStyle: 'italic', margin: '6px 0 0' }}>
          {has ? 'Password is not stored for security.' : 'No password set yet.'} Click Regenerate to set a new one.
        </p>
      )}
      <button onClick={() => regenerate(target)} disabled={busy === target} style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 9, border: 'none', background: busy === target ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: busy === target ? '#9CA3AF' : WHITE, fontSize: 12, fontWeight: 800, cursor: busy === target ? 'default' : 'pointer', fontFamily: FONT }}>
        {busy === target ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <RefreshCw size={13} />} Regenerate
      </button>
    </SectionCard>
  );

  return (
    <>
      <p style={{ fontSize: 12.5, color: MUTED, marginBottom: 14, fontFamily: FONT }}>
        Portal login credentials. Admins can share these with the student/parent and regenerate them if lost.
      </p>
      {block('student', 'Student Login', data.student_username, data.hasStudentPassword)}
      {block('parent', 'Parent Login', data.parent_username, data.hasParentPassword)}
    </>
  );
}

/* ── Health tab ───────────────────────────────────────────────────────────── */
function HealthTab({ studentId, showToast }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const load = useCallback(() => apiGet(`${BASE}/health-records?student_id=${studentId}`).then((r) => setRows(r.data || [])).catch(() => setRows([])), [studentId]);
  useEffect(() => { load(); }, [load]);
  const remove = async (r) => { if (!window.confirm(`Delete "${r.title}"?`)) return; try { await apiDelete(`${BASE}/health-records/${r.id}`); load(); } catch (e) { showToast(e.message); } };
  return (
    <SectionCard title="Health Records" color={RED} action={
      <button onClick={() => navigate(`/mgmt/students/${studentId}/health/new`)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
        <Plus size={13} /> Add Record
      </button>
    }>
      {rows === null ? <Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /> : rows.length === 0 ? <p style={{ fontSize: 12.5, color: MUTED2 }}>No health records yet.</p> : (
        rows.map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: `1px solid ${BORDER}` }}>
            <HeartPulse size={14} color={RED} />
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 12.5 }}>{r.title}</b>
              <div style={{ fontSize: 11, color: MUTED2 }}>{r.record_type} · {r.recorded_on}</div>
              {r.details && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>{r.details}</div>}
            </div>
            <button onClick={() => remove(r)} style={{ border: 'none', background: `${RED}12`, color: RED, borderRadius: 7, width: 26, height: 26, cursor: 'pointer' }}><Trash2 size={12} /></button>
          </div>
        ))
      )}
    </SectionCard>
  );
}

/* ── Exams tab ────────────────────────────────────────────────────────────── */
function ExamsTab({ studentId, showToast }) {
  const [data, setData] = useState(null);
  const [openExam, setOpenExam] = useState(null);
  const [marksheet, setMarksheet] = useState(null);
  useEffect(() => { apiGet(`${BASE}/students/${studentId}/exams`).then((r) => setData(r.data)).catch(() => setData({ exams: [], uploads: [] })); }, [studentId]);

  const view = async (exam) => {
    setOpenExam(exam.id); setMarksheet(null);
    try { const r = await apiGet(`${BASE}/students/${studentId}/exams/${exam.id}`); setMarksheet(r.data); } catch (e) { showToast(e.message); }
  };

  if (!data) return <SectionCard title="Report Cards & Marksheets" color={PURPLE}><Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /></SectionCard>;
  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 10.5, fontWeight: 800, color: MUTED2 };
  const td = { padding: '8px 10px', fontSize: 12.5, color: INK, borderTop: `1px solid ${BORDER}` };
  return (
    <SectionCard title="Report Cards & Marksheets" color={PURPLE}>
      {data.exams.length === 0 && data.uploads.length === 0 ? <p style={{ fontSize: 12.5, color: MUTED2 }}>No exam results yet.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
          <thead><tr><th style={th}>Title</th><th style={th}>Type</th><th style={th}>Action</th></tr></thead>
          <tbody>
            {data.exams.map((e) => (
              <tr key={e.id}><td style={td}>{e.name}</td><td style={td}>System</td>
                <td style={td}><button onClick={() => view(e)} style={{ border: 'none', background: `${BLUE}12`, color: BLUE, borderRadius: 7, padding: '5px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>View</button></td></tr>
            ))}
            {data.uploads.map((u) => (
              <tr key={u.id}><td style={td}>{u.title}</td><td style={td}>Upload</td>
                <td style={td}>{u.file_url ? <a href={u.file_url} target="_blank" rel="noreferrer" style={{ color: BLUE, fontSize: 11.5, fontWeight: 700 }}>Open</a> : '—'}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {openExam && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 14 }}>
          {!marksheet ? <Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /> : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Subject</th><th style={th}>Score</th><th style={th}>Max</th><th style={th}>Result</th></tr></thead>
                <tbody>{marksheet.subjects.map((s, i) => <tr key={i}><td style={td}>{s.subject}</td><td style={td}>{s.score ?? '—'}</td><td style={td}>{s.max}</td><td style={td}>{s.pass === null ? '—' : s.pass ? <span style={{ color: GREEN, fontWeight: 800 }}>Pass</span> : <span style={{ color: RED, fontWeight: 800 }}>Fail</span>}</td></tr>)}</tbody>
              </table>
              <div style={{ marginTop: 8, fontSize: 12.5, fontFamily: FONT }}><b>Total:</b> {marksheet.total}/{marksheet.maxTotal} ({marksheet.percent}%)</div>
              {marksheet.remark && <div style={{ marginTop: 6, fontSize: 12, color: MUTED, fontFamily: FONT }}><b>Remark:</b> {marksheet.remark}</div>}
            </>
          )}
        </div>
      )}
    </SectionCard>
  );
}

/* ── Attendance tab (month calendar) ─────────────────────────────────────── */
function AttendanceTab({ studentId, showToast }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);
  useEffect(() => { apiGet(`${BASE}/students/${studentId}/attendance?month=${month}`).then((r) => setData(r.data)).catch(() => showToast('Could not load attendance')); }, [studentId, month]);

  const shiftMonth = (delta) => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); };
  const STATUS_COLOR = { present: GREEN, absent: RED, late: AMBER, excused: BLUE };
  const STATUS_LABEL = { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Half Day' };
  const [y, m] = month.split('-').map(Number);
  const firstDay = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const presentPct = data?.stats?.total ? Math.round((data.stats.present / (data.stats.present + data.stats.absent + data.stats.late + data.stats.excused || 1)) * 100) : 0;

  return (
    <SectionCard title="Attendance" color={BLUE}>
      {data && (
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          <Ring percent={presentPct} label="Present" color={GREEN} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1, minWidth: 220 }}>
            {statPill('Present', data.stats.present, GREEN)}
            {statPill('Absent', data.stats.absent, RED)}
            {statPill('Late', data.stats.late, AMBER)}
            {statPill('Half Day', data.stats.excused, BLUE)}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button onClick={() => shiftMonth(-1)} style={{ border: 'none', background: LIGHT, borderRadius: 7, width: 30, height: 30, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronLeft size={15} /></button>
        <b style={{ fontFamily: FONT, fontSize: 13 }}>{new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</b>
        <button onClick={() => shiftMonth(1)} style={{ border: 'none', background: LIGHT, borderRadius: 7, width: 30, height: 30, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronRight size={15} /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, fontFamily: FONT }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} style={{ fontSize: 10.5, fontWeight: 800, color: MUTED2, textAlign: 'center', padding: 4 }}>{d}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const date = `${month}-${String(day).padStart(2, '0')}`;
          const status = data?.records?.[date]?.status;
          return (
            <div key={i} style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, fontSize: 12, fontWeight: 700, background: status ? `${STATUS_COLOR[status]}18` : LIGHT, color: status ? STATUS_COLOR[status] : MUTED2 }}>
              {day}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
        {Object.entries(STATUS_COLOR).map(([k, c]) => (
          <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: MUTED, fontFamily: FONT }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: c }} /> {STATUS_LABEL[k]}
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: MUTED, fontFamily: FONT }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: LIGHT, border: `1px solid ${BORDER}` }} /> No Record
        </span>
      </div>
    </SectionCard>
  );
}

/* ── Behavior tab ─────────────────────────────────────────────────────────── */
function BehaviorTab({ studentId, showToast }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  useEffect(() => { apiGet(`${BASE}/students/${studentId}/behavior-summary`).then((r) => setData(r.data)).catch(() => showToast('Could not load behavior summary')); }, [studentId]);
  const SEVERITY_COLOR = { low: GREEN, medium: AMBER, high: RED };

  if (!data) return <SectionCard title="Behavior" color={AMBER}><Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /></SectionCard>;
  const scoreColor = data.score > 0 ? GREEN : data.score < 0 ? RED : MUTED2;

  return (
    <SectionCard title="Behavior" color={AMBER} action={
      <button onClick={() => navigate(`/mgmt/students/${studentId}/behavior/new`)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
        <Plus size={13} /> Add Record
      </button>
    }>
      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 96, height: 96, borderRadius: '50%', border: `3px solid ${scoreColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: scoreColor, fontFamily: FONT }}>{data.score > 0 ? `+${data.score}` : data.score}</span>
          </div>
          <span style={{ fontSize: 9, fontWeight: 700, color: MUTED2, fontFamily: FONT, textTransform: 'uppercase' }}>Score</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1, minWidth: 220 }}>
          <div style={{ flex: '1 1 110px', background: `${GREEN}12`, border: `1px solid ${GREEN}33`, borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ThumbsUp size={16} color={GREEN} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: GREEN, fontFamily: FONT }}>{data.positive}</div>
              <div style={{ fontSize: 10, color: MUTED, fontFamily: FONT, textTransform: 'uppercase', letterSpacing: .3 }}>Positive</div>
            </div>
          </div>
          <div style={{ flex: '1 1 110px', background: `${RED}12`, border: `1px solid ${RED}33`, borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ThumbsDown size={16} color={RED} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: RED, fontFamily: FONT }}>{data.negative}</div>
              <div style={{ fontSize: 10, color: MUTED, fontFamily: FONT, textTransform: 'uppercase', letterSpacing: .3 }}>Negative</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 800, color: INK, fontFamily: FONT, marginBottom: 8 }}>
        Incident Log — {data.hasActiveSession ? 'Current Session' : 'All Records'}
      </div>
      {data.records.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: MUTED2 }}>
          <div style={{ fontSize: 26, marginBottom: 6 }}>😊</div>
          <p style={{ fontSize: 12.5, margin: 0 }}>No behavior incidents recorded this session.</p>
        </div>
      ) : (
        data.records.map((r) => (
          <div key={r.id} style={{ padding: '8px 0', borderTop: `1px solid ${BORDER}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {r.polarity === 'positive' ? <ThumbsUp size={13} color={GREEN} /> : <ThumbsDown size={13} color={RED} />}
              <span style={{ padding: '2px 9px', borderRadius: 999, background: `${SEVERITY_COLOR[r.severity]}15`, color: SEVERITY_COLOR[r.severity], fontSize: 10.5, fontWeight: 800, textTransform: 'capitalize' }}>{r.severity}</span>
              <b style={{ fontSize: 12.5 }}>{r.incident_type}</b>
              <span style={{ fontSize: 11, fontWeight: 800, color: r.polarity === 'positive' ? GREEN : RED }}>{r.polarity === 'positive' ? `+${r.points}` : `-${r.points}`}</span>
              <span style={{ fontSize: 11, color: MUTED2, marginLeft: 'auto' }}>{r.recorded_on}</span>
            </div>
            {r.description && <p style={{ fontSize: 12, color: MUTED, margin: '4px 0 0' }}>{r.description}</p>}
          </div>
        ))
      )}
    </SectionCard>
  );
}

/* ── Transport tab (Transport + Hostel) ──────────────────────────────────── */
function TransportTab({ studentId, showToast }) {
  const [data, setData] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [form, setForm] = useState({ route_id: '', vehicle_id: '', pickup_point: '', fee: '' });
  const [roomId, setRoomId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => apiGet(`${BASE}/students/${studentId}/transport`).then((r) => setData(r.data)).catch(() => setData({ transport: null, hostel: null })), [studentId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiGet(`${BASE}/transport-routes`).then((r) => setRoutes(r.data || [])).catch(() => {});
    apiGet(`${BASE}/vehicles`).then((r) => setVehicles(r.data || [])).catch(() => {});
    apiGet(`${BASE}/hostel-rooms`).then((r) => setRooms(r.data || [])).catch(() => {});
  }, []);

  const assignTransport = async () => {
    setBusy(true);
    try { await apiPost(`${BASE}/student-transport`, { ...form, student_id: studentId }); showToast('Transport assigned ✓'); load(); }
    catch (e) { showToast(e.message || 'Could not assign'); }
    finally { setBusy(false); }
  };
  const assignHostel = async () => {
    if (!roomId) return showToast('Choose a room');
    setBusy(true);
    try { await apiPost(`${BASE}/hostel-allocations`, { room_id: roomId, student_id: studentId }); showToast('Hostel room allocated ✓'); load(); }
    catch (e) { showToast(e.message || 'Could not allocate'); }
    finally { setBusy(false); }
  };

  if (!data) return <SectionCard title="Transport & Hostel" color={BLUE}><Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /></SectionCard>;
  return (
    <>
      <SectionCard title="Transport Details" color={BLUE}>
        {data.transport ? (
          <>
            <InfoRow icon={Bus} label="Route" value={data.transport.route_name} />
            <InfoRow label="Vehicle" value={data.transport.vehicle_plate} />
            <InfoRow label="Driver" value={data.transport.driver_name ? `${data.transport.driver_name} (${data.transport.driver_phone || ''})` : null} />
            <InfoRow label="Pickup Point" value={data.transport.pickup_point} />
            <InfoRow label="Fee" value={naira(data.transport.fee)} />
          </>
        ) : (
          <>
            <p style={{ fontSize: 12.5, color: MUTED2, marginBottom: 10 }}>No transport assigned.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select value={form.route_id} onChange={(e) => setForm((f) => ({ ...f, route_id: e.target.value }))} style={{ ...inputStyle, flex: '1 1 140px', cursor: 'pointer' }}>
                <option value="">— route —</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <select value={form.vehicle_id} onChange={(e) => setForm((f) => ({ ...f, vehicle_id: e.target.value }))} style={{ ...inputStyle, flex: '1 1 140px', cursor: 'pointer' }}>
                <option value="">— vehicle —</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_no}</option>)}
              </select>
              <input value={form.pickup_point} onChange={(e) => setForm((f) => ({ ...f, pickup_point: e.target.value }))} placeholder="Pickup point" style={{ ...inputStyle, flex: '1 1 140px' }} />
              <input type="number" value={form.fee} onChange={(e) => setForm((f) => ({ ...f, fee: e.target.value }))} placeholder="Fee" style={{ ...inputStyle, flex: '1 1 100px' }} />
              <button onClick={assignTransport} disabled={busy} style={{ padding: '9px 16px', borderRadius: 9, border: 'none', background: AMBER, color: WHITE, fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>Assign</button>
            </div>
          </>
        )}
      </SectionCard>
      <SectionCard title="Hostel Details" color={PURPLE}>
        {data.hostel ? (
          <>
            <InfoRow icon={Bed} label="Hostel" value={data.hostel.hostel_name} />
            <InfoRow label="Room No" value={data.hostel.room_no} />
            <InfoRow label="Allocated On" value={data.hostel.allocated_on} />
          </>
        ) : (
          <>
            <p style={{ fontSize: 12.5, color: MUTED2, marginBottom: 10 }}>No hostel room allocated.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={{ ...inputStyle, flex: '1 1 200px', cursor: 'pointer' }}>
                <option value="">— select room —</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.room_no}</option>)}
              </select>
              <button onClick={assignHostel} disabled={busy} style={{ padding: '9px 16px', borderRadius: 9, border: 'none', background: AMBER, color: WHITE, fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>Allocate</button>
            </div>
          </>
        )}
      </SectionCard>
    </>
  );
}

/* ── Dedicated "Add Record" pages (Health / Behavior) ────────────────────── */
function RecordFormShell({ title, color, icon: Icon, backTo, onSave, busy, children }) {
  const navigate = useNavigate();
  return (
    <PageLayout title={title}>
      <div style={{ maxWidth: 640 }}>
        <button onClick={() => navigate(backTo)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'none', color: MUTED, fontSize: 12.5, fontFamily: FONT, cursor: 'pointer', marginBottom: 14, padding: 0 }}>
          <ArrowLeft size={14} /> Back to Profile
        </button>
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            {Icon && <Icon size={18} color={color} />}
            <b style={{ fontSize: 15, fontFamily: FONT, color: INK }}>{title}</b>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
          <button onClick={onSave} disabled={busy} style={{ marginTop: 18, padding: '10px 20px', borderRadius: 9, border: 'none', background: color, color: WHITE, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: FONT, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {busy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={14} />} Save Record
          </button>
        </div>
      </div>
    </PageLayout>
  );
}

const fieldLabel = { fontSize: 11.5, fontWeight: 800, color: MUTED2, fontFamily: FONT, textTransform: 'uppercase', letterSpacing: .3, marginBottom: 5, display: 'block' };

export function HealthRecordFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ record_type: 'condition', title: '', recorded_on: '', details: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.title.trim()) return alert('Title is required');
    setBusy(true);
    try {
      await apiPost(`${BASE}/health-records`, { ...form, student_id: id });
      navigate(`/mgmt/students/${id}?tab=health`);
    } catch (e) { alert(e.message || 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <RecordFormShell title="Add Health Record" color={RED} icon={HeartPulse} backTo={`/mgmt/students/${id}?tab=health`} onSave={save} busy={busy}>
      <div>
        <label style={fieldLabel}>Type</label>
        <select value={form.record_type} onChange={set('record_type')} style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
          <option value="allergy">Allergy</option><option value="condition">Condition</option>
          <option value="vaccination">Vaccination</option><option value="checkup">Checkup</option>
        </select>
      </div>
      <div>
        <label style={fieldLabel}>Title</label>
        <input value={form.title} onChange={set('title')} placeholder="e.g. Peanut Allergy" style={{ ...inputStyle, width: '100%' }} />
      </div>
      <div>
        <label style={fieldLabel}>Date</label>
        <input type="date" value={form.recorded_on} onChange={set('recorded_on')} style={{ ...inputStyle, width: '100%' }} />
      </div>
      <div>
        <label style={fieldLabel}>Details</label>
        <textarea value={form.details} onChange={set('details')} rows={4} style={{ ...inputStyle, width: '100%', resize: 'vertical' }} />
      </div>
    </RecordFormShell>
  );
}

export function BehaviorRecordFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ incident_type: '', polarity: 'negative', severity: 'low', points: 1, description: '', action_taken: '', recorded_on: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.incident_type.trim()) return alert('Incident type is required');
    setBusy(true);
    try {
      await apiPost(`${BASE}/behavior-records`, { ...form, points: Number(form.points) || 1, student_id: id });
      navigate(`/mgmt/students/${id}?tab=behavior`);
    } catch (e) { alert(e.message || 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <RecordFormShell title="Add Behavior Record" color={AMBER} icon={ShieldAlert} backTo={`/mgmt/students/${id}?tab=behavior`} onSave={save} busy={busy}>
      <div>
        <label style={fieldLabel}>Incident Type</label>
        <input value={form.incident_type} onChange={set('incident_type')} placeholder="e.g. Helped a classmate" style={{ ...inputStyle, width: '100%' }} />
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={fieldLabel}>Polarity</label>
          <select value={form.polarity} onChange={set('polarity')} style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
            <option value="positive">Positive</option><option value="negative">Negative</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={fieldLabel}>Severity</label>
          <select value={form.severity} onChange={set('severity')} style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={fieldLabel}>Points</label>
          <input type="number" min={1} value={form.points} onChange={set('points')} style={{ ...inputStyle, width: '100%' }} />
        </div>
      </div>
      <div>
        <label style={fieldLabel}>Date</label>
        <input type="date" value={form.recorded_on} onChange={set('recorded_on')} style={{ ...inputStyle, width: '100%' }} />
      </div>
      <div>
        <label style={fieldLabel}>Description</label>
        <textarea value={form.description} onChange={set('description')} rows={3} style={{ ...inputStyle, width: '100%', resize: 'vertical' }} />
      </div>
      <div>
        <label style={fieldLabel}>Action Taken</label>
        <textarea value={form.action_taken} onChange={set('action_taken')} rows={3} style={{ ...inputStyle, width: '100%', resize: 'vertical' }} />
      </div>
    </RecordFormShell>
  );
}
