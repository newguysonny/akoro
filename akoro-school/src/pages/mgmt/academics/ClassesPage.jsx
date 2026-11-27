/**
 * Classes — the middle of the hierarchy. Filtered by academic level when
 * reached via /mgmt/classes?level=<id>. Clicking a class goes to its Sections
 * (if it has any) or straight to the Student List (if it has none).
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Ico } from '../../../theme/Ico.jsx';
import { PageLayout } from '../../../components/Layout.jsx';
import BackButton from '../../../components/BackButton.jsx';
import { inputStyle } from '../../../components/mgmt/ResourcePage.jsx';
import { apiGet, apiPost, apiPut, apiDelete } from '../../../services/api.js';
import { GREEN, RED, BLUE } from '../../../constants.js';
import { C, tint } from '../../../theme/colors.js';
import { confirmDialog } from '../../../components/ConfirmHost.jsx';
import {
  BASE, GENERIC_STATUS_OPTS, STATUS_PILL, downloadBlob, csvCell, openPrintTable,
  ModalShell, Breadcrumb, th, td, iconBtn, selStyle, toolBtn, toastEl,
} from './shared.jsx';

const CLASS_COLUMNS = [
  { key: 'name', label: 'Class Name' }, { key: 'level_name', label: 'Academic Level' },
  { key: 'sections_count', label: 'Sections' }, { key: 'students_count', label: 'Students' },
  { key: 'teacher', label: 'Class Teacher' }, { key: 'status', label: 'Status' },
];
const lbl = { fontSize: 11.5, fontWeight: 700, color: C.muted, fontFamily: C.font, display: 'block', margin: '10px 0 5px' };

function ClassFormModal({ initial, levels, defaultLevelId, onClose, onSave }) {
  const isEdit = !!initial;
  const [form, setForm] = useState(initial || { name: '', level_id: defaultLevelId || '', teacher: '', status: 'active' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const canSave = form.name?.trim();
  return (
    <ModalShell title={isEdit ? 'Edit Class' : 'Add Class'} onClose={onClose} width={440}>
      <label style={lbl}>Class Name</label>
      <input value={form.name} onChange={set('name')} placeholder="e.g. Primary 4" style={inputStyle} />
      <label style={lbl}>Academic Level</label>
      <select value={form.level_id || ''} onChange={set('level_id')} style={inputStyle}>
        <option value="">— none —</option>{levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <label style={lbl}>Class Teacher</label>
      <input value={form.teacher || ''} onChange={set('teacher')} placeholder="Teacher's name" style={inputStyle} />
      <div style={{ fontSize: 11, color: C.muted2, margin: '4px 0 0', fontFamily: C.font }}>Tip: assign a teacher account via <b>Academics → Assign Class Teacher</b> and it fills this in automatically.</div>
      <label style={lbl}>Status</label>
      <select value={form.status} onChange={set('status')} style={inputStyle}>{GENERIC_STATUS_OPTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
      <button onClick={() => canSave && onSave(form)} disabled={!canSave} style={{ width: '100%', marginTop: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: !canSave ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: !canSave ? C.muted2 : '#fff', fontSize: 13.5, fontWeight: 800, cursor: !canSave ? 'default' : 'pointer', fontFamily: C.font }}>
        <Ico ti="ti-square-check" size={14} /> {isEdit ? 'Save Changes' : 'Add Class'}
      </button>
    </ModalShell>
  );
}

export function ClassesPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const urlLevel = params.get('level') || '';
  const [classes, setClasses] = useState(null);
  const [levels, setLevels] = useState([]);
  const [sections, setSections] = useState([]);
  const [students, setStudents] = useState([]);
  const [levelId, setLevelId] = useState(urlLevel);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [visibleCols, setVisibleCols] = useState(Object.fromEntries(CLASS_COLUMNS.map((c) => [c.key, true])));
  const [colMenu, setColMenu] = useState(false);
  const [modal, setModal] = useState(null);
  const [editingRow, setEditingRow] = useState(null);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  useEffect(() => { setLevelId(urlLevel); }, [urlLevel]);

  const load = useCallback(() => {
    setClasses(null);
    Promise.all([
      apiGet(`${BASE}/classes`).then((r) => r.data || []),
      apiGet(`${BASE}/academic-levels`).then((r) => r.data || []).catch(() => []),
      apiGet(`${BASE}/sections`).then((r) => r.data || []).catch(() => []),
      apiGet(`${BASE}/students/list`).then((r) => r.data || []).catch(() => []),
    ]).then(([cl, lv, se, st]) => { setClasses(cl); setLevels(lv); setSections(se); setStudents(st); setSelected({}); setPage(1); })
      .catch((e) => { showToast(e.message || 'Could not load classes'); setClasses([]); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const withNames = (classes || []).map((c) => ({
    ...c,
    level_name: levels.find((l) => l.id === c.level_id)?.name || '—',
    sections_count: sections.filter((s) => s.class_id === c.id).length,
    students_count: students.filter((s) => s.class_id === c.id).length,
    status: c.status || 'active',
  }));
  let data = withNames;
  if (levelId) data = data.filter((c) => c.level_id === levelId);
  if (status) data = data.filter((c) => c.status === status);
  const q = query.trim().toLowerCase();
  const filtered = data.filter((r) => !q || [r.name, r.level_name, r.teacher].some((v) => String(v || '').toLowerCase().includes(q)));
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize);

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const allPageSelected = pageRows.length > 0 && pageRows.every((r) => selected[r.id]);
  const toggleAll = (on) => setSelected((prev) => { const next = { ...prev }; pageRows.forEach((r) => { next[r.id] = on; }); return next; });
  const activeLevel = levelId ? levels.find((l) => l.id === levelId) : null;

  const openClass = (c) => {
    const hasSections = sections.some((s) => s.class_id === c.id);
    navigate(hasSections ? `/mgmt/sections?class=${c.id}` : `/mgmt/students?class_id=${c.id}`);
  };
  const remove = async (r) => {
    if (!await confirmDialog(`Remove "${r.name}"? This cannot be undone.`)) return;
    setBusyId(r.id);
    try { await apiDelete(`${BASE}/classes/${r.id}`); showToast('Removed'); load(); }
    catch (e) { showToast(e.message || 'Could not remove'); } finally { setBusyId(null); }
  };
  const bulkDelete = async () => {
    if (!selectedIds.length || !await confirmDialog(`Delete ${selectedIds.length} selected class(es)?`)) return;
    try { await Promise.all(selectedIds.map((id) => apiDelete(`${BASE}/classes/${id}`))); showToast(`Deleted ${selectedIds.length} class(es)`); load(); }
    catch (e) { showToast(e.message || 'Bulk delete failed'); }
  };
  const save = async (form) => {
    const body = { name: form.name.trim(), level_id: form.level_id || null, teacher: form.teacher?.trim() || null, status: form.status || 'active' };
    try {
      if (editingRow) await apiPut(`${BASE}/classes/${editingRow.id}`, body);
      else await apiPost(`${BASE}/classes`, body);
      showToast('Saved ✓'); setModal(null); setEditingRow(null); load();
    } catch (e) { showToast(e.message || 'Could not save'); }
  };

  const exportRows = filtered.map((r) => CLASS_COLUMNS.filter((c) => visibleCols[c.key]).map((c) => r[c.key]));
  const exportHeaders = CLASS_COLUMNS.filter((c) => visibleCols[c.key]).map((c) => c.label);
  const doCopy = () => { const t = [exportHeaders.join('\t'), ...exportRows.map((r) => r.join('\t'))].join('\n'); navigator.clipboard?.writeText(t).then(() => showToast(`Copied ${exportRows.length} rows`)).catch(() => showToast('Could not copy')); };
  const doCSV = () => downloadBlob([exportHeaders.join(','), ...exportRows.map((r) => r.map(csvCell).join(','))].join('\n'), 'classes.csv', 'text/csv');
  const doExcel = () => downloadBlob(`<table><tr>${exportHeaders.map((h) => `<th>${h}</th>`).join('')}</tr>${exportRows.map((r) => `<tr>${r.map((c) => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('')}</table>`, 'classes.xls', 'application/vnd.ms-excel');
  const colCount = 2 + CLASS_COLUMNS.filter((c) => visibleCols[c.key]).length + 1;

  return (
    <PageLayout title="Classes" subtitle={activeLevel ? `Classes under ${activeLevel.name}` : 'All classes across every academic level'}>
      <Breadcrumb items={[{ label: 'Academic Levels', onClick: () => navigate('/mgmt/academic-levels') }, { label: activeLevel ? activeLevel.name : 'All Classes' }]} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <button onClick={() => { setEditingRow(null); setModal('form'); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
          <Ico ti="ti-school" size={15} /> Add Class
        </button>
        {activeLevel && <BackButton onClick={() => navigate('/mgmt/academic-levels')} label="Back to Levels" />}
        <select value={levelId} onChange={(e) => navigate(e.target.value ? `/mgmt/classes?level=${e.target.value}` : '/mgmt/classes')} style={{ ...selStyle, minWidth: 170 }}>
          <option value="">All Academic Levels</option>{levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={selStyle}>
          <option value="">All Statuses</option>{GENERIC_STATUS_OPTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
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
          <button onClick={() => openPrintTable('Classes', exportHeaders, exportRows)} style={toolBtn(RED)}><Ico ti="ti-file-text" size={13} /> PDF</button>
          <button onClick={() => openPrintTable('Classes', exportHeaders, exportRows)} style={toolBtn(C.ink)}><Ico ti="ti-printer" size={13} /> Print</button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setColMenu((v) => !v)} style={toolBtn(BLUE)}><Ico ti="ti-columns" size={13} /> Column Visibility</button>
            {colMenu && (
              <div onMouseLeave={() => setColMenu(false)} style={{ position: 'absolute', top: '110%', left: 0, zIndex: 20, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,.12)' }}>
                {CLASS_COLUMNS.map((c) => (
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
          <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search class, level, teacher…" style={{ ...inputStyle, paddingLeft: 34 }} />
        </div>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: C.font }}>
          <thead><tr>
            <th style={{ ...th, width: 34 }}><input type="checkbox" checked={allPageSelected} onChange={(e) => toggleAll(e.target.checked)} /></th>
            {visibleCols.name && <th style={th}>CLASS NAME</th>}
            {visibleCols.level_name && <th style={th}>ACADEMIC LEVEL</th>}
            {visibleCols.sections_count && <th style={th}>SECTIONS</th>}
            {visibleCols.students_count && <th style={th}>STUDENTS</th>}
            {visibleCols.teacher && <th style={th}>CLASS TEACHER</th>}
            {visibleCols.status && <th style={th}>STATUS</th>}
            <th style={{ ...th, textAlign: 'right' }}>ACTIONS</th>
          </tr></thead>
          <tbody>
            {classes === null && <tr><td style={{ ...td, textAlign: 'center', color: C.muted2 }} colSpan={colCount}><Ico ti="ti-loader-2" size={18} style={{ animation: 'spin .8s linear infinite' }} /></td></tr>}
            {classes && pageRows.length === 0 && <tr><td style={{ ...td, textAlign: 'center', color: C.muted2 }} colSpan={colCount}>No classes found.</td></tr>}
            {pageRows.map((r) => (
              <tr key={r.id}>
                <td style={td}><input type="checkbox" checked={!!selected[r.id]} onChange={(e) => setSelected((p) => ({ ...p, [r.id]: e.target.checked }))} /></td>
                {visibleCols.name && <td style={{ ...td, whiteSpace: 'normal' }}><button onClick={() => openClass(r)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: C.font, fontWeight: 700, color: BLUE, textAlign: 'left' }}>{r.name}</button></td>}
                {visibleCols.level_name && <td style={td}>{r.level_name}</td>}
                {visibleCols.sections_count && <td style={td}>{r.sections_count > 0 ? r.sections_count : <span style={{ color: C.muted2 }}>None</span>}</td>}
                {visibleCols.students_count && <td style={td}>{r.students_count}</td>}
                {visibleCols.teacher && <td style={td}>{r.teacher || <span style={{ color: C.muted2 }}>Unassigned</span>}</td>}
                {visibleCols.status && <td style={td}>{STATUS_PILL(r.status, { active: { c: GREEN }, inactive: { c: RED } })}</td>}
                <td style={{ ...td, textAlign: 'right' }}>
                  {busyId === r.id ? <Ico ti="ti-loader-2" size={15} style={{ animation: 'spin .8s linear infinite' }} /> : (
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button onClick={() => openClass(r)} title={r.sections_count > 0 ? 'View Sections' : 'View Students'} style={iconBtn(GREEN)}><Ico ti="ti-eye" size={14} /></button>
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

      {classes && filtered.length > 0 && pageSize > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 12, color: C.muted2, fontFamily: C.font }}>Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, filtered.length)} of {filtered.length} entries</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={{ ...toolBtn(C.muted, page === 1) }}>Previous</button>
            <span style={{ fontSize: 12, color: C.ink, fontFamily: C.font, padding: '7px 10px' }}>{page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ ...toolBtn(C.muted, page === totalPages) }}>Next</button>
          </div>
        </div>
      )}

      {modal === 'form' && <ClassFormModal initial={editingRow} levels={levels} defaultLevelId={levelId} onClose={() => { setModal(null); setEditingRow(null); }} onSave={save} />}
      {toastEl(toast)}
    </PageLayout>
  );
}
