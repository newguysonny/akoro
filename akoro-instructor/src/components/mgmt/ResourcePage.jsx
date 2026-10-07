/**
 * ResourcePage — generic CRUD page for /api/school/mgmt/:resource.
 *
 * Config-driven: columns (table), fields (create/edit modal form), optional
 * toolbar filters, fixed filters, and per-action toggles. Selects can load
 * their options from another mgmt resource (optionsFrom).
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Pencil, Trash2, Search, Loader2, X, Save } from 'lucide-react';
import { PageLayout } from '../Layout.jsx';
import { apiGet, apiPost, apiPut, apiDelete } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, FONT } from '../../constants.js';

const BASE = '/api/school/mgmt';

export const inputStyle = {
  width: '100%', padding: '9px 12px', borderRadius: 9, border: `1.5px solid ${BORDER}`,
  outline: 'none', fontSize: 13, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box',
};

export function FieldInput({ field, value, onChange, optionLists }) {
  const v = value ?? '';
  if (field.type === 'select') {
    const opts = field.options || optionLists[field.key] || [];
    return (
      <select value={v} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
        <option value="">— select —</option>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (field.type === 'textarea') return <textarea rows={3} value={v} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} style={{ ...inputStyle, resize: 'vertical' }} />;
  if (field.type === 'toggle') return (
    <button onClick={() => onChange(!value)} style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}>
      <span style={{ display: 'inline-block', width: 40, height: 22, borderRadius: 999, background: value ? GREEN : '#D8D5CE', position: 'relative', transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: 2.5, left: value ? 20 : 2.5, width: 17, height: 17, borderRadius: '50%', background: WHITE, transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
      </span>
    </button>
  );
  return <input type={field.type || 'text'} value={v} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} style={inputStyle} />;
}

export function cellValue(row, col) {
  if (col.render) return col.render(row);
  const v = row[col.key];
  if (v === null || v === undefined || v === '') return <span style={{ color: MUTED2 }}>—</span>;
  if (typeof v === 'boolean') return (
    <span style={{ padding: '3px 9px', borderRadius: 999, background: v ? `${GREEN}15` : LIGHT, color: v ? GREEN : MUTED2, fontSize: 11, fontWeight: 800 }}>{v ? 'Yes' : 'No'}</span>
  );
  return String(v);
}

export default function ResourcePage({
  title, subtitle, resource, columns, fields = [],
  listFilters = [], fixedFilters = {}, searchKeys,
  canCreate = true, canEdit = true, canDelete = true,
  createLabel = 'New Record', startOpen = false, embedded = false,
  rowActions = [],
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({});
  const [modal, setModal] = useState(startOpen ? {} : null);   // {} = new, {row} = edit
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [optionLists, setOptionLists] = useState({});
  const [toast, setToast] = useState('');

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ ...fixedFilters, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
    apiGet(`${BASE}/${resource}${params.toString() ? `?${params}` : ''}`)
      .then((res) => setRows(res.data || []))
      .catch((e) => showToast(e.message || 'Could not load'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, JSON.stringify(filters)]);

  useEffect(() => { load(); }, [load]);

  // Load select options declared via optionsFrom (fields + toolbar filters).
  // optionsFrom: { resource } for mgmt resources, or { url } for any endpoint.
  useEffect(() => {
    const sources = [...fields, ...listFilters].filter((f) => f.optionsFrom);
    sources.forEach((f) => {
      const url = f.optionsFrom.url || `${BASE}/${f.optionsFrom.resource}`;
      apiGet(url).then((res) => {
        const opts = (res.data || []).map((r) => ({
          value: r.id,
          label: f.optionsFrom.labelFn ? f.optionsFrom.labelFn(r) : r[f.optionsFrom.labelKey || 'name'],
        }));
        setOptionLists((prev) => ({ ...prev, [f.key]: opts }));
      }).catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource]);

  const editValue = (f, v) => {
    if (v === null || v === undefined) return f.type === 'toggle' ? false : '';
    if (f.type === 'datetime-local') return String(v).slice(0, 16); // ISO → input format
    return v;
  };
  const openNew = () => { setForm(Object.fromEntries(fields.map((f) => [f.key, f.default ?? (f.type === 'toggle' ? false : '')]))); setModal({}); };
  const openEdit = (row) => { setForm(Object.fromEntries(fields.map((f) => [f.key, editValue(f, row[f.key])]))); setModal({ row }); };

  useEffect(() => { if (startOpen) openNew(); /* eslint-disable-next-line */ }, []);

  const save = async () => {
    for (const f of fields) {
      if (f.required && (form[f.key] === '' || form[f.key] === null || form[f.key] === undefined)) {
        return showToast(`${f.label} is required`);
      }
    }
    setSaving(true);
    try {
      if (modal?.row) {
        const res = await apiPut(`${BASE}/${resource}/${modal.row.id}`, form);
        setRows((prev) => prev.map((r) => (r.id === modal.row.id ? res.data : r)));
      } else {
        // New rows inherit the page's fixed scope (e.g. staff_class / staff_group)
        const res = await apiPost(`${BASE}/${resource}`, { ...fixedFilters, ...form });
        setRows((prev) => [res.data, ...prev]);
      }
      setModal(null);
      showToast('Saved ✓');
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  const remove = async (row) => {
    setBusyId(row.id);
    try {
      await apiDelete(`${BASE}/${resource}/${row.id}`);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      showToast('Deleted');
    } catch (e) { showToast(e.message || 'Could not delete'); }
    finally { setBusyId(null); }
  };

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return rows;
    const keys = searchKeys || columns.map((c) => c.key);
    return rows.filter((r) => keys.some((k) => String(r[k] ?? '').toLowerCase().includes(q)));
  }, [rows, q, searchKeys, columns]);

  // embedded = render inside another PageLayout (no wrapper of its own)
  const Wrapper = embedded ? ({ children }) => <div>{children}</div> : PageLayout;
  return (
    <Wrapper title={title} subtitle={subtitle}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
          <Search size={15} color={MUTED2} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" style={{ ...inputStyle, paddingLeft: 34 }} />
        </div>
        {listFilters.map((f) => (
          <select key={f.key} value={filters[f.key] || ''} onChange={(e) => setFilters((p) => ({ ...p, [f.key]: e.target.value }))} style={{ ...inputStyle, width: 'auto', minWidth: 140, cursor: 'pointer' }}>
            <option value="">{f.label}: All</option>
            {(f.options || optionLists[f.key] || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        {canCreate && (
          <button onClick={openNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
            <Plus size={14} /> {createLabel}
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '36px 0', textAlign: 'center', color: MUTED2 }}><Loader2 size={18} style={{ animation: 'spin .8s linear infinite' }} /></div>
        ) : visible.length === 0 ? (
          <div style={{ padding: '36px 18px', textAlign: 'center', color: MUTED2, fontSize: 13, fontFamily: FONT }}>No records yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, minWidth: 560 }}>
              <thead>
                <tr style={{ background: LIGHT }}>
                  {columns.map((c) => <th key={c.key} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .4, whiteSpace: 'nowrap' }}>{c.label.toUpperCase()}</th>)}
                  {(canEdit || canDelete || rowActions.length > 0) && <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: MUTED2 }}>ACTIONS</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                    {columns.map((c) => <td key={c.key} style={{ padding: '11px 14px', fontSize: 12.5, color: INK }}>{cellValue(row, c)}</td>)}
                    {(canEdit || canDelete || rowActions.length > 0) && (
                      <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          {rowActions.map((a, i) => (
                            <button key={i} onClick={() => a.onClick(row)} disabled={busyId === row.id} title={a.title}
                              style={{ height: 28, padding: a.label ? '0 10px' : 0, width: a.label ? 'auto' : 28, borderRadius: 7, border: 'none', background: `${a.color || MUTED2}15`, color: a.color || MUTED2, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 12, fontWeight: 700, fontFamily: FONT }}>
                              {a.icon}{a.label ? <span>{a.label}</span> : null}
                            </button>
                          ))}
                          {canEdit && <button onClick={() => openEdit(row)} style={{ width: 28, height: 28, borderRadius: 7, border: 'none', background: `${BLUE}15`, color: BLUE, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Pencil size={13} /></button>}
                          {canDelete && (
                            <button onClick={() => remove(row)} disabled={busyId === row.id} style={{ width: 28, height: 28, borderRadius: 7, border: 'none', background: `${RED}12`, color: RED, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                              {busyId === row.id ? <Loader2 size={12} style={{ animation: 'spin .8s linear infinite' }} /> : <Trash2 size={13} />}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      {modal && (
        <div onClick={() => setModal(null)} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto', background: WHITE, borderRadius: 18, padding: '22px 22px 24px', boxShadow: '0 12px 48px rgba(0,0,0,.22)', fontFamily: FONT }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <p style={{ fontSize: 15.5, fontWeight: 800, color: INK, margin: 0 }}>{modal.row ? `Edit ${title}` : createLabel}</p>
              <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED2 }}><X size={18} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 13 }}>
              {fields.map((f) => (
                <div key={f.key} style={{ gridColumn: f.full ? '1 / -1' : 'auto' }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: INK, display: 'block', marginBottom: 5 }}>
                    {f.label} {f.required && <span style={{ color: RED }}>*</span>}
                  </label>
                  <FieldInput field={f} value={form[f.key]} onChange={(v) => setForm((p) => ({ ...p, [f.key]: v }))} optionLists={optionLists} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setModal(null)} style={{ padding: '10px 18px', borderRadius: 10, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 20px', borderRadius: 10, border: 'none', background: saving ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: saving ? '#9CA3AF' : WHITE, fontSize: 13, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>
                {saving ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={14} />} {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </Wrapper>
  );
}
