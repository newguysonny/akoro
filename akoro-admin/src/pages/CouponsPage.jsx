import { useState, useEffect, useCallback } from 'react';
import { Tag, Trash2, Edit2, ToggleLeft, ToggleRight, Plus } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton, Inp } from '../components/Primitives.jsx';
import { apiGet, apiPost, apiPatch, apiDelete } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, FONT } from '../constants.js';

const EMPTY_FORM = {
  code: '',
  discount_type: 'percent',
  discount_value: '',
  max_uses: '',
  valid_from: '',
  valid_until: '',
  is_active: true,
};

function StatusPill({ active }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: active ? '#DCFCE7' : '#F3F4F6',
      color: active ? GREEN : MUTED,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: active ? GREEN : MUTED, display: 'inline-block' }} />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function Field({ label, children, required }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: INK, fontFamily: FONT }}>
        {label}{required && <span style={{ color: RED }}> *</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '10px 14px', borderRadius: 10,
  border: `1.5px solid ${BORDER}`, outline: 'none',
  fontSize: 14, fontFamily: FONT, color: INK, background: WHITE,
  boxSizing: 'border-box',
};

export default function CouponsPage() {
  const [coupons, setCoupons]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [couponModal, setCouponModal] = useState({ open: false, mode: 'create', coupon: null });
  const [deleteModal, setDeleteModal] = useState({ open: false, id: null, code: '' });
  const [form, setForm]             = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState({});
  const [busy, setBusy]             = useState(false);
  const [toast, setToast]           = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet('/api/admin/coupons');
      const arr = Array.isArray(res) ? res : (res?.coupons || res?.data || []);
      setCoupons(arr);
    } catch (err) {
      showToast(err.message || 'Failed to load coupons', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormErrors({});
    setCouponModal({ open: true, mode: 'create', coupon: null });
  };

  const openEdit = (coupon) => {
    setForm({
      code: coupon.code || '',
      discount_type: coupon.discount_type || 'percent',
      discount_value: coupon.discount_value ?? coupon.value ?? '',
      max_uses: coupon.max_uses ?? '',
      valid_from: coupon.valid_from ? coupon.valid_from.slice(0, 10) : '',
      valid_until: coupon.valid_until ? coupon.valid_until.slice(0, 10) : '',
      is_active: coupon.is_active !== false,
    });
    setFormErrors({});
    setCouponModal({ open: true, mode: 'edit', coupon });
  };

  const closeModal = () => {
    setCouponModal({ open: false, mode: 'create', coupon: null });
    setFormErrors({});
  };

  const handleFormChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (formErrors[field]) setFormErrors(prev => ({ ...prev, [field]: null }));
  };

  const validate = () => {
    const errors = {};
    if (!form.code.trim()) errors.code = 'Code is required';
    if (form.discount_value === '' || isNaN(Number(form.discount_value))) errors.discount_value = 'Valid number required';
    return errors;
  };

  const handleSubmit = async () => {
    const errors = validate();
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }

    setBusy(true);
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        discount_type: form.discount_type,
        discount_value: Number(form.discount_value),
        max_uses: form.max_uses === '' || form.max_uses === '0' ? 0 : Number(form.max_uses),
        valid_from: form.valid_from || null,
        valid_until: form.valid_until || null,
        is_active: form.is_active,
      };

      if (couponModal.mode === 'create') {
        const created = await apiPost('/api/admin/coupons', payload);
        setCoupons(prev => [created, ...prev]);
        showToast('Coupon created');
      } else {
        const updated = await apiPatch(`/api/admin/coupons/${couponModal.coupon.id}`, payload);
        setCoupons(prev => prev.map(c => c.id === couponModal.coupon.id ? { ...c, ...updated } : c));
        showToast('Coupon updated');
      }
      closeModal();
    } catch (err) {
      showToast(err.message || 'Operation failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleActive = async (coupon) => {
    try {
      const updated = await apiPatch(`/api/admin/coupons/${coupon.id}`, { is_active: !coupon.is_active });
      setCoupons(prev => prev.map(c => c.id === coupon.id ? { ...c, ...updated, is_active: !coupon.is_active } : c));
      showToast(`Coupon ${!coupon.is_active ? 'activated' : 'deactivated'}`);
    } catch (err) {
      showToast(err.message || 'Failed to update', 'error');
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await apiDelete(`/api/admin/coupons/${deleteModal.id}`);
      setCoupons(prev => prev.filter(c => c.id !== deleteModal.id));
      setDeleteModal({ open: false, id: null, code: '' });
      showToast('Coupon deleted');
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const fmtDate      = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const fmtDiscount  = (c) => c.discount_type === 'percent' ? `${c.discount_value ?? c.value ?? 0}%` : `$${c.discount_value ?? c.value ?? 0}`;

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 13, color: INK, padding: '13px 14px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };

  return (
    <PageLayout
      title="Coupons & Discounts"
      subtitle={`${coupons.length} coupons`}
      action={<Btn onClick={openCreate}><Plus size={15} /> New Coupon</Btn>}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Table */}
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[1,2,3,4,5].map(i => <Skeleton key={i} height={48} />)}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: LIGHT }}>
                  <th style={TH}>Code</th>
                  <th style={TH}>Type</th>
                  <th style={TH}>Value</th>
                  <th style={TH}>Uses</th>
                  <th style={TH}>Valid Until</th>
                  <th style={TH}>Status</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {coupons.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', color: MUTED, borderBottom: 'none' }}>No coupons yet</td></tr>
                ) : coupons.map(c => (
                  <tr key={c.id}
                    onMouseEnter={e => e.currentTarget.style.background = '#FAF8F5'}
                    onMouseLeave={e => e.currentTarget.style.background = WHITE}>
                    <td style={TD}>
                      <span style={{
                        fontFamily: 'monospace', fontWeight: 700, fontSize: 13,
                        background: LIGHT, padding: '3px 8px', borderRadius: 6,
                        border: `1px solid ${BORDER}`, color: INK,
                      }}>{c.code}</span>
                    </td>
                    <td style={{ ...TD, color: MUTED, textTransform: 'capitalize' }}>
                      {c.discount_type || 'percent'}
                    </td>
                    <td style={{ ...TD, fontWeight: 700, color: AMBER }}>{fmtDiscount(c)}</td>
                    <td style={{ ...TD, color: MUTED }}>
                      {(c.used_count || c.uses_used || 0).toLocaleString()}
                      {' / '}
                      {c.max_uses ? c.max_uses.toLocaleString() : '∞'}
                    </td>
                    <td style={{ ...TD, color: MUTED }}>{fmtDate(c.valid_until)}</td>
                    <td style={TD}><StatusPill active={c.is_active !== false} /></td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          title={c.is_active !== false ? 'Deactivate' : 'Activate'}
                          onClick={() => handleToggleActive(c)}
                          style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            padding: '6px', display: 'inline-flex', alignItems: 'center',
                            color: c.is_active !== false ? GREEN : MUTED,
                          }}
                        >
                          {c.is_active !== false
                            ? <ToggleRight size={18} />
                            : <ToggleLeft size={18} />
                          }
                        </button>
                        <Btn size="sm" variant="secondary" onClick={() => openEdit(c)}>
                          <Edit2 size={13} />
                        </Btn>
                        <Btn
                          size="sm" variant="danger"
                          onClick={() => setDeleteModal({ open: true, id: c.id, code: c.code })}
                        >
                          <Trash2 size={13} />
                        </Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>

      {/* Create / Edit modal */}
      <Modal
        open={couponModal.open}
        onClose={closeModal}
        title={couponModal.mode === 'create' ? 'New Coupon' : 'Edit Coupon'}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <Inp
            label="Code"
            value={form.code}
            onChange={e => handleFormChange('code', e.target.value.toUpperCase())}
            placeholder="e.g. SUMMER20"
            error={formErrors.code}
            required
          />

          <Field label="Discount Type">
            <select
              value={form.discount_type}
              onChange={e => handleFormChange('discount_type', e.target.value)}
              style={inputStyle}
            >
              <option value="percent">Percent (%)</option>
              <option value="fixed">Fixed ($)</option>
            </select>
          </Field>

          <Inp
            label="Discount Value"
            type="number"
            min="0"
            step="0.01"
            value={form.discount_value}
            onChange={e => handleFormChange('discount_value', e.target.value)}
            placeholder={form.discount_type === 'percent' ? 'e.g. 20' : 'e.g. 15.00'}
            error={formErrors.discount_value}
          />

          <Inp
            label="Max Uses (0 = unlimited)"
            type="number"
            min="0"
            value={form.max_uses}
            onChange={e => handleFormChange('max_uses', e.target.value)}
            placeholder="0"
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Valid From">
              <input
                type="date"
                value={form.valid_from}
                onChange={e => handleFormChange('valid_from', e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Valid Until">
              <input
                type="date"
                value={form.valid_until}
                onChange={e => handleFormChange('valid_until', e.target.value)}
                style={inputStyle}
              />
            </Field>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => handleFormChange('is_active', e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer', accentColor: AMBER }}
            />
            <span style={{ fontSize: 13, color: INK, fontFamily: FONT, fontWeight: 500 }}>Active</span>
          </label>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8 }}>
            <Btn variant="secondary" onClick={closeModal}>Cancel</Btn>
            <Btn variant="primary" disabled={busy} onClick={handleSubmit}>
              {busy ? 'Saving…' : couponModal.mode === 'create' ? 'Create Coupon' : 'Save Changes'}
            </Btn>
          </div>

        </div>
      </Modal>

      {/* Delete confirm modal */}
      <Modal open={deleteModal.open} onClose={() => setDeleteModal({ open: false, id: null, code: '' })} title="Delete Coupon">
        <p style={{ fontSize: 14, color: INK, fontFamily: FONT, margin: '0 0 20px', lineHeight: 1.6 }}>
          Are you sure you want to delete coupon <strong>{deleteModal.code}</strong>? This action cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setDeleteModal({ open: false, id: null, code: '' })}>Cancel</Btn>
          <Btn variant="danger" disabled={!!busy} onClick={confirmDelete}>{busy ? 'Deleting…' : 'Delete'}</Btn>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
