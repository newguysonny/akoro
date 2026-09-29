import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPatch, apiPost, apiDelete } from '../services/api.js';
import { SubStatusBadge, refId, subPrice, fmtDate, fmtWhen, Pagination, Filters } from './billing/bits.jsx';
import MessageModal from './billing/MessageModal.jsx';

/**
 * SubscriptionsPage — one record per trialing or subscribed learner, billed to
 * a parent or guardian (plan §4.6 Phase 2). Pilot users have no subscription
 * record. Exact conversion of the prototype's Subscriptions panel + detail,
 * backed by:
 *
 *   GET   /api/admin/subscriptions          list
 *   GET   /api/admin/subscriptions/:id      detail + timeline
 *   PATCH /api/admin/subscriptions/:id      notes / payment method
 *   POST  /api/admin/subscriptions/:id/{pause,resume,cancel,reactivate,
 *                                       extend-trial,retry-payment}
 *
 * The coupon section arrives with Phase 3 (coupons + gateway); the prototype's
 * "Message" button with Phase 4 (messaging) — not rendered as dead UI.
 */

const PAGE_SIZE = 5;

/** Which action buttons a subscription offers (mirrors lib/billingModel.js). */
function actionsFor(s) {
  const free = (s.tier?.access ?? 'free') === 'free' && (s.price ?? 0) === 0 && s.status !== 'trial';
  if (free) return [];
  const actions = [];
  if (s.status === 'active') actions.push('pause');
  else if (s.status === 'trial') actions.push('extend-trial');
  else if (s.status === 'past_due') actions.push('retry-payment');
  else if (s.status === 'paused') actions.push('resume');
  else if (s.status === 'canceled') actions.push('reactivate');
  if (s.status !== 'canceled') actions.push('cancel');
  return actions;
}

const ACTION_LABELS = {
  pause: 'Pause', resume: 'Resume', cancel: 'Cancel subscription',
  reactivate: 'Reactivate', 'extend-trial': 'Extend trial +7 days', 'retry-payment': 'Retry payment',
};

export default function SubscriptionsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState('');
  const [subs, setSubs]               = useState([]);
  const [search, setSearch]           = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage]               = useState(1);

  const [selected, setSelected]       = useState(null); // detail w/ timeline
  const [cancelArmed, setCancelArmed] = useState(false);
  const [notesDraft, setNotesDraft]   = useState('');
  const [usableCoupons, setUsableCoupons] = useState([]);
  const [couponCode, setCouponCode]  = useState('');
  const [msgContext, setMsgContext]  = useState(null);

  const [toast, setToast]             = useState(null);
  const toastTimer                    = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1400);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  /* ── load ───────────────────────────────────────────────────────────────── */
  const load = useCallback(async () => {
    try {
      setLoadError('');
      const res = await apiGet('/api/admin/subscriptions');
      setSubs(res.data ?? []);
      return res.data ?? [];
    } catch (e) {
      setLoadError(e.message || 'Could not load subscriptions.');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const couponTextOf = (d) => {
    if (!d) return '';
    const amt = d.type === 'percent' ? `${d.value}% off` : `₦${Number(d.value).toLocaleString()} off`;
    const dur = d.duration === 'once' ? 'first payment' : d.duration === 'forever' ? 'forever' : `for ${d.months} months`;
    return `${amt}, ${dur}`;
  };

  const openDetail = useCallback(async (id) => {
    try {
      const res = await apiGet(`/api/admin/subscriptions/${id}`);
      setSelected(res.data);
      setCancelArmed(false);
      setNotesDraft(res.data.notes ?? '');

      // Coupon picker (prototype renderSubCoupon): paid, non-canceled subs only.
      const s = res.data;
      if ((s.price ?? 0) > 0 && s.status !== 'canceled' && !s.discount) {
        const couponsRes = await apiGet('/api/admin/billing/coupons').catch(() => null);
        const today = new Date().toISOString().slice(0, 10);
        const usable = (couponsRes?.data ?? []).filter((c) =>
          !c.paused && !(c.expires_at && c.expires_at < today) &&
          !(c.max_redemptions && c.redeemed >= c.max_redemptions));
        setUsableCoupons(usable);
        setCouponCode(usable[0]?.code ?? '');
      } else {
        setUsableCoupons([]);
        setCouponCode('');
      }
    } catch (e) {
      showToast(e.message || 'Could not load the subscription.');
    }
  }, [showToast]);

  useEffect(() => {
    (async () => {
      const list = await load();
      const focusId = params.get('id');
      if (focusId && list.some((s) => s.id === focusId)) openDetail(focusId);
    })();
  }, [load, openDetail, params]);

  /* ── list filtering (exact prototype semantics) ─────────────────────────── */
  const q = search.toLowerCase();
  const filtered = subs
    .filter((s) => [refId('SUB', s.id), s.customer?.name ?? '', s.learner?.name ?? '']
      .some((v) => v.toLowerCase().includes(q)))
    .filter((s) => statusFilter === 'all' || s.status === statusFilter);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const items = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  /* ── actions ────────────────────────────────────────────────────────────── */
  const doAction = async (action) => {
    try {
      await apiPost(`/api/admin/subscriptions/${selected.id}/${action}`);
      if (action === 'cancel') setCancelArmed(false);
      await load();
      await openDetail(selected.id);
      showToast(`${refId('SUB', selected.id)} updated`);
    } catch (e) {
      showToast(e.message || 'Could not update the subscription.');
    }
  };

  const applyCoupon = async () => {
    if (!couponCode) return;
    try {
      await apiPost(`/api/admin/subscriptions/${selected.id}/apply-coupon`, { code: couponCode });
      await load();
      await openDetail(selected.id);
      showToast(`${couponCode} applied`);
    } catch (e) {
      showToast(e.message || 'Could not apply the coupon.');
    }
  };

  const removeCoupon = async () => {
    try {
      await apiDelete(`/api/admin/subscriptions/${selected.id}/coupon`);
      await load();
      await openDetail(selected.id);
      showToast(`${selected.discount?.code ?? 'Coupon'} removed`);
    } catch (e) {
      showToast(e.message || 'Could not remove the coupon.');
    }
  };

  const saveNotes = async () => {
    try {
      await apiPatch(`/api/admin/subscriptions/${selected.id}`, { notes: notesDraft });
      await load();
      showToast('Notes saved');
    } catch (e) {
      showToast(e.message || 'Could not save notes.');
    }
  };

  /* ── render helpers ─────────────────────────────────────────────────────── */
  const actions = selected ? actionsFor(selected) : [];
  const dateLabel = selected
    ? (selected.status === 'trial' ? 'Trial ends' : selected.status === 'past_due' ? 'Payment due since' : 'Next renewal')
    : '';

  /* ── render ─────────────────────────────────────────────────────────────── */
  return (
    <PageLayout title="Subscriptions" subtitle="One record per trialing or subscribed learner, billed to a parent or guardian">
      <div className="ak-page">

        {selected ? (
          /* ══════════ SUBSCRIPTION DETAIL ══════════ */
          <>
            <button className="ak-back-link" onClick={() => setSelected(null)}>← Back to Subscriptions</button>
            <div className="ak-detail-head">
              <div>
                <h1 className="ak-h1">{refId('SUB', selected.id)} · {selected.learner?.name ?? 'Learner'}</h1>
                <p className="ak-sub !mt-1.5 !mb-0">
                  Billed to{' '}
                  <button className="ak-link-btn" onClick={() => navigate(`/customers?id=${selected.customer?.id}`)}>
                    {selected.customer?.name}
                  </button>
                  {'  '}
                  <SubStatusBadge status={selected.status} />
                </p>
              </div>
              <div className="ak-detail-actions">
                {actions.length === 0 ? (
                  <span className="ak-sub !mb-0">Free plan, no billing actions.</span>
                ) : actions.map((a) => a === 'cancel' ? (
                  cancelArmed ? (
                    <span key="cancel" className="ak-detail-actions">
                      <button className="ak-btn ak-btn-danger ak-btn-small" onClick={() => doAction('cancel')}>Confirm cancel</button>
                      <button className="ak-btn ak-btn-ghost ak-btn-small" onClick={() => setCancelArmed(false)}>Keep</button>
                    </span>
                  ) : (
                    <button key="cancel" className="ak-btn ak-btn-danger ak-btn-small" onClick={() => setCancelArmed(true)}>Cancel subscription</button>
                  )
                ) : (
                  <button key={a} className="ak-btn ak-btn-ghost ak-btn-small" onClick={() => doAction(a)}>
                    {ACTION_LABELS[a]}
                  </button>
                ))}
              </div>
            </div>

            <div className="ak-stat-row">
              <div className="ak-stat"><div className="ak-stat-label">Plan</div><div className="ak-stat-value">{selected.tier?.name ?? '—'}</div></div>
              <div className="ak-stat"><div className="ak-stat-label">Price</div><div className="ak-stat-value">{subPrice(selected)}</div></div>
              <div className="ak-stat"><div className="ak-stat-label">{dateLabel}</div><div className="ak-stat-value">{fmtDate(selected.next_date)}</div></div>
              <div className="ak-stat"><div className="ak-stat-label">Payment method</div><div className="ak-stat-value !text-[1rem]">{selected.payment_method_ref || 'None on file'}</div></div>
              <div className="ak-stat">
                <div className="ak-stat-label">Discount</div>
                <div className="ak-stat-value !text-[1rem]">{selected.discount ? selected.discount.code : 'None'}</div>
                {selected.discount && <div className="text-[0.75rem] text-akoro-dim mt-1 font-semibold">{couponTextOf(selected.discount)}</div>}
              </div>
            </div>

            {/* coupon apply/remove (prototype renderSubCoupon) */}
            {selected.discount ? (
              <div className="-mt-4 mb-6">
                <button className="ak-btn ak-btn-ghost ak-btn-small" onClick={removeCoupon}>Remove coupon {selected.discount.code}</button>
              </div>
            ) : (selected.price ?? 0) > 0 && selected.status !== 'canceled' && usableCoupons.length > 0 && (
              <div className="ak-price-row -mt-4 mb-6">
                <select className="ak-select !w-auto" value={couponCode} onChange={(e) => setCouponCode(e.target.value)}>
                  {usableCoupons.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.type === 'percent' ? `${c.value}% off` : `₦${Number(c.value).toLocaleString()} off`}
                      {c.duration === 'repeating' ? `, ${c.months} months` : c.duration === 'forever' ? ', forever' : ', first payment'}
                    </option>
                  ))}
                </select>
                <button className="ak-btn ak-btn-ghost ak-btn-small" onClick={applyCoupon}>Apply coupon</button>
              </div>
            )}

            <div className="ak-section-title">Timeline</div>
            <table className="ak-table">
              <thead><tr><th>When</th><th>Event</th></tr></thead>
              <tbody>
                {(selected.timeline ?? []).length ? selected.timeline.map((t) => (
                  <tr key={t.id ?? t.at}><td className="whitespace-nowrap">{fmtWhen(t.at)}</td><td>{t.text}</td></tr>
                )) : <tr><td colSpan={2} className="text-akoro-dim">No events recorded.</td></tr>}
              </tbody>
            </table>

            <div className="ak-section-title">Internal notes</div>
            <textarea
              className="ak-notes-box" rows="3"
              placeholder="Notes visible to admins only"
              value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)}
            />
            <button className="ak-btn ak-btn-ghost ak-btn-small mt-2" onClick={saveNotes}>Save notes</button>
          </>
        ) : (
          /* ══════════ LIST ══════════ */
          <>
            <h1 className="ak-h1">Subscriptions</h1>
            <p className="ak-sub">One record per trialing or subscribed learner, billed to a parent or guardian. Pilot users have no subscription record.</p>

            {loading && <p className="ak-sub">Loading…</p>}
            {loadError && <p className="ak-sub text-akoro-coral">{loadError}</p>}

            {!loading && (
              <>
                <Filters search={{ value: search, placeholder: 'Search parent, learner, or ID…' }} onSearch={(v) => { setSearch(v); setPage(1); }}>
                  <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="trial">Trial</option>
                    <option value="past_due">Past due</option>
                    <option value="paused">Paused</option>
                    <option value="canceled">Canceled</option>
                  </select>
                </Filters>

                <table className="ak-table">
                  <thead><tr><th>ID</th><th>Billing contact</th><th>Learner</th><th>Plan</th><th>Status</th><th>Next date</th><th></th></tr></thead>
                  <tbody>
                    {items.length ? items.map((s) => (
                      <tr key={s.id} className="ak-clickable" onClick={() => openDetail(s.id)}>
                        <td>{refId('SUB', s.id)}</td>
                        <td>{s.customer?.name ?? '—'}</td>
                        <td>{s.learner?.name ?? '—'}</td>
                        <td>{s.tier?.name} <small className="text-akoro-dim">{subPrice(s)}</small></td>
                        <td><SubStatusBadge status={s.status} /></td>
                        <td>{fmtDate(s.next_date)}</td>
                        <td><button className="ak-btn ak-btn-ghost ak-btn-small" onClick={(e) => { e.stopPropagation(); setMsgContext({ kind: 'sub', customer: s.customer, subscriptionId: s.id, learnerName: s.learner?.name }); }}>Message</button></td>
                      </tr>
                    )) : <tr><td colSpan={7} className="text-akoro-dim">No subscriptions match.</td></tr>}
                  </tbody>
                </table>
                <Pagination page={safePage} totalPages={totalPages} onPage={setPage} />
              </>
            )}
          </>
        )}

        {msgContext && (
          <MessageModal
            context={msgContext}
            onClose={() => setMsgContext(null)}
            onSent={(ok, msg) => { if (msg) showToast(msg); if (ok) load(); }}
          />
        )}

        <div className={`ak-save-toast ${toast ? 'ak-save-toast-show' : ''}`} role="status">{toast}</div>
      </div>
    </PageLayout>
  );
}
