import { useState, useEffect, useCallback, useMemo } from 'react';
import { Store, Plus, Edit2, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton, Inp } from '../components/Primitives.jsx';
import { apiGet, apiPost, apiPatch, apiDelete } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, PURPLE, FONT } from '../constants.js';

const KINDS = [
  { key: 'tool',       label: 'Tool' },
  { key: 'asset',      label: 'Asset' },
  { key: 'management', label: 'Management' },
];
// Management listings reuse the `tag` column as a lifecycle flag — the API
// surfaces it as `status` so this page doesn't have to know that.
const MGMT_STATUS = [
  { key: 'active', label: 'Live' },
  { key: 'soon',   label: 'Coming soon' },
];
// Enforced server-side in modules/instructor/tools.js — the instructor and
// school apps share one catalogue endpoint, so this is what separates them.
const AUDIENCES = [
  { key: 'both',        label: 'Instructors + Schools', short: 'Both' },
  { key: 'instructors', label: 'Instructors only',      short: 'Instructors' },
  { key: 'schools',     label: 'Schools only',          short: 'Schools' },
];

const EMPTY = {
  key: '', name: '', kind: 'tool', description: '', emoji: '🛠️',
  tag: '', status: 'active', audience: 'both', priceNaira: '', isActive: true, sortOrder: 0,
};

const ngn = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;

function Pill({ text, color }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 100,
      color, background: `${color}18`, whiteSpace: 'nowrap',
    }}>{text}</span>
  );
}

export default function AppCenterPage() {
  const [items, setItems] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [editing, setEditing] = useState(null);   // null = closed, EMPTY = new
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [toast, setToast] = useState(null);

  const load = useCallback(() => {
    setLoadErr('');
    apiGet('/api/admin/app-center')
      .then((r) => setItems(r.items || []))
      // Don't render an empty catalogue for a failed request — that reads as
      // "nothing is listed", which is a very different thing.
      .catch((e) => { setItems([]); setLoadErr(e?.message || 'Could not load the App Center catalogue'); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNew = () => { setForm(EMPTY); setFormErr(''); setEditing(EMPTY); };
  const openEdit = (it) => {
    setForm({
      key: it.key, name: it.name, kind: it.kind, description: it.description || '',
      emoji: it.emoji || '🛠️', tag: it.tag || '', status: it.status || 'active', audience: it.audience || 'both',
      priceNaira: String(it.priceNaira ?? ''), isActive: it.isActive, sortOrder: it.sortOrder ?? 0,
    });
    setFormErr(''); setEditing(it);
  };

  const save = async (e) => {
    e.preventDefault();
    const priceNaira = Number(form.priceNaira || 0);
    if (!Number.isFinite(priceNaira) || priceNaira < 0) return setFormErr('Price must be 0 or a positive number');
    setBusy(true); setFormErr('');
    // The API stores kobo; the form takes naira so nobody has to multiply by 100.
    const body = {
      name: form.name, kind: form.kind, description: form.description, emoji: form.emoji,
      priceKobo: Math.round(priceNaira * 100), isActive: form.isActive, audience: form.audience,
      sortOrder: Number(form.sortOrder) || 0,
      ...(form.kind === 'management' ? { status: form.status } : { tag: form.tag || null }),
    };
    try {
      if (editing?.id) await apiPatch(`/api/admin/app-center/${editing.id}`, body);
      else await apiPost('/api/admin/app-center', { ...body, key: form.key.trim().toLowerCase() });
      setToast({ message: editing?.id ? 'Listing updated' : 'Listing created', type: 'success' });
      setEditing(null); load();
    } catch (e2) { setFormErr(e2?.message || 'Could not save'); }
    finally { setBusy(false); }
  };

  const toggleActive = async (it) => {
    try {
      await apiPatch(`/api/admin/app-center/${it.id}`, { isActive: !it.isActive });
      setToast({ message: it.isActive ? `${it.name} unlisted` : `${it.name} is now live`, type: 'success' });
      load();
    } catch (e) { setToast({ message: e?.message || 'Could not update', type: 'error' }); }
  };

  const remove = async (it) => {
    if (!window.confirm(`Delete "${it.name}"? This can't be undone.`)) return;
    try { await apiDelete(`/api/admin/app-center/${it.id}`); setToast({ message: 'Listing deleted', type: 'success' }); load(); }
    catch (e) { setToast({ message: e?.message || 'Could not delete', type: 'error' }); }
  };

  const filtered = useMemo(
    () => (items || []).filter((i) => kindFilter === 'all' || i.kind === kindFilter),
    [items, kindFilter],
  );
  const totals = useMemo(() => ({
    listed: (items || []).filter((i) => i.isActive).length,
    hidden: (items || []).filter((i) => !i.isActive).length,
    soon:   (items || []).filter((i) => i.status === 'soon').length,
  }), [items]);

  return (
    <PageLayout title="App Center" subtitle="Everything listed to instructors — pricing, availability and ordering"
      action={<Btn onClick={openNew}><Plus size={15} /> New listing</Btn>}>

      {loadErr && (
        <div style={{ background: '#FEF2F2', border: `1px solid ${RED}44`, color: RED, borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
          {loadErr}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[{ k: 'all', l: 'All' }, ...KINDS.map((k) => ({ k: k.key, l: k.label }))].map(({ k, l }) => (
          <button key={k} onClick={() => setKindFilter(k)} style={{
            padding: '7px 15px', borderRadius: 100, cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 700,
            border: kindFilter === k ? `1.5px solid ${AMBER}` : `1.5px solid ${BORDER}`,
            background: kindFilter === k ? `${AMBER}12` : WHITE, color: kindFilter === k ? AMBER : MUTED,
          }}>{l}</button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, alignItems: 'center', fontSize: 12.5, color: MUTED }}>
          <span><strong style={{ color: GREEN }}>{totals.listed}</strong> live</span>
          <span><strong style={{ color: MUTED2 }}>{totals.hidden}</strong> unlisted</span>
          <span><strong style={{ color: PURPLE }}>{totals.soon}</strong> coming soon</span>
        </div>
      </div>

      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'auto' }}>
        {items === null ? (
          <div style={{ padding: 20 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={44} style={{ marginBottom: 10 }} />)}</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 34, textAlign: 'center', color: MUTED2, fontSize: 13.5 }}>
            {loadErr ? 'Could not load the catalogue.' : 'No listings in this view.'}
          </div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: FONT, minWidth: 880 }}>
            <thead>
              <tr>{['', 'Name', 'Key', 'Kind', 'Available to', 'Price', 'Status', 'Owned by', 'Order', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '11px 14px', fontSize: 11.5, fontWeight: 700, color: MUTED2, background: LIGHT, whiteSpace: 'nowrap' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it.id} style={{ borderTop: `1px solid ${BORDER}`, opacity: it.isActive ? 1 : 0.55 }}>
                  <td style={{ ...td, fontSize: 20 }}>{it.emoji}</td>
                  <td style={{ ...td, fontWeight: 700, color: INK }}>
                    {it.name}
                    {it.description && <div style={{ fontSize: 11.5, color: MUTED2, fontWeight: 400, marginTop: 2, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.description}</div>}
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{it.key}</td>
                  <td style={td}>{KINDS.find((k) => k.key === it.kind)?.label || it.kind}</td>
                  <td style={td}>
                    <Pill text={AUDIENCES.find((a) => a.key === (it.audience || 'both'))?.short || it.audience}
                      color={it.audience === 'schools' ? PURPLE : it.audience === 'instructors' ? AMBER : MUTED} />
                  </td>
                  <td style={{ ...td, fontWeight: 700, color: INK }}>{it.priceKobo === 0 ? <span style={{ color: GREEN }}>Free</span> : ngn(it.priceNaira)}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Pill text={it.isActive ? 'Live' : 'Unlisted'} color={it.isActive ? GREEN : MUTED2} />
                      {it.status === 'soon' && <Pill text="Coming soon" color={PURPLE} />}
                    </div>
                  </td>
                  <td style={td}>{it.purchases > 0 ? `${it.purchases} instructor${it.purchases === 1 ? '' : 's'}` : '—'}</td>
                  <td style={td}>{it.sortOrder}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button onClick={() => toggleActive(it)} title={it.isActive ? 'Unlist' : 'List'} style={iconBtn}>
                      {it.isActive ? <ToggleRight size={17} color={GREEN} /> : <ToggleLeft size={17} color={MUTED2} />}
                    </button>
                    <button onClick={() => openEdit(it)} title="Edit" style={iconBtn}><Edit2 size={15} /></button>
                    <button onClick={() => remove(it)} title="Delete" style={{ ...iconBtn, color: RED }}><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit listing' : 'New listing'} width={520}>
        <form onSubmit={save}>
          {!editing?.id && (
            <Inp label="Key (stable slug — cannot be changed later)" value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="e.g. lesson-plan" required />
          )}
          <Inp label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Inp label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />

          <div style={{ display: 'flex', gap: 12 }}>
            <Inp label="Emoji" value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} containerStyle={{ width: 110 }} />
            <Inp label="Price (₦, 0 = free)" type="number" min="0" step="1" value={form.priceNaira}
              onChange={(e) => setForm({ ...form, priceNaira: e.target.value })} containerStyle={{ flex: 1 }} />
            <Inp label="Sort order" type="number" value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} containerStyle={{ width: 120 }} />
          </div>

          <label style={lbl}>Kind</label>
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} style={sel}>
            {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>

          <label style={lbl}>Available to</label>
          <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} style={sel}>
            {AUDIENCES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>

          {form.kind === 'management' ? (
            <>
              <label style={lbl}>Availability</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} style={sel}>
                {MGMT_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <div style={{ fontSize: 11.5, color: MUTED2, marginTop: 6 }}>“Coming soon” keeps it visible to instructors but not purchasable.</div>
            </>
          ) : (
            <Inp label="Tag (optional pill, e.g. “Voice agent”)" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} />
          )}

          <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Listed in the App Center
          </label>

          {editing?.id && editing.purchases > 0 && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 9, padding: '9px 12px', fontSize: 12, color: '#92400E', marginTop: 10 }}>
              {editing.purchases} instructor{editing.purchases === 1 ? '' : 's'} already own this — a price change only affects new purchases.
            </div>
          )}

          {formErr && <div style={{ color: RED, fontSize: 12.5, fontWeight: 600, marginTop: 10 }}>{formErr}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <Btn type="submit" disabled={busy} style={{ flex: 1 }}>{busy ? 'Saving…' : editing?.id ? 'Save changes' : 'Create listing'}</Btn>
            <Btn type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Btn>
          </div>
        </form>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}

const td = { padding: '12px 14px', fontSize: 13, color: MUTED, verticalAlign: 'top' };
const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', color: MUTED, marginRight: 10, verticalAlign: 'middle' };
const lbl = { display: 'block', fontSize: 12.5, fontWeight: 600, color: INK, margin: '14px 0 6px' };
const sel = { width: '100%', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 14, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box' };
