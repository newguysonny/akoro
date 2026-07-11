/**
 * Student Information — Student List (table, filters, export, bulk tools).
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
import { PageLayout } from '../../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../../components/mgmt/ResourcePage.jsx';
import { API, apiGet, apiPost, apiPut, apiDelete } from '../../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../../constants.js';
import { BASE, fullName, studentOpts, STATUS_PILL, STUDENT_FIELDS, STUDENT_COLUMNS, STUDENT_SEARCH, CLASS_FILTER, naira, STATUS_OPTS, InfoRow, GridInfo, InfoGrid, SectionCard, Ring, statPill, FEE_STATUS_COLOR, ModalShell } from './shared.jsx';

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
