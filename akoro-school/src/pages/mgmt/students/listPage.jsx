/**
 * Student Information — Student List (table, filters, export, bulk tools).
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { UserPlus, Mail, Upload } from 'lucide-react';
import { Ico } from '../../../theme/Ico.jsx';
import { PageLayout } from '../../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../../components/mgmt/ResourcePage.jsx';
import { API, apiGet, apiPost, apiPut, apiDelete } from '../../../services/api.js';
import { GREEN, RED, BLUE, PURPLE } from '../../../constants.js';
import { C, tint } from '../../../theme/colors.js';
import { BASE, fullName, studentOpts, STATUS_PILL, STUDENT_FIELDS, STUDENT_COLUMNS, STUDENT_SEARCH, CLASS_FILTER, naira, STATUS_OPTS, InfoRow, GridInfo, InfoGrid, SectionCard, Ring, statPill, FEE_STATUS_COLOR, ModalShell } from './shared.jsx';
import { confirmDialog } from '../../../components/ConfirmHost.jsx';

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
  // Drill-down from Classes/Sections passes the class/section via query params.
  const initParams = new URLSearchParams(window.location.search);
  const [rows, setRows] = useState(null);
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [classId, setClassId] = useState(initParams.get('class_id') || '');
  const [sectionId, setSectionId] = useState(initParams.get('section_id') || '');
  const [status, setStatus] = useState(initParams.get('class_id') ? '' : 'active');
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
    if (!await confirmDialog(`Remove ${fullName(r)} (${r.admission_no})? This cannot be undone.`)) return;
    setBusyId(r.id);
    try { await apiDelete(`${BASE}/students/${r.id}`); setRows((p) => p.filter((x) => x.id !== r.id)); showToast('Removed'); }
    catch (e) { showToast(e.message || 'Could not remove'); }
    finally { setBusyId(null); }
  };

  const bulkDelete = async () => {
    if (!selectedIds.length) return;
    if (!await confirmDialog(`Delete ${selectedIds.length} selected student(s)? This cannot be undone.`)) return;
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

  const th = { textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: C.muted2, letterSpacing: .4, whiteSpace: 'nowrap' };
  const td = { padding: '11px 14px', fontSize: 13, color: C.ink, borderTop: `1px solid ${C.border}`, whiteSpace: 'nowrap' };
  const iconBtn = (color) => ({ width: 30, height: 30, borderRadius: 7, border: 'none', background: tint(8, color), color, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' });
  const selStyle = { ...inputStyle, width: 'auto', minWidth: 150, cursor: 'pointer' };
  const toolBtn = (color, disabled) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: `1px solid ${color}44`, background: disabled ? C.bg : tint(5, color), color: disabled ? C.muted2 : color, fontSize: 12, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: C.font, opacity: disabled ? 0.6 : 1 });

  const colCount = 2 + ALL_COLUMNS.filter((c) => visibleCols[c.key]).length + 1;

  return (
    <PageLayout title="Student List" subtitle="All students in your school">
      {/* Admit / bulk-action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <button onClick={() => navigate('/mgmt/student-admission')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
          <Ico ti="ti-user-plus" size={15} /> Admit Student
        </button>
        <button onClick={() => setModal('enrol')} style={{ ...toolBtn(GREEN), background: `${GREEN}12` }}><Ico ti="ti-mail" size={14} /> Enrol / Invite</button>
        <button onClick={() => navigate('/mgmt/students/bulk-upload')} style={{ ...toolBtn(BLUE), background: `${BLUE}12` }}><Ico ti="ti-upload" size={14} /> Bulk Upload</button>
        <button onClick={() => navigate('/mgmt/students/bulk-photos')} style={{ ...toolBtn(PURPLE), background: `${PURPLE}12` }}><Ico ti="ti-photo" size={14} /> Bulk Photos</button>
        <button onClick={() => navigate('/mgmt/students/bulk-docs')} style={{ ...toolBtn(GREEN), background: `${GREEN}12` }}><Ico ti="ti-file-upload" size={14} /> Bulk Docs</button>
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
        <label style={{ fontSize: 12, color: C.muted, fontFamily: C.font, display: 'flex', alignItems: 'center', gap: 6 }}>
          Show
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ ...inputStyle, width: 72, padding: '6px 8px', cursor: 'pointer' }}>
            <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option><option value={0}>All</option>
          </select>
          entries
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={doCopy} style={toolBtn(C.muted)}><Ico ti="ti-copy" size={13} /> Copy</button>
          <button onClick={doCSV} style={toolBtn(GREEN)}><Ico ti="ti-download" size={13} /> CSV</button>
          <button onClick={doExcel} style={toolBtn(GREEN)}><Ico ti="ti-file-spreadsheet" size={13} /> Excel</button>
          <button onClick={doPDF} style={toolBtn(RED)}><Ico ti="ti-file-text" size={13} /> PDF</button>
          <button onClick={doPrint} style={toolBtn(C.ink)}><Ico ti="ti-printer" size={13} /> Print</button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setColMenu((v) => !v)} style={toolBtn(BLUE)}><Ico ti="ti-columns" size={13} /> Column Visibility</button>
            {colMenu && (
              <div onMouseLeave={() => setColMenu(false)} style={{ position: 'absolute', top: '110%', left: 0, zIndex: 20, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,.12)' }}>
                {ALL_COLUMNS.map((c) => (
                  <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', fontSize: 12.5, fontFamily: C.font, color: C.ink, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!visibleCols[c.key]} onChange={(e) => setVisibleCols((p) => ({ ...p, [c.key]: e.target.checked }))} />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => selectedIds.length ? setModal('bulk-edit') : showToast('Select at least one student first')} style={toolBtn(C.brand, !selectedIds.length)}><Ico ti="ti-pencil" size={13} /> Bulk Edit{selectedIds.length ? ` (${selectedIds.length})` : ''}</button>
          <button onClick={bulkDelete} disabled={!selectedIds.length} style={toolBtn(RED, !selectedIds.length)}><Ico ti="ti-trash" size={13} /> Bulk Delete{selectedIds.length ? ` (${selectedIds.length})` : ''}</button>
        </div>
        <div style={{ position: 'relative', marginLeft: 'auto', minWidth: 200 }}>
          <Ico ti="ti-search" size={15} color={C.muted2} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search name, adm no, phone…" style={{ ...inputStyle, paddingLeft: 34 }} />
        </div>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: C.font }}>
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
            {rows === null && <tr><td style={{ ...td, textAlign: 'center', color: C.muted2 }} colSpan={colCount}><Ico ti="ti-loader-2" size={18} style={{ animation: 'spin .8s linear infinite' }} /></td></tr>}
            {rows && pageRows.length === 0 && <tr><td style={{ ...td, textAlign: 'center', color: C.muted2 }} colSpan={colCount}>No students found.</td></tr>}
            {pageRows.map((r) => (
              <tr key={r.id}>
                <td style={td}><input type="checkbox" checked={!!selected[r.id]} onChange={(e) => setSelected((p) => ({ ...p, [r.id]: e.target.checked }))} /></td>
                {visibleCols.admission_no && <td style={{ ...td, fontWeight: 700 }}>{r.admission_no}</td>}
                {visibleCols.roll_no && <td style={td}>{r.roll_no || '—'}</td>}
                {visibleCols.name && (
                  <td style={{ ...td, whiteSpace: 'normal' }}>
                    <button onClick={() => navigate(`/mgmt/students/${r.id}`)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: C.font, fontWeight: 700, color: BLUE, textAlign: 'left' }}>{fullName(r)}</button>
                  </td>
                )}
                {visibleCols.class_name && <td style={td}>{r.class_name || '—'}</td>}
                {visibleCols.section_name && <td style={td}>{r.section_name || '—'}</td>}
                {visibleCols.fee_assigned && <td style={td}>{naira(r.fee_assigned)}</td>}
                {visibleCols.fee_due && <td style={td}>{r.fee_due > 0 ? <span style={{ padding: '3px 10px', borderRadius: 999, background: `${RED}15`, color: RED, fontSize: 11.5, fontWeight: 800 }}>{naira(r.fee_due)}</span> : <span style={{ padding: '3px 10px', borderRadius: 999, background: `${GREEN}15`, color: GREEN, fontSize: 11.5, fontWeight: 800 }}>Paid</span>}</td>}
                {visibleCols.status && <td style={td}>{STATUS_PILL(r.status, { active: { c: GREEN }, inactive: { c: RED }, alumni: { c: BLUE } })}</td>}
                <td style={{ ...td, textAlign: 'right' }}>
                  {busyId === r.id ? <Ico ti="ti-loader-2" size={15} style={{ animation: 'spin .8s linear infinite' }} /> : (
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button onClick={() => navigate(`/mgmt/students/${r.id}`)} title="View Profile" style={iconBtn(GREEN)}><Ico ti="ti-eye" size={14} /></button>
                      <button onClick={() => navigate(`/mgmt/students/${r.id}?edit=1`)} title="Edit" style={iconBtn(BLUE)}><Ico ti="ti-pencil" size={14} /></button>
                      <button onClick={() => remove(r)} title="Delete" style={iconBtn(RED)}><Ico ti="ti-trash" size={14} /></button>
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
          <span style={{ fontSize: 12, color: C.muted2, fontFamily: C.font }}>
            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, filtered.length)} of {filtered.length} entries
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={{ ...toolBtn(C.muted, page === 1) }}>Previous</button>
            <span style={{ fontSize: 12, color: C.ink, fontFamily: C.font, padding: '7px 10px' }}>{page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ ...toolBtn(C.muted, page === totalPages) }}>Next</button>
          </div>
        </div>
      )}

      {modal === 'bulk-edit' && <BulkEditModal count={selectedIds.length} classes={classes} sections={sections} onClose={() => setModal(null)} onSave={async (patch) => { try { await apiPost(`${BASE}/students/bulk-update`, { ids: selectedIds, ...patch }); showToast(`Updated ${selectedIds.length} student(s)`); setModal(null); load(); } catch (e) { showToast(e.message || 'Bulk update failed'); } }} />}
      {modal === 'enrol' && <EnrolStudentModal onClose={() => setModal(null)} onDone={load} showToast={showToast} navigate={navigate} />}

      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, maxWidth: '80vw' }}>{toast}</div>}
    </PageLayout>
  );
}

/* ── Bulk Edit (apply Class/Section/Status to selected students) ─────────── */
function BulkEditModal({ count, classes, sections, onClose, onSave }) {
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [status, setStatus] = useState('');
  const lbl = { fontSize: 11.5, fontWeight: 700, color: C.muted, fontFamily: C.font, display: 'block', margin: '10px 0 5px' };

  return (
    <ModalShell title={`Bulk Edit (${count} selected)`} onClose={onClose} width={420}>
      <p style={{ fontSize: 12.5, color: C.muted, margin: 0 }}>Leave a field blank to keep it unchanged for the selected students.</p>
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
      <button onClick={() => onSave({ class_id: classId, section_id: sectionId, status })} disabled={!classId && !sectionId && !status} style={{ width: '100%', marginTop: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: (!classId && !sectionId && !status) ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: (!classId && !sectionId && !status) ? C.muted2 : '#fff', fontSize: 13.5, fontWeight: 800, cursor: (!classId && !sectionId && !status) ? 'default' : 'pointer', fontFamily: C.font }}>
        <Ico ti="ti-square-check" size={14} /> Apply to {count} student(s)
      </button>
    </ModalShell>
  );
}

/* ── Enrol / Invite modal — Manual Entry · Send Invite · Import CSV ───────── */
function EnrolStudentModal({ onClose, onDone, showToast, navigate }) {
  const [tab, setTab] = useState('manual');            // manual | invite | csv
  const [fullNameV, setFullNameV] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);          // { temp_password, email } | { invited }

  const submit = async (sendEmail) => {
    if (!email.trim()) return showToast('Email is required');
    setBusy(true);
    try {
      const r = await apiPost(`${BASE}/students/enrol`, { fullName: fullNameV.trim(), email: email.trim(), sendEmail });
      onDone?.();
      if (sendEmail) { setResult({ invited: true, email: email.trim() }); }
      else { setResult({ temp_password: r.temp_password, email: email.trim(), existing: !r.account_created }); }
    } catch (e) { showToast(e.message || 'Could not enrol student'); }
    finally { setBusy(false); }
  };

  const TabBtn = ({ id, icon: Icon, ti, label }) => (
    <button onClick={() => { setTab(id); setResult(null); }} style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 0', borderRadius: 9, border: `1px solid ${tab === id ? C.brand : C.border}`, background: tab === id ? tint(7) : C.surface, color: tab === id ? '#B45309' : C.muted, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
      <Ico lucide={Icon} ti={ti} size={14} /> {label}
    </button>
  );

  return (
    <ModalShell title="Enrol a student" onClose={onClose} width={440}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <TabBtn id="manual" icon={UserPlus} ti="ti-user-plus" label="Manual" />
        <TabBtn id="invite" icon={Mail} ti="ti-mail" label="Invite" />
        <TabBtn id="csv" icon={Upload} ti="ti-upload" label="CSV" />
      </div>

      {result ? (
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          {result.invited ? (
            <p style={{ fontSize: 13.5, color: C.ink, margin: 0 }}>Invite sent to <strong>{result.email}</strong> with sign-in details. ✓</p>
          ) : result.existing ? (
            <p style={{ fontSize: 13.5, color: C.ink, margin: 0 }}><strong>{result.email}</strong> already had an account — added to your school. ✓</p>
          ) : (
            <div>
              <p style={{ fontSize: 13, color: C.muted, margin: '0 0 10px' }}>Account created for <strong>{result.email}</strong>. Share this temporary password (shown once):</p>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px' }}>
                <code style={{ fontSize: 15, fontWeight: 800, color: C.ink, letterSpacing: .5 }}>{result.temp_password}</code>
                <button onClick={() => { navigator.clipboard?.writeText(result.temp_password); showToast('Copied'); }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.brand, display: 'flex' }}><Ico ti="ti-copy" size={15} /></button>
              </div>
            </div>
          )}
          <button onClick={onClose} style={{ display: 'block', width: '100%', marginTop: 18, padding: '11px', borderRadius: 11, border: 'none', background: `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>Done</button>
        </div>
      ) : tab === 'csv' ? (
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <p style={{ fontSize: 13, color: C.muted, margin: '0 0 14px' }}>Import many students at once from a spreadsheet.</p>
          <button onClick={() => { onClose(); navigate('/mgmt/students/bulk-upload'); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '11px 20px', borderRadius: 11, border: 'none', background: `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}><Ico ti="ti-upload" size={15} /> Go to Bulk Upload</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, display: 'block', marginBottom: 5 }}>Full name {tab === 'invite' && <span style={{ fontWeight: 500, color: C.muted2 }}>(optional)</span>}</label>
            <input value={fullNameV} onChange={(e) => setFullNameV(e.target.value)} placeholder="Ada Obi" style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, display: 'block', marginBottom: 5 }}>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="student@example.com" type="email" style={inputStyle} />
          </div>
          <button onClick={() => submit(tab === 'invite')} disabled={busy || !email.trim()} style={{ marginTop: 4, padding: '11px', borderRadius: 11, border: 'none', background: (busy || !email.trim()) ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: (busy || !email.trim()) ? C.muted2 : '#fff', fontSize: 13, fontWeight: 800, cursor: (busy || !email.trim()) ? 'default' : 'pointer', fontFamily: C.font, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            {busy ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : (tab === 'invite' ? <Ico ti="ti-mail" size={14} /> : <Ico ti="ti-user-plus" size={14} />)}
            {tab === 'invite' ? 'Send invite' : 'Create account'}
          </button>
          <p style={{ fontSize: 11, color: C.muted2, margin: 0, textAlign: 'center' }}>
            {tab === 'invite' ? 'Emails the student their sign-in details.' : 'Creates the account and shows a temporary password once.'}
          </p>
        </div>
      )}
    </ModalShell>
  );
}
