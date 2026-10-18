import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPost, apiPatch } from '../services/api.js';
import { refId, fmtDate, Pagination, Filters, Modal } from './billing/bits.jsx';

/**
 * BillingCouponsPage — discount codes for paid plans (plan §4.6 Phase 3).
 * Exact conversion of the prototype's Coupons panel + detail, backed by:
 *
 *   GET   /api/admin/billing/coupons           list (with redemption counts)
 *   POST  /api/admin/billing/coupons           create
 *   PATCH /api/admin/billing/coupons/:id       { action: pause | resume | end }
 *   GET   /api/admin/billing/coupons/:id       detail + redemptions
 *
 * Coupons are applied from a subscription's page, not here. Status rules and
 * display text mirror lib/couponModel.js (contract-tested server-side).
 */

const PAGE_SIZE = 5;

const STATUS = {
  active:    { label: 'Active',         cls: 'ak-badge-s-active' },
  paused:    { label: 'Paused',         cls: 'ak-badge-s-paused' },
  expired:   { label: 'Expired',        cls: 'ak-badge-s-canceled' },
  exhausted: { label: 'Fully redeemed', cls: 'ak-badge-s-trial' },
};

const todayStr = () => new Date().toISOString().slice(0, 10);

function couponStatus(c) {
  if (c.paused) return 'paused';
  if (c.expires_at && c.expires_at < todayStr()) return 'expired';
  if (c.max_redemptions && c.redeemed >= c.max_redemptions) return 'exhausted';
  return 'active';
}

function couponText(c) {
  const amt = c.type === 'percent' ? `${c.value}% off` : `₦${Number(c.value).toLocaleString()} off`;
  const dur = c.duration === 'once' ? 'first payment' : c.duration === 'forever' ? 'forever' : `for ${c.months} months`;
  return `${amt}, ${dur}`;
}

export default function BillingCouponsPage() {
  const navigate = useNavigate();

  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState('');
  const [coupons, setCoupons]   = useState([]);
  const [search, setSearch]     = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage]         = useState(1);

  const [selected, setSelected] = useState(null);   // detail (with redemptions)
  const [endArmed, setEndArmed] = useState(false);

  const [addOpen, setAddOpen]   = useState(false);
  const [addForm, setAddForm]   = useState(null);

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1400);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const load = useCallback(async () => {
    try {
      setLoadError('');
      const res = await apiGet('/api/admin/billing/coupons');
      setCoupons(res.data ?? []);
    } catch (e) {
      setLoadError(e.message || 'Could not load coupons.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  /* ── list filtering (exact prototype semantics) ─────────────────────────── */
  const q = search.toLowerCase();
  const filtered = coupons
    .filter((c) => c.code.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q))
    .filter((c) => statusFilter === 'all' || couponStatus(c) === statusFilter);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const items = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  /* ── detail ─────────────────────────────────────────────────────────────── */
  const openDetail = async (c) => {
    try {
      const res = await apiGet(`/api/admin/billing/coupons/${c.id}`);
      setSelected(res.data);
      setEndArmed(false);
    } catch (e) {
      showToast(e.message || 'Could not load the coupon.');
    }
  };

  const couponAction = async (action) => {
    try {
      await apiPatch(`/api/admin/billing/coupons/${selected.id}`, { action });
      if (action === 'end') setEndArmed(false);
      await load();
      await openDetail({ id: selected.id });
      showToast(`${selected.code} updated`);
    } catch (e) {
      showToast(e.message || 'Could not update the coupon.');
    }
  };

  /* ── create ─────────────────────────────────────────────────────────────── */
  const openCouponModal = () => setAddForm({
    code: '', max_redemptions: '', description: '',
    type: 'percent', value: '', duration: 'once', months: 3,
    expires_at: '', first_time_only: false,
  });

  const submitCoupon = async () => {
    try {
      await apiPost('/api/admin/billing/coupons', {
        code: addForm.code,
        description: addForm.description || null,
        type: addForm.type,
        value: Number(addForm.value),
        duration: addForm.duration,
        months: addForm.duration === 'repeating' ? Number(addForm.months) : null,
        max_redemptions: addForm.max_redemptions === '' ? null : Number(addForm.max_redemptions),
        expires_at: addForm.expires_at || null,
        first_time_only: addForm.first_time_only,
      });
      setAddOpen(false);
      setPage(1);
      await load();
      showToast(`${addForm.code.trim().toUpperCase()} created`);
    } catch (e) {
      showToast(e.message || 'Could not create the coupon.');
    }
  };

  /* ── render ─────────────────────────────────────────────────────────────── */
  const detailStatus = selected ? couponStatus(selected) : null;

  return (
    <PageLayout title="Coupons" subtitle="Discount codes for paid plans"
      action={<button className="ak-btn" onClick={() => { openCouponModal(); setAddOpen(true); }}>+ New coupon</button>}>
      <div className="ak-page">

        {selected ? (
          /* ══════════ COUPON DETAIL ══════════ */
          <>
            <button className="ak-back-link" onClick={() => setSelected(null)}>← Back to Coupons</button>
            <div className="ak-detail-head">
              <div>
                <h1 className="ak-h1">{selected.code}</h1>
                <p className="ak-sub !mt-1.5 !mb-0">
                  <span className={`ak-badge ${STATUS[detailStatus].cls}`}>{STATUS[detailStatus].label}</span>
                  {'  '}{selected.description}{selected.first_time_only ? ' · new customers only' : ''}
                </p>
              </div>
              <div className="ak-detail-actions">
                {detailStatus === 'active' || detailStatus === 'paused' ? (
                  <>
                    {detailStatus === 'active'
                      ? <button className="ak-btn ak-btn-ghost ak-btn-small" onClick={() => couponAction('pause')}>Pause</button>
                      : <button className="ak-btn ak-btn-ghost ak-btn-small" onClick={() => couponAction('resume')}>Resume</button>}
                    {endArmed ? (
                  <>
                    <button className="ak-btn ak-btn-danger ak-btn-small" onClick={() => couponAction('end')}>Confirm end</button>
                    <button className="ak-btn ak-btn-ghost ak-btn-small" onClick={() => setEndArmed(false)}>Keep</button>
                  </>
                ) : (
                  <button className="ak-btn ak-btn-danger ak-btn-small" onClick={() => setEndArmed(true)}>End coupon now</button>
                )}
                  </>
                ) : (
                  <span className="ak-sub !mb-0">No actions available.</span>
                )}
              </div>
            </div>

            <div className="ak-stat-row">
              <div className="ak-stat"><div className="ak-stat-label">Discount</div><div className="ak-stat-value !text-[1.05rem]">{couponText(selected)}</div></div>
              <div className="ak-stat"><div className="ak-stat-label">Redeemed</div><div className="ak-stat-value">{selected.redeemed}{selected.max_redemptions ? ` / ${selected.max_redemptions}` : ''}</div></div>
              <div className="ak-stat"><div className="ak-stat-label">Expires</div><div className="ak-stat-value !text-[1.05rem]">{selected.expires_at ?? 'Never'}</div></div>
            </div>

            <div className="ak-section-title">Redemptions</div>
            <table className="ak-table">
              <thead><tr><th>Subscription</th><th>Learner</th><th>Customer</th><th>Applied</th></tr></thead>
              <tbody>
                {(selected.redemptions ?? []).length ? selected.redemptions.map((r, i) => (
                  <tr key={i} className="ak-clickable" onClick={() => r.subscription_id && navigate(`/subscriptions?id=${r.subscription_id}`)}>
                    <td>{r.subscription_id ? refId('SUB', r.subscription_id) : '—'}</td>
                    <td>{r.learner}</td>
                    <td>{r.customer}</td>
                    <td>{fmtDate(r.redeemed_at)}</td>
                  </tr>
                )) : <tr><td colSpan={4} className="text-akoro-dim">Not redeemed yet.</td></tr>}
              </tbody>
            </table>
          </>
        ) : (
          /* ══════════ LIST ══════════ */
          <>
            {loading && <p className="ak-sub">Loading…</p>}
            {loadError && <p className="ak-sub text-akoro-coral">{loadError}</p>}

            {!loading && (
              <>
                <Filters search={{ value: search, placeholder: 'Search code or description…' }} onSearch={(v) => { setSearch(v); setPage(1); }}>
                  <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="expired">Expired</option>
                    <option value="exhausted">Fully redeemed</option>
                  </select>
                </Filters>



                <table className="ak-table">
                  <thead><tr><th>Code</th><th>Discount</th><th>Redeemed</th><th>Expires</th><th>Status</th></tr></thead>
                  <tbody>
                    {items.length ? items.map((c) => {
                      const st = couponStatus(c);
                      return (
                        <tr key={c.id} className="ak-clickable" onClick={() => openDetail(c)}>
                          <td><b>{c.code}</b></td>
                          <td>{couponText(c)}</td>
                          <td>{c.redeemed}{c.max_redemptions ? ` / ${c.max_redemptions}` : ''}</td>
                          <td>{c.expires_at ?? 'Never'}</td>
                          <td><span className={`ak-badge ${STATUS[st].cls}`}>{STATUS[st].label}</span></td>
                        </tr>
                      );
                    }) : <tr><td colSpan={5} className="text-akoro-dim">No coupons match.</td></tr>}
                  </tbody>
                </table>
                <Pagination page={safePage} totalPages={totalPages} onPage={setPage} />
              </>
            )}
          </>
        )}

        {/* ── New coupon modal (exact prototype fields) ── */}
        {addOpen && addForm && (
          <Modal onClose={() => setAddOpen(false)}>
            <h2>New coupon</h2>
            <div className="ak-field-row">
              <div className="ak-field">
                <label htmlFor="nc-code">Code</label>
                <input className="ak-input" type="text" id="nc-code" placeholder="e.g. TERM2" value={addForm.code}
                  onChange={(e) => setAddForm({ ...addForm, code: e.target.value })} />
              </div>
              <div className="ak-field">
                <label htmlFor="nc-max">Max redemptions</label>
                <input className="ak-input" type="number" min="1" id="nc-max" placeholder="Unlimited" value={addForm.max_redemptions}
                  onChange={(e) => setAddForm({ ...addForm, max_redemptions: e.target.value })} />
              </div>
            </div>
            <div className="ak-field">
              <label htmlFor="nc-desc">Description</label>
              <input className="ak-input" type="text" id="nc-desc" placeholder="Internal note" value={addForm.description}
                onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} />
            </div>
            <div className="ak-field-row">
              <div className="ak-field">
                <label htmlFor="nc-type">Type</label>
                <select className="ak-select" id="nc-type" value={addForm.type}
                  onChange={(e) => setAddForm({ ...addForm, type: e.target.value })}>
                  <option value="percent">Percentage</option>
                  <option value="fixed">Fixed (₦)</option>
                </select>
              </div>
              <div className="ak-field">
                <label htmlFor="nc-value">Value</label>
                <input className="ak-input" type="number" min="1" id="nc-value" value={addForm.value}
                  onChange={(e) => setAddForm({ ...addForm, value: e.target.value })} />
              </div>
            </div>
            <div className="ak-field-row">
              <div className="ak-field">
                <label htmlFor="nc-duration">Duration</label>
                <select className="ak-select" id="nc-duration" value={addForm.duration}
                  onChange={(e) => setAddForm({ ...addForm, duration: e.target.value })}>
                  <option value="once">Once</option>
                  <option value="repeating">Repeating</option>
                  <option value="forever">Forever</option>
                </select>
              </div>
              {addForm.duration === 'repeating' && (
                <div className="ak-field">
                  <label htmlFor="nc-months">Months</label>
                  <input className="ak-input" type="number" min="1" id="nc-months" value={addForm.months}
                    onChange={(e) => setAddForm({ ...addForm, months: e.target.value })} />
                </div>
              )}
            </div>
            <div className="ak-field">
              <label htmlFor="nc-expires">Expires (blank = never)</label>
              <input className="ak-input" type="date" id="nc-expires" value={addForm.expires_at}
                onChange={(e) => setAddForm({ ...addForm, expires_at: e.target.value })} />
            </div>
            <div className="ak-field ak-feature-checks">
              <label>
                <input type="checkbox" checked={addForm.first_time_only}
                  onChange={(e) => setAddForm({ ...addForm, first_time_only: e.target.checked })} />
                New customers only (no paid invoices yet)
              </label>
            </div>
            <div className="ak-modal-actions">
              <button className="ak-btn ak-btn-ghost" onClick={() => setAddOpen(false)}>Cancel</button>
              <button className="ak-btn" onClick={submitCoupon}>Create coupon</button>
            </div>
          </Modal>
        )}

        <div className={`ak-save-toast ${toast ? 'ak-save-toast-show' : ''}`} role="status">{toast}</div>
      </div>
    </PageLayout>
  );
}
