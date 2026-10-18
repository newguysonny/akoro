import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { InvStatusBadge, refId, fmtDate, Pagination, Filters } from './billing/bits.jsx';

/**
 * InvoicesPage — billing records per subscription (plan §4.6 Phase 2).
 * Statuses: draft → open (finalized) → paid (marked paid, manual/offline until
 * the Phase 3 gateway) | void. Exact conversion of the prototype's Invoices
 * panel + detail, backed by:
 *
 *   GET  /api/admin/invoices            list (with line items)
 *   GET  /api/admin/invoices/:id        detail + derived timeline
 *   POST /api/admin/invoices/:id/finalize | mark-paid | void
 */

const PAGE_SIZE = 5;
const naira = (n) => `₦${Number(n || 0).toLocaleString()}`;

export default function InvoicesPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState('');
  const [invoices, setInvoices]   = useState([]);
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage]           = useState(1);

  const [selected, setSelected]   = useState(null);
  const [voidArmed, setVoidArmed] = useState(false);

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
      const res = await apiGet('/api/admin/invoices');
      setInvoices(res.data ?? []);
      return res.data ?? [];
    } catch (e) {
      setLoadError(e.message || 'Could not load invoices.');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const list = await load();
      const focusId = params.get('id');
      if (focusId && list.some((i) => i.id === focusId)) {
        setSelected(list.find((i) => i.id === focusId));
        setVoidArmed(false);
      }
    })();
  }, [load, params]);

  /* ── list filtering ─────────────────────────────────────────────────────── */
  const total = (inv) => (inv.lines ?? []).reduce((sum, l) => sum + l.amount, 0);
  const overdueDays = (inv) => {
    if (inv.status !== 'open' || !inv.due_at) return 0;
    const d = Math.round((new Date(`${todayStr()}T00:00:00Z`) - new Date(`${inv.due_at}T00:00:00Z`)) / 86400000);
    return d > 0 ? d : 0;
  };

  const q = search.toLowerCase();
  const filtered = invoices
    .filter((inv) => [refId('INV', inv.id), inv.customer?.name ?? '', inv.subscription ? refId('SUB', inv.subscription.id) : '']
      .some((v) => v.toLowerCase().includes(q)))
    .filter((inv) => statusFilter === 'all' || inv.status === statusFilter);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const items = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  /* ── actions ────────────────────────────────────────────────────────────── */
  const doAction = async (action) => {
    try {
      await apiPost(`/api/admin/invoices/${selected.id}/${action}`);
      setVoidArmed(false);
      await load();
      // Re-open the same invoice from the fresh list.
      const res = await apiGet(`/api/admin/invoices/${selected.id}`);
      setSelected(res.data);
      showToast(`${refId('INV', selected.id)} updated`);
    } catch (e) {
      showToast(e.message || 'Could not update the invoice.');
    }
  };

  /* ── render ─────────────────────────────────────────────────────────────── */
  return (
    <PageLayout title="Invoices" subtitle="Billing records per subscription">
      <div className="ak-page">

        {selected ? (
          /* ══════════ INVOICE DETAIL ══════════ */
          <>
            <button className="ak-back-link" onClick={() => setSelected(null)}>← Back to Invoices</button>
            <div className="ak-detail-head">
              <div>
                <h1 className="ak-h1">{refId('INV', selected.id)}</h1>
                <p className="ak-sub !mt-1.5 !mb-0">
                  <InvStatusBadge status={selected.status} />
                  {'  '}Billed to{' '}
                  <button className="ak-link-btn" onClick={() => navigate(`/customers?id=${selected.customer?.id}`)}>{selected.customer?.name}</button>
                  {selected.subscription && (
                    <> · <button className="ak-link-btn" onClick={() => navigate(`/subscriptions?id=${selected.subscription.id}`)}>{refId('SUB', selected.subscription.id)}</button></>
                  )}
                  {overdueDays(selected) > 0 && <span className="ak-overdue">  Overdue by {overdueDays(selected)} day{overdueDays(selected) === 1 ? '' : 's'}</span>}
                </p>
              </div>
              <div className="ak-detail-actions">
                {selected.status === 'draft' ? (
                  <>
                    <button className="ak-btn ak-btn-small" onClick={() => doAction('finalize')}>Finalize</button>
                    {voidArmed ? (
                      <>
                        <button className="ak-btn ak-btn-danger ak-btn-small" onClick={() => doAction('void')}>Confirm void</button>
                        <button className="ak-btn ak-btn-ghost ak-btn-small" onClick={() => setVoidArmed(false)}>Keep</button>
                      </>
                    ) : (
                      <button className="ak-btn ak-btn-danger ak-btn-small" onClick={() => setVoidArmed(true)}>Void invoice</button>
                    )}
                  </>
                ) : selected.status === 'open' ? (
                  <>
                    <button className="ak-btn ak-btn-small" onClick={() => doAction('mark-paid')}>Mark paid</button>
                    {voidArmed ? (
                      <>
                        <button className="ak-btn ak-btn-danger ak-btn-small" onClick={() => doAction('void')}>Confirm void</button>
                        <button className="ak-btn ak-btn-ghost ak-btn-small" onClick={() => setVoidArmed(false)}>Keep</button>
                      </>
                    ) : (
                      <button className="ak-btn ak-btn-danger ak-btn-small" onClick={() => setVoidArmed(true)}>Void invoice</button>
                    )}
                  </>
                ) : (
                  <span className="ak-sub !mb-0">No actions available.</span>
                )}
              </div>
            </div>

            <div className="ak-stat-row">
              <div className="ak-stat"><div className="ak-stat-label">Amount</div><div className="ak-stat-value">{naira(total(selected))}</div></div>
              <div className="ak-stat"><div className="ak-stat-label">Issued</div><div className="ak-stat-value !text-[1.05rem]">{fmtDate(selected.issued_at)}</div></div>
              <div className="ak-stat"><div className="ak-stat-label">Due</div><div className="ak-stat-value !text-[1.05rem]">{fmtDate(selected.due_at)}</div></div>
              <div className="ak-stat"><div className="ak-stat-label">Paid on</div><div className="ak-stat-value !text-[1.05rem]">{fmtDate(selected.paid_at)}</div></div>
            </div>

            <div className="ak-section-title">Line items</div>
            <table className="ak-table">
              <thead><tr><th>Description</th><th className="ak-num">Amount</th></tr></thead>
              <tbody>
                {(selected.lines ?? []).map((l, i) => (
                  <tr key={i}><td>{l.description}</td><td className="ak-num">{naira(l.amount)}</td></tr>
                ))}
                <tr><td><b>Total</b></td><td className="ak-num"><b>{naira(total(selected))}</b></td></tr>
              </tbody>
            </table>

            <div className="ak-section-title">Timeline</div>
            <table className="ak-table">
              <thead><tr><th>When</th><th>Event</th></tr></thead>
              <tbody>
                {(selected.timeline ?? []).map((t, i) => (
                  <tr key={i}><td className="whitespace-nowrap">{fmtDate(t.at)}</td><td>{t.text}</td></tr>
                ))}
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
                <Filters search={{ value: search, placeholder: 'Search invoice, customer, or subscription…' }} onSearch={(v) => { setSearch(v); setPage(1); }}>
                  <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                    <option value="all">All statuses</option>
                    <option value="draft">Draft</option>
                    <option value="open">Open</option>
                    <option value="paid">Paid</option>
                    <option value="void">Void</option>
                  </select>
                </Filters>

                <table className="ak-table">
                  <thead><tr><th>Invoice</th><th>Customer</th><th>Subscription</th><th>Issued</th><th>Due</th><th>Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    {items.length ? items.map((inv) => (
                      <tr key={inv.id} className="ak-clickable" onClick={() => { setSelected(inv); setVoidArmed(false); }}>
                        <td>{refId('INV', inv.id)}</td>
                        <td>{inv.customer?.name ?? '—'}</td>
                        <td>{inv.subscription ? refId('SUB', inv.subscription.id) : '—'}</td>
                        <td>{fmtDate(inv.issued_at)}</td>
                        <td>
                          {fmtDate(inv.due_at)}
                          {overdueDays(inv) > 0 && <span className="ak-overdue"> overdue</span>}
                        </td>
                        <td>{naira(total(inv))}</td>
                        <td><InvStatusBadge status={inv.status} /></td>
                      </tr>
                    )) : <tr><td colSpan={7} className="text-akoro-dim">No invoices match.</td></tr>}
                  </tbody>
                </table>
                <Pagination page={safePage} totalPages={totalPages} onPage={setPage} />
              </>
            )}
          </>
        )}

        <div className={`ak-save-toast ${toast ? 'ak-save-toast-show' : ''}`} role="status">{toast}</div>
      </div>
    </PageLayout>
  );
}

const todayStr = () => new Date().toISOString().slice(0, 10);
