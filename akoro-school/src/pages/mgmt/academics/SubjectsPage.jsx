/**
 * Subjects — core & elective subjects, with the standard rich toolbar
 * (search, entries, export, column visibility, bulk delete, pagination).
 */
import { useState, useEffect, useCallback } from 'react';
import { Ico } from '../../../theme/Ico.jsx';
import { PageLayout } from '../../../components/Layout.jsx';
import { inputStyle } from '../../../components/mgmt/ResourcePage.jsx';
import { apiGet, apiPost, apiPut, apiDelete } from '../../../services/api.js';
import { GREEN, RED, BLUE, PURPLE } from '../../../constants.js';
import { C, tint } from '../../../theme/colors.js';
import { confirmDialog } from '../../../components/ConfirmHost.jsx';
import {
  BASE, STATUS_PILL, downloadBlob, csvCell, openPrintTable,
  ModalShell, th, td, iconBtn, selStyle, toolBtn, toastEl,
} from './shared.jsx';

const SUBJECT_TYPES = [{ value: 'core', label: 'Core' }, { value: 'elective', label: 'Elective' }];
const SUBJECT_COLUMNS = [
  { key: 'name', label: 'Subject' }, { key: 'code', label: 'Code' }, { key: 'subject_type', label: 'Type' },
];
const lbl = { fontSize: 11.5, fontWeight: 700, color: C.muted, fontFamily: C.font, display: 'block', margin: '10px 0 5px' };

function SubjectFormModal({ initial, onClose, onSave }) {
  const isEdit = !!initial;
  const [form, setForm] = useState(initial || { name: '', code: '', subject_type: 'core' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const canSave = form.name?.trim();
  return (
    <ModalShell title={isEdit ? 'Edit Subject' : 'Add Subject'} onClose={onClose} width={430}>
      <label style={lbl}>Subject Name</label>
      <input value={form.name} onChange={set('name')} placeholder="e.g. Mathematics" style={inputStyle} />
      <label style={lbl}>Code</label>
      <input value={form.code || ''} onChange={set('code')} placeholder="e.g. MTH" style={inputStyle} />
      <label style={lbl}>Type</label>
      <select value={form.subject_type || 'core'} onChange={set('subject_type')} style={inputStyle}>{SUBJECT_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
      <button onClick={() => canSave && onSave(form)} disabled={!canSave} style={{ width: '100%', marginTop: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: !canSave ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: !canSave ? C.muted2 : '#fff', fontSize: 13.5, fontWeight: 800, cursor: !canSave ? 'default' : 'pointer', fontFamily: C.font }}>
        <Ico ti="ti-square-check" size={14} /> {isEdit ? 'Save Changes' : 'Add Subject'}
      </button>
    </ModalShell>
  );
}

export function SubjectsPage() {
  const [rows, setRows] = useState(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [visibleCols, setVisibleCols] = useState(Object.fromEntries(SUBJECT_COLUMNS.map((c) => [c.key, true])));
  const [colMenu, setColMenu] = useState(false);
  const [modal, setModal] = useState(null);
  const [editingRow, setEditingRow] = useState(null);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(() => {
    setRows(null);
    apiGet(`${BASE}/subjects`).then((r) => { setRows(r.data || []); setSelected({}); setPage(1); })
      .catch((e) => { showToast(e.message || 'Could not load subjects'); setRows([]); });
  }, []);
  useEffect(() => { load(); }, [load]);

  let data = typeFilter ? (rows || []).filter((r) => r.subject_type === typeFilter) : (rows || []);
  const q = query.trim().toLowerCase();
  const filtered = data.filter((r) => !q || [r.name, r.code].some((v) => String(v || '').toLowerCase().includes(q)));
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize);

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const allPageSelected = pageRows.length > 0 && pageRows.every((r) => selected[r.id]);
  const toggleAll = (on) => setSelected((prev) => { const next = { ...prev }; pageRows.forEach((r) => { next[r.id] = on; }); return next; });

  const remove = async (r) => {
    if (!await confirmDialog(`Remove subject "${r.name}"? This cannot be undone.`)) return;
    setBusyId(r.id);
    try { await apiDelete(`${BASE}/subjects/${r.id}`); showToast('Removed'); load(); }
    catch (e) { showToast(e.message || 'Could not remove'); } finally { setBusyId(null); }
  };
  const bulkDelete = async () => {
    if (!selectedIds.length || !await confirmDialog(`Delete ${selectedIds.length} selected subject(s)?`)) return;
    try { await Promise.all(selectedIds.map((id) => apiDelete(`${BASE}/subjects/${id}`))); showToast(`Deleted ${selectedIds.length} subject(s)`); load(); }
    catch (e) { showToast(e.message || 'Bulk delete failed'); }
  };
  const save = async (form) => {
    const body = { name: form.name.trim(), code: form.code?.trim() || null, subject_type: form.subject_type || 'core' };
    try {
      if (editingRow) await apiPut(`${BASE}/subjects/${editingRow.id}`, body);
      else await apiPost(`${BASE}/subjects`, body);
      showToast('Saved ✓'); setModal(null); setEditingRow(null); load();
    } catch (e) { showToast(e.message || 'Could not save'); }
  };

  const cell = (r, key) => key === 'subject_type' ? (r.subject_type || 'core') : r[key];
  const exportRows = filtered.map((r) => SUBJECT_COLUMNS.filter((c) => visibleCols[c.key]).map((c) => cell(r, c.key)));
  const exportHeaders = SUBJECT_COLUMNS.filter((c) => visibleCols[c.key]).map((c) => c.label);
  const doCopy = () => { const t = [exportHeaders.join('\t'), ...exportRows.map((r) => r.join('\t'))].join('\n'); navigator.clipboard?.writeText(t).then(() => showToast(`Copied ${exportRows.length} rows`)).catch(() => showToast('Could not copy')); };
  const doCSV = () => downloadBlob([exportHeaders.join(','), ...exportRows.map((r) => r.map(csvCell).join(','))].join('\n'), 'subjects.csv', 'text/csv');
  const doExcel = () => downloadBlob(`<table><tr>${exportHeaders.map((h) => `<th>${h}</th>`).join('')}</tr>${exportRows.map((r) => `<tr>${r.map((c) => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('')}</table>`, 'subjects.xls', 'application/vnd.ms-excel');
  const colCount = 2 + SUBJECT_COLUMNS.filter((c) => visibleCols[c.key]).length + 1;

  return (
    <PageLayout title="Subjects" subtitle="Core and elective subjects">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <button onClick={() => { setEditingRow(null); setModal('form'); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
          <Ico ti="ti-book" size={15} /> Add Subject
        </button>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={selStyle}>
          <option value="">All Types</option>{SUBJECT_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: C.muted, fontFamily: C.font, display: 'flex', alignItems: 'center', gap: 6 }}>
          Show
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ ...inputStyle, width: 72, padding: '6px 8px', cursor: 'pointer' }}>
            <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={0}>All</option>
          </select>
          entries
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={doCopy} style={toolBtn(C.muted)}><Ico ti="ti-copy" size={13} /> Copy</button>
          <button onClick={doCSV} style={toolBtn(GREEN)}><Ico ti="ti-download" size={13} /> CSV</button>
          <button onClick={doExcel} style={toolBtn(GREEN)}><Ico ti="ti-file-spreadsheet" size={13} /> Excel</button>
          <button onClick={() => openPrintTable('Subjects', exportHeaders, exportRows)} style={toolBtn(RED)}><Ico ti="ti-file-text" size={13} /> PDF</button>
          <button onClick={() => openPrintTable('Subjects', exportHeaders, exportRows)} style={toolBtn(C.ink)}><Ico ti="ti-printer" size={13} /> Print</button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setColMenu((v) => !v)} style={toolBtn(BLUE)}><Ico ti="ti-columns" size={13} /> Column Visibility</button>
            {colMenu && (
              <div onMouseLeave={() => setColMenu(false)} style={{ position: 'absolute', top: '110%', left: 0, zIndex: 20, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,.12)' }}>
                {SUBJECT_COLUMNS.map((c) => (
                  <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', fontSize: 12.5, fontFamily: C.font, color: C.ink, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!visibleCols[c.key]} onChange={(e) => setVisibleCols((p) => ({ ...p, [c.key]: e.target.checked }))} /> {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button onClick={bulkDelete} disabled={!selectedIds.length} style={toolBtn(RED, !selectedIds.length)}><Ico ti="ti-trash" size={13} /> Bulk Delete{selectedIds.length ? ` (${selectedIds.length})` : ''}</button>
        </div>
        <div style={{ position: 'relative', marginLeft: 'auto', minWidth: 200 }}>
          <Ico ti="ti-search" size={15} color={C.muted2} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search subject, code…" style={{ ...inputStyle, paddingLeft: 34 }} />
        </div>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: C.font }}>
          <thead><tr>
            <th style={{ ...th, width: 34 }}><input type="checkbox" checked={allPageSelected} onChange={(e) => toggleAll(e.target.checked)} /></th>
            {visibleCols.name && <th style={th}>SUBJECT</th>}
            {visibleCols.code && <th style={th}>CODE</th>}
            {visibleCols.subject_type && <th style={th}>TYPE</th>}
            <th style={{ ...th, textAlign: 'right' }}>ACTIONS</th>
          </tr></thead>
          <tbody>
            {rows === null && <tr><td style={{ ...td, textAlign: 'center', color: C.muted2 }} colSpan={colCount}><Ico ti="ti-loader-2" size={18} style={{ animation: 'spin .8s linear infinite' }} /></td></tr>}
            {rows && pageRows.length === 0 && <tr><td style={{ ...td, textAlign: 'center', color: C.muted2 }} colSpan={colCount}>No subjects yet.</td></tr>}
            {pageRows.map((r) => (
              <tr key={r.id}>
                <td style={td}><input type="checkbox" checked={!!selected[r.id]} onChange={(e) => setSelected((p) => ({ ...p, [r.id]: e.target.checked }))} /></td>
                {visibleCols.name && <td style={{ ...td, fontWeight: 700 }}>{r.name}</td>}
                {visibleCols.code && <td style={td}>{r.code || <span style={{ color: C.muted2 }}>—</span>}</td>}
                {visibleCols.subject_type && <td style={td}>{STATUS_PILL(r.subject_type || 'core', { core: { c: BLUE }, elective: { c: PURPLE } })}</td>}
                <td style={{ ...td, textAlign: 'right' }}>
                  {busyId === r.id ? <Ico ti="ti-loader-2" size={15} style={{ animation: 'spin .8s linear infinite' }} /> : (
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button onClick={() => { setEditingRow(r); setModal('form'); }} title="Edit" style={iconBtn(BLUE)}><Ico ti="ti-pencil" size={14} /></button>
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
          <span style={{ fontSize: 12, color: C.muted2, fontFamily: C.font }}>Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, filtered.length)} of {filtered.length} entries</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={{ ...toolBtn(C.muted, page === 1) }}>Previous</button>
            <span style={{ fontSize: 12, color: C.ink, fontFamily: C.font, padding: '7px 10px' }}>{page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ ...toolBtn(C.muted, page === totalPages) }}>Next</button>
          </div>
        </div>
      )}

      {modal === 'form' && <SubjectFormModal initial={editingRow} onClose={() => { setModal(null); setEditingRow(null); }} onSave={save} />}
      {toastEl(toast)}
    </PageLayout>
  );
}
