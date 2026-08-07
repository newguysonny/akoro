import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Pencil, Archive, RotateCcw, X } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { useStartup } from '../contexts/StartupContext.jsx';
import { apiGet, apiPost, apiPatch, apiDelete } from '../services/api.js';
import { INK, MUTED, MUTED2, BORDER, WHITE, LIGHT, GREEN, RED, ACCENT, FONT } from '../constants.js';
import { confirmDialog } from '../components/ConfirmHost.jsx';

const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
const EMPTY = { name: '', credits: 1000, price_usd: 0.65, min_order_qty: 1, billing_period: 'one_time', description: '', image_url: '' };
const BILLING_LABELS = { one_time: 'One-time', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

export default function VoucherProductsPage() {
  const { current } = useStartup();
  const [products, setProducts] = useState(null);
  const [editing, setEditing] = useState(null);   // null = closed, {} = new, {...} = edit
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    if (!current) return;
    apiGet(`/api/vouchers/startups/${current.id}/products`).then((r) => setProducts(r.products || [])).catch(() => setProducts([]));
  }, [current]);
  useEffect(() => { load(); }, [load]);

  const toggleArchive = async (p) => {
    try { await apiPatch(`/api/vouchers/startups/${current.id}/products/${p.id}`, { status: p.status === 'active' ? 'archived' : 'active' }); load(); }
    catch (e) { setErr(e.message || 'Could not update'); }
  };
  const remove = async (p) => {
    if (!await confirmDialog(`Delete "${p.name}"? This only works if it has never been ordered.`)) return;
    try { await apiDelete(`/api/vouchers/startups/${current.id}/products/${p.id}`); load(); }
    catch (e) { setErr(e.message || 'Could not delete — it may already have order history. Archive it instead.'); }
  };

  if (!current) return null;
  return (
    <PageLayout title="Voucher Products" subtitle="Fixed-price denominations agents can buy, alongside your custom-amount rate"
      action={<button onClick={() => setEditing(EMPTY)} style={primaryBtn}><Plus size={14} /> New product</button>}>

      {err && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: RED, borderRadius: 10, padding: '10px 14px', fontSize: 12.5, fontWeight: 700, marginBottom: 16 }}>{err}</div>}

      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'auto' }}>
        {products === null ? <div style={{ padding: 30, color: MUTED2 }}>Loading…</div> : products.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: MUTED2, fontSize: 13 }}>No voucher products yet — create one to sell fixed denominations.</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: FONT, minWidth: 720 }}>
            <thead>
              <tr>{['', 'Name', 'Billing', 'Credits', 'Price', 'Min order', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 800, color: MUTED2, background: LIGHT }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={{ padding: '10px 0 10px 16px' }}>
                    <div style={{ width: 40, height: 40, borderRadius: 8, overflow: 'hidden', background: LIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                      {p.image_url ? <img src={p.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : '🎟️'}
                    </div>
                  </td>
                  <td style={{ ...td, fontWeight: 700, color: INK }}>{p.name}</td>
                  <td style={td}>{BILLING_LABELS[p.billing_period] || 'One-time'}</td>
                  <td style={td}>{p.credits.toLocaleString()}</td>
                  <td style={{ ...td, fontWeight: 700, color: INK }}>{usd(p.price_usd)}</td>
                  <td style={td}>{p.min_order_qty}</td>
                  <td style={td}>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 100, color: p.status === 'active' ? GREEN : MUTED2, background: p.status === 'active' ? `${GREEN}14` : `${MUTED2}14` }}>{p.status}</span>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button onClick={() => setEditing(p)} title="Edit" style={iconBtn}><Pencil size={15} /></button>
                    <button onClick={() => toggleArchive(p)} title={p.status === 'active' ? 'Archive' : 'Reactivate'} style={iconBtn}>
                      {p.status === 'active' ? <Archive size={15} /> : <RotateCcw size={15} />}
                    </button>
                    <button onClick={() => remove(p)} title="Delete" style={{ ...iconBtn, color: RED }}><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && <ProductModal startupId={current.id} product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </PageLayout>
  );
}

function ProductModal({ startupId, product, onClose, onSaved }) {
  const isNew = !product.id;
  const [form, setForm] = useState({
    name: product.name, credits: product.credits, price_usd: product.price_usd, min_order_qty: product.min_order_qty,
    billing_period: product.billing_period || 'one_time', description: product.description || '', image_url: product.image_url || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      if (isNew) await apiPost(`/api/vouchers/startups/${startupId}/products`, form);
      else await apiPatch(`/api/vouchers/startups/${startupId}/products/${product.id}`, form);
      onSaved();
    } catch (e2) { setErr(e2.message || 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(17,12,40,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={save} style={{ width: '100%', maxWidth: 420, maxHeight: '90vh', overflowY: 'auto', background: WHITE, borderRadius: 16, padding: 24, fontFamily: FONT }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: INK }}>{isNew ? 'New voucher product' : 'Edit product'}</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}><X size={18} /></button>
        </div>

        <label style={lbl}>Name</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required style={inp} placeholder="e.g. ₦1,000 Voucher" />

        <label style={lbl}>Image URL</label>
        <input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} style={inp} placeholder="https://..." />
        {form.image_url && (
          <div style={{ marginTop: 8, width: 72, height: 72, borderRadius: 10, overflow: 'hidden', border: `1px solid ${BORDER}` }}>
            <img src={form.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          </div>
        )}

        <label style={lbl}>Description</label>
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} maxLength={200}
          style={{ ...inp, resize: 'vertical', fontFamily: FONT }} placeholder="What the agent/customer is getting" />

        <label style={lbl}>Billing period</label>
        <select value={form.billing_period} onChange={(e) => setForm({ ...form, billing_period: e.target.value })} style={inp}>
          {Object.entries(BILLING_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>

        <label style={lbl}>Credits granted per code</label>
        <input type="number" min="1" value={form.credits} onChange={(e) => setForm({ ...form, credits: Number(e.target.value) })} required style={inp} />

        <label style={lbl}>Price (USD)</label>
        <input type="number" step="0.01" min="0.01" value={form.price_usd} onChange={(e) => setForm({ ...form, price_usd: Number(e.target.value) })} required style={inp} />

        <label style={lbl}>Minimum order quantity</label>
        <input type="number" min="1" value={form.min_order_qty} onChange={(e) => setForm({ ...form, min_order_qty: Number(e.target.value) })} required style={inp} />

        {err && <div style={{ color: RED, fontSize: 12.5, fontWeight: 700, margin: '10px 0' }}>{err}</div>}
        <button type="submit" disabled={busy} style={{ ...primaryBtn, width: '100%', justifyContent: 'center', marginTop: 14, padding: 12 }}>
          {busy ? 'Saving…' : isNew ? 'Create product' : 'Save changes'}
        </button>
      </form>
    </div>
  );
}

const td = { padding: '12px 16px', fontSize: 12.5, color: MUTED };
const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', color: MUTED, marginRight: 12 };
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 9, border: 'none', background: ACCENT, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT };
const lbl = { display: 'block', fontSize: 11.5, fontWeight: 700, color: MUTED2, margin: '12px 0 4px' };
const inp = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 9, border: `1px solid ${BORDER}`, fontSize: 13.5, fontFamily: FONT, outline: 'none' };
