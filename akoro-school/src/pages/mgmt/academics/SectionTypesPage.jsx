/**
 * Section Types — the reusable arm labels (A, B, C, D, …) a school uses across
 * its classes, each active or inactive. A flat catalogue with the standard
 * rich toolbar.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Rows3, Search, Pencil, Trash2, Copy, Printer, Columns, Sheet, Download,
  FileText, Loader2, CheckSquare,
} from 'lucide-react';
import { PageLayout } from '../../../components/Layout.jsx';
import { inputStyle } from '../../../components/mgmt/ResourcePage.jsx';
import { apiGet, apiPost, apiPut, apiDelete } from '../../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, WHITE, GREEN, RED, BLUE, FONT } from '../../../constants.js';
import { confirmDialog } from '../../../components/ConfirmHost.jsx';
import {
  BASE, GENERIC_STATUS_OPTS, STATUS_PILL, downloadBlob, csvCell, openPrintTable,
  ModalShell, th, td, iconBtn, selStyle, toolBtn, toastEl,
} from './shared.jsx';

const TYPE_COLUMNS = [
  { key: 'name', label: 'Section Type' }, { key: 'description', label: 'Description' },
  { key: 'sort_order', label: 'Order' }, { key: 'usage_count', label: 'Sections Using' }, { key: 'status', label: 'Status' },
];
const lbl = { fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT, display: 'block', margin: '10px 0 5px' };

function TypeFormModal({ initial, onClose, onSave }) {
  const isEdit = !!initial;
  const [form, setForm] = useState(initial || { name: '', description: '', sort_order: '', status: 'active' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const canSave = form.name?.trim();
  return (
    <ModalShell title={isEdit ? 'Edit Section Type' : 'Add Section Type'} onClose={onClose} width={430}>
      <label style={lbl}>Section Type</label>
      <input value={form.name} onChange={set('name')} placeholder="e.g. A" style={inputStyle} />
      <label style={lbl}>Description</label>
      <input value={form.description || ''} onChange={set('description')} placeholder="e.g. Gold arm" style={inputStyle} />
      <label style={lbl}>Display Order</label>
      <input type="number" value={form.sort_order} onChange={set('sort_order')} placeholder="e.g. 1" style={inputStyle} />
      <label style={lbl}>Status</label>
      <select value={form.status} onChange={set('status')} style={inputStyle}>{GENERIC_STATUS_OPTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
      <button onClick={() => canSave && onSave(form)} disabled={!canSave} style={{ width: '100%', marginTop: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: !canSave ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: !canSave ? '#9CA3AF' : WHITE, fontSize: 13.5, fontWeight: 800, cursor: !canSave ? 'default' : 'pointer', fontFamily: FONT }}>
        <CheckSquare size={14} /> {isEdit ? 'Save Changes' : 'Add Section Type'}
      </button>
    </ModalShell>
  );
}

export function SectionTypesPage() {
  const [types, setTypes] = useState(null);
  const [sections, setSections] = useState([]);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [visibleCols, setVisibleCols] = useState(Object.fromEntries(TYPE_COLUMNS.map((c) => [c.key, true])));
  const [colMenu, setColMenu] = useState(false);
  const [modal, setModal] = useState(null);
  const [editingRow, setEditingRow] = useState(null);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(() => {
    setTypes(null);
    Promise.all([
      apiGet(`${BASE}/section-types`).then((r) => r.data || []),
      apiGet(`${BASE}/sections`).then((r) => r.data || []).catch(() => []),
    ]).then(([ty, se]) => { setTypes(ty); setSections(se); setSelected({}); setPage(1); })
      .catch((e) => { showToast(e.message || 'Could not load section types'); setTypes([]); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const withCounts = (types || []).map((t) => ({
    ...t,
    usage_count: sections.filter((s) => String(s.name || '').toLowerCase() === String(t.name || '').toLowerCase()).length,
  }));
  const statusFiltered = status ? withCounts.filter((r) => r.status === status) : withCounts;
  const q = query.trim().toLowerCase();
  const filtered = statusFiltered.filter((r) => !q || [r.name, r.description].some((v) => String(v || '').toLowerCase().includes(q)));
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize);

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const allPageSelected = pageRows.length > 0 && pageRows.every((r) => selected[r.id]);
  const toggleAll = (on) => setSelected((prev) => { const next = { ...prev }; pageRows.forEach((r) => { next[r.id] = on; }); return next; });

  const remove = async (r) => {
    if (!await confirmDialog(`Remove section type "${r.name}"? This does not affect existing class sections.`)) return;
    setBusyId(r.id);
    try { await apiDelete(`${BASE}/section-types/${r.id}`); showToast('Removed'); load(); }
    catch (e) { showToast(e.message || 'Could not remove'); } finally { setBusyId(null); }
  };
  const bulkDelete = async () => {
    if (!selectedIds.length || !await confirmDialog(`Delete ${selectedIds.length} selected section type(s)?`)) return;
    try { await Promise.all(selectedIds.map((id) => apiDelete(`${BASE}/section-types/${id}`))); showToast(`Deleted ${selectedIds.length} type(s)`); load(); }
    catch (e) { showToast(e.message || 'Bulk delete failed'); }
  };
  const save = async (form) => {
    const body = { name: form.name.trim(), description: form.description?.trim() || null, sort_order: Number(form.sort_order) || 0, status: form.status || 'active' };
    try {
      if (editingRow) await apiPut(`${BASE}/section-types/${editingRow.id}`, body);
      else await apiPost(`${BASE}/section-types`, body);
      showToast('Saved ✓'); setModal(null); setEditingRow(null); load();
    } catch (e) { showToast(e.message || 'Could not save'); }
  };

  const exportRows = filtered.map((r) => TYPE_COLUMNS.filter((c) => visibleCols[c.key]).map((c) => r[c.key]));
  const exportHeaders = TYPE_COLUMNS.filter((c) => visibleCols[c.key]).map((c) => c.label);
  const doCopy = () => { const t = [exportHeaders.join('\t'), ...exportRows.map((r) => r.join('\t'))].join('\n'); navigator.clipboard?.writeText(t).then(() => showToast(`Copied ${exportRows.length} rows`)).catch(() => showToast('Could not copy')); };
  const doCSV = () => downloadBlob([exportHeaders.join(','), ...exportRows.map((r) => r.map(csvCell).join(','))].join('\n'), 'section_types.csv', 'text/csv');
  const doExcel = () => downloadBlob(`<table><tr>${exportHeaders.map((h) => `<th>${h}</th>`).join('')}</tr>${exportRows.map((r) => `<tr>${r.map((c) => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('')}</table>`, 'section_types.xls', 'application/vnd.ms-excel');
  const colCount = 2 + TYPE_COLUMNS.filter((c) => visibleCols[c.key]).length + 1;

  return (
    <PageLayout title="Section Types" subtitle="Reusable class arms (A, B, C, D …) across your school">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <button onClick={() => { setEditingRow(null); setModal('form'); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          <Rows3 size={15} /> Add Section Type
        </button>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={selStyle}>
          <option value="">All Statuses</option>{GENERIC_STATUS_OPTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: MUTED, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 6 }}>
          Show
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ ...inputStyle, width: 72, padding: '6px 8px', cursor: 'pointer' }}>
            <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={0}>All</option>
          </select>
          entries
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={doCopy} style={toolBtn(MUTED)}><Copy size={13} /> Copy</button>
          <button onClick={doCSV} style={toolBtn(GREEN)}><Download size={13} /> CSV</button>
          <button onClick={doExcel} style={toolBtn(GREEN)}><Sheet size={13} /> Excel</button>
          <button onClick={() => openPrintTable('Section Types', exportHeaders, exportRows)} style={toolBtn(RED)}><FileText size={13} /> PDF</button>
          <button onClick={() => openPrintTable('Section Types', exportHeaders, exportRows)} style={toolBtn(INK)}><Printer size={13} /> Print</button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setColMenu((v) => !v)} style={toolBtn(BLUE)}><Columns size={13} /> Column Visibility</button>
            {colMenu && (
              <div onMouseLeave={() => setColMenu(false)} style={{ position: 'absolute', top: '110%', left: 0, zIndex: 20, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 10, minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,.12)' }}>
                {TYPE_COLUMNS.map((c) => (
                  <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', fontSize: 12.5, fontFamily: FONT, color: INK, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!visibleCols[c.key]} onChange={(e) => setVisibleCols((p) => ({ ...p, [c.key]: e.target.checked }))} /> {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button onClick={bulkDelete} disabled={!selectedIds.length} style={toolBtn(RED, !selectedIds.length)}><Trash2 size={13} /> Bulk Delete{selectedIds.length ? ` (${selectedIds.length})` : ''}</button>
        </div>
        <div style={{ position: 'relative', marginLeft: 'auto', minWidth: 200 }}>
          <Search size={15} color={MUTED2} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search section type…" style={{ ...inputStyle, paddingLeft: 34 }} />
        </div>
      </div>

      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
          <thead><tr>
            <th style={{ ...th, width: 34 }}><input type="checkbox" checked={allPageSelected} onChange={(e) => toggleAll(e.target.checked)} /></th>
            {visibleCols.name && <th style={th}>SECTION TYPE</th>}
            {visibleCols.description && <th style={th}>DESCRIPTION</th>}
            {visibleCols.sort_order && <th style={th}>ORDER</th>}
            {visibleCols.usage_count && <th style={th}>SECTIONS USING</th>}
            {visibleCols.status && <th style={th}>STATUS</th>}
            <th style={{ ...th, textAlign: 'right' }}>ACTIONS</th>
          </tr></thead>
          <tbody>
            {types === null && <tr><td style={{ ...td, textAlign: 'center', color: MUTED2 }} colSpan={colCount}><Loader2 size={18} style={{ animation: 'spin .8s linear infinite' }} /></td></tr>}
            {types && pageRows.length === 0 && <tr><td style={{ ...td, textAlign: 'center', color: MUTED2 }} colSpan={colCount}>No section types yet.</td></tr>}
            {pageRows.map((r) => (
              <tr key={r.id}>
                <td style={td}><input type="checkbox" checked={!!selected[r.id]} onChange={(e) => setSelected((p) => ({ ...p, [r.id]: e.target.checked }))} /></td>
                {visibleCols.name && <td style={{ ...td, fontWeight: 700 }}>{r.name}</td>}
                {visibleCols.description && <td style={{ ...td, whiteSpace: 'normal' }}>{r.description || <span style={{ color: MUTED2 }}>—</span>}</td>}
                {visibleCols.sort_order && <td style={td}>{r.sort_order}</td>}
                {visibleCols.usage_count && <td style={td}>{r.usage_count}</td>}
                {visibleCols.status && <td style={td}>{STATUS_PILL(r.status, { active: { c: GREEN }, inactive: { c: RED } })}</td>}
                <td style={{ ...td, textAlign: 'right' }}>
                  {busyId === r.id ? <Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> : (
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button onClick={() => { setEditingRow(r); setModal('form'); }} title="Edit" style={iconBtn(BLUE)}><Pencil size={14} /></button>
                      <button onClick={() => remove(r)} title="Delete" style={iconBtn(RED)}><Trash2 size={14} /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {types && filtered.length > 0 && pageSize > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 12, color: MUTED2, fontFamily: FONT }}>Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, filtered.length)} of {filtered.length} entries</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={{ ...toolBtn(MUTED, page === 1) }}>Previous</button>
            <span style={{ fontSize: 12, color: INK, fontFamily: FONT, padding: '7px 10px' }}>{page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ ...toolBtn(MUTED, page === totalPages) }}>Next</button>
          </div>
        </div>
      )}

      {modal === 'form' && <TypeFormModal initial={editingRow} onClose={() => { setModal(null); setEditingRow(null); }} onSave={save} />}
      {toastEl(toast)}
    </PageLayout>
  );
}
