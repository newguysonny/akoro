/**
 * Manage Periods — class-first. Shows the class list; opening a class shows
 * that class's own periods (each class can have a different daily schedule).
 * Periods carry a type (teaching, break, …) alongside name / start / end.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Clock3, Search, Eye, Pencil, Trash2, Loader2, CheckSquare, Plus } from 'lucide-react';
import { PageLayout } from '../../../components/Layout.jsx';
import BackButton from '../../../components/BackButton.jsx';
import { inputStyle } from '../../../components/mgmt/ResourcePage.jsx';
import { apiGet, apiPost, apiPut, apiDelete } from '../../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../../constants.js';
import { BASE, Breadcrumb, th, td, iconBtn, toastEl } from './shared.jsx';
import { confirmDialog } from '../../../components/ConfirmHost.jsx';

const PERIOD_TYPES = [
  { value: 'teaching', label: 'Teaching', c: BLUE },
  { value: 'break', label: 'Break', c: AMBER },
  { value: 'lunch', label: 'Lunch', c: GREEN },
  { value: 'assembly', label: 'Assembly', c: PURPLE },
  { value: 'other', label: 'Other', c: MUTED2 },
];
const typeMeta = (v) => PERIOD_TYPES.find((t) => t.value === v) || PERIOD_TYPES[PERIOD_TYPES.length - 1];
const TypePill = ({ v }) => { const m = typeMeta(v); return <span style={{ padding: '3px 10px', borderRadius: 999, background: `${m.c}15`, color: m.c, fontSize: 11, fontWeight: 800 }}>{m.label}</span>; };
const hhmm = (t) => (t ? String(t).slice(0, 5) : '—');
const lbl = { fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT, display: 'block', margin: '10px 0 5px' };

function PeriodFormModal({ initial, onClose, onSave }) {
  const isEdit = !!initial;
  const [form, setForm] = useState(initial || { name: '', type: 'teaching', starts_at: '', ends_at: '', sort_order: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const canSave = form.name?.trim();
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: WHITE, borderRadius: 16, padding: '20px 22px', fontFamily: FONT }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: INK, marginBottom: 10 }}>{isEdit ? 'Edit Period' : 'Add Period'}</div>
        <label style={lbl}>Period Name</label>
        <input value={form.name} onChange={set('name')} placeholder="e.g. 1st Period" style={inputStyle} />
        <label style={lbl}>Type</label>
        <select value={form.type} onChange={set('type')} style={inputStyle}>{PERIOD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><label style={lbl}>Starts At</label><input type="time" value={form.starts_at || ''} onChange={set('starts_at')} style={inputStyle} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>Ends At</label><input type="time" value={form.ends_at || ''} onChange={set('ends_at')} style={inputStyle} /></div>
          <div style={{ width: 90 }}><label style={lbl}>Order</label><input type="number" value={form.sort_order} onChange={set('sort_order')} style={inputStyle} /></div>
        </div>
        <button onClick={() => canSave && onSave(form)} disabled={!canSave} style={{ width: '100%', marginTop: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: !canSave ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: !canSave ? '#9CA3AF' : WHITE, fontSize: 13.5, fontWeight: 800, cursor: !canSave ? 'default' : 'pointer', fontFamily: FONT }}>
          <CheckSquare size={14} /> {isEdit ? 'Save Changes' : 'Add Period'}
        </button>
      </div>
    </div>
  );
}

export function ManagePeriodsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const classId = params.get('class') || '';
  const [classes, setClasses] = useState(null);
  const [periods, setPeriods] = useState(null);
  const [allPeriods, setAllPeriods] = useState([]);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [modal, setModal] = useState(null);
  const [editingRow, setEditingRow] = useState(null);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const loadClasses = useCallback(() => {
    Promise.all([
      apiGet(`${BASE}/classes`).then((r) => r.data || []),
      apiGet(`${BASE}/periods`).then((r) => r.data || []).catch(() => []),
    ]).then(([cl, pe]) => { setClasses(cl); setAllPeriods(pe); }).catch(() => setClasses([]));
  }, []);
  const loadPeriods = useCallback(() => {
    if (!classId) return;
    setPeriods(null);
    apiGet(`${BASE}/periods?class_id=${classId}`).then((r) => setPeriods(r.data || [])).catch(() => setPeriods([]));
  }, [classId]);
  useEffect(() => { loadClasses(); }, [loadClasses]);
  useEffect(() => { loadPeriods(); }, [loadPeriods]);

  const activeClass = (classes || []).find((c) => c.id === classId);

  const save = async (form) => {
    const body = { class_id: classId, name: form.name.trim(), type: form.type || 'teaching', starts_at: form.starts_at || null, ends_at: form.ends_at || null, sort_order: Number(form.sort_order) || 0 };
    try {
      if (editingRow) await apiPut(`${BASE}/periods/${editingRow.id}`, body);
      else await apiPost(`${BASE}/periods`, body);
      showToast('Saved ✓'); setModal(null); setEditingRow(null); loadPeriods();
    } catch (e) { showToast(e.message || 'Could not save'); }
  };
  const remove = async (r) => {
    if (!await confirmDialog(`Remove period "${r.name}"?`)) return;
    setBusyId(r.id);
    try { await apiDelete(`${BASE}/periods/${r.id}`); showToast('Removed'); loadPeriods(); }
    catch (e) { showToast(e.message || 'Could not remove'); } finally { setBusyId(null); }
  };

  /* ── Class list view ─────────────────────────────────────────────── */
  if (!classId) {
    const q = query.trim().toLowerCase();
    const rows = (classes || []).filter((c) => !q || String(c.name || '').toLowerCase().includes(q));
    const countFor = (id) => allPeriods.filter((p) => p.class_id === id).length;
    return (
      <PageLayout title="Manage Periods" subtitle="Each class can have its own daily periods — open a class to manage them">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <div style={{ position: 'relative', minWidth: 220 }}>
            <Search size={15} color={MUTED2} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search classes…" style={{ ...inputStyle, paddingLeft: 34 }} />
          </div>
        </div>
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
            <thead><tr><th style={th}>CLASS</th><th style={th}>PERIODS</th><th style={{ ...th, textAlign: 'right' }}>ACTIONS</th></tr></thead>
            <tbody>
              {classes === null && <tr><td style={{ ...td, textAlign: 'center', color: MUTED2 }} colSpan={3}><Loader2 size={18} style={{ animation: 'spin .8s linear infinite' }} /></td></tr>}
              {classes && rows.length === 0 && <tr><td style={{ ...td, textAlign: 'center', color: MUTED2 }} colSpan={3}>No classes found.</td></tr>}
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={{ ...td, whiteSpace: 'normal' }}><button onClick={() => navigate(`/mgmt/periods?class=${c.id}`)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: FONT, fontWeight: 700, color: BLUE, textAlign: 'left' }}>{c.name}</button></td>
                  <td style={td}>{countFor(c.id) || <span style={{ color: MUTED2 }}>None</span>}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button onClick={() => navigate(`/mgmt/periods?class=${c.id}`)} title="Manage Periods" style={iconBtn(GREEN)}><Eye size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {toastEl(toast)}
      </PageLayout>
    );
  }

  /* ── Single class periods view ───────────────────────────────────── */
  const q = query.trim().toLowerCase();
  const rows = (periods || []).filter((p) => !q || [p.name, p.type].some((v) => String(v || '').toLowerCase().includes(q)));
  return (
    <PageLayout title={`${activeClass?.name || 'Class'} — Periods`} subtitle="Daily lesson periods and breaks for this class">
      <Breadcrumb items={[{ label: 'Manage Periods', onClick: () => navigate('/mgmt/periods') }, { label: activeClass?.name || '…' }]} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <button onClick={() => { setEditingRow(null); setModal('form'); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          <Plus size={15} /> Add Period
        </button>
        <BackButton onClick={() => navigate('/mgmt/periods')} label="Back to Classes" />
        <div style={{ position: 'relative', marginLeft: 'auto', minWidth: 200 }}>
          <Search size={15} color={MUTED2} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search period, type…" style={{ ...inputStyle, paddingLeft: 34 }} />
        </div>
      </div>

      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
          <thead><tr>
            <th style={th}>ID</th><th style={th}>PERIOD</th><th style={th}>TYPE</th><th style={th}>START</th><th style={th}>END</th><th style={th}>ORDER</th><th style={{ ...th, textAlign: 'right' }}>ACTIONS</th>
          </tr></thead>
          <tbody>
            {periods === null && <tr><td style={{ ...td, textAlign: 'center', color: MUTED2 }} colSpan={7}><Loader2 size={18} style={{ animation: 'spin .8s linear infinite' }} /></td></tr>}
            {periods && rows.length === 0 && <tr><td style={{ ...td, textAlign: 'center', color: MUTED2 }} colSpan={7}>No periods for this class yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5, color: MUTED2 }}>{String(r.id).slice(0, 8)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{r.name}</td>
                <td style={td}><TypePill v={r.type || 'teaching'} /></td>
                <td style={td}>{hhmm(r.starts_at)}</td>
                <td style={td}>{hhmm(r.ends_at)}</td>
                <td style={td}>{r.sort_order}</td>
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

      {modal === 'form' && <PeriodFormModal initial={editingRow} onClose={() => { setModal(null); setEditingRow(null); }} onSave={save} />}
      {toastEl(toast)}
    </PageLayout>
  );
}
