import { useRef, useState } from 'react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { refId } from './billing/bits.jsx';

const naira = (n) => `₦${Number(n ?? 0).toLocaleString()}`;

/**
 * ReconciliationPage — plan §4.6 #5: reconcile local Subscriptions/Invoices
 * against real Paystack objects now that the gateway is live.
 *
 *   GET  /api/admin/billing/reconcile?days=    pull recent subscription
 *        transactions and compare each against local state
 *   POST /api/admin/billing/reconcile/settle   re-run (idempotent) webhook
 *        fulfillment for one transaction to close a gap
 *
 * There is no prototype for this panel (Tools were deferred in the mock) —
 * it follows the dashboard's established patterns.
 */

const KIND_LABELS = {
  missing_subscription:  'Missing subscription',
  missing_first_invoice: 'Missing first invoice',
  invoice_open:          'Invoice still open',
  missing_invoice:       'Invoice row missing',
  unknown_purpose:       'Unexpected purpose',
};

export default function ReconciliationPage() {
  const [days, setDays]         = useState('30');
  const [running, setRunning]   = useState(false);
  const [settling, setSettling] = useState(null);
  const [report, setReport]     = useState(null);
  const [error, setError]       = useState('');
  const [toast, setToast]       = useState(null);
  const toastTimer = useRef(null);
  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  const run = async () => {
    setRunning(true);
    setError('');
    try {
      const res = await apiGet(`/api/admin/billing/reconcile?days=${days}`);
      setReport(res.data ?? null);
      showToast(`Checked ${res.data?.checked ?? 0} successful charge(s) — ${res.data?.discrepancies?.length ?? 0} discrepanc${res.data?.discrepancies?.length === 1 ? 'y' : 'ies'}`);
    } catch (e) {
      setError(e.message || 'Could not run reconciliation.');
    } finally {
      setRunning(false);
    }
  };

  const settle = async (reference) => {
    setSettling(reference);
    try {
      const res = await apiPost('/api/admin/billing/reconcile/settle', { reference });
      showToast(res.data?.outcome === 'invoice_created' ? 'Invoice created and marked paid' : 'Settled — fulfillment replayed');
      await run();
    } catch (e) {
      showToast(e.message || 'Could not settle that transaction.');
    } finally {
      setSettling(null);
    }
  };

  return (
    <PageLayout title="Reconciliation" subtitle="Local billing records against real Paystack transactions">
      <div className="ak-page">

        <h1 className="ak-h1">Reconciliation</h1>
        <p className="ak-sub">
          Compares recent subscription charges on Paystack with local subscriptions and invoices. A gap usually means a dropped webhook — settling replays the same fulfillment path, idempotently.
        </p>

        <div className="ak-toolbar">
          <select className="ak-select !w-auto" value={days} onChange={(e) => setDays(e.target.value)} disabled={running}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 12 months</option>
          </select>
          <button className="ak-btn" onClick={run} disabled={running}>{running ? 'Checking…' : 'Run reconciliation'}</button>
        </div>

        {error && <p className="ak-sub text-akoro-coral">{error}</p>}

        {report && (
          <>
            <div className="ak-stat-row">
              <div className="ak-stat"><div className="ak-stat-label">Successful charges checked</div><div className="ak-stat-value">{report.checked}</div></div>
              <div className="ak-stat"><div className="ak-stat-label">Matched</div><div className="ak-stat-value">{report.matched}</div></div>
              <div className="ak-stat"><div className="ak-stat-label">Discrepancies</div><div className="ak-stat-value">{report.discrepancies.length}</div></div>
              <div className="ak-stat"><div className="ak-stat-label">Failed charges (info)</div><div className="ak-stat-value">{report.failed_charges}</div>
                <div className="text-[0.75rem] text-akoro-dim mt-1 font-semibold">Handled by dunning</div></div>
            </div>
            <p className="ak-sub !text-[0.78rem] !mt-2">
              Window: last {report.days} day{report.days === 1 ? '' : 's'} · generated {new Date(report.generated_at).toLocaleString()}
            </p>

            <div className="ak-section-title">Discrepancies</div>
            <table className="ak-table">
              <thead><tr><th>Reference</th><th>Kind</th><th>Amount</th><th>Customer</th><th>Detail</th><th></th></tr></thead>
              <tbody>
                {report.discrepancies.length ? report.discrepancies.map((d) => (
                  <tr key={d.reference}>
                    <td className="font-mono text-[0.8rem]">{d.reference}</td>
                    <td>{KIND_LABELS[d.kind] ?? d.kind}</td>
                    <td>{naira(d.amount_naira)}</td>
                    <td>{d.customer_email ?? '—'}</td>
                    <td className="max-w-[340px]">{d.detail}{d.invoice_id && <span className="block text-akoro-dim text-[0.78rem] font-semibold">{refId('INV', d.invoice_id)}</span>}</td>
                    <td>
                      {d.settleable
                        ? <button className="ak-btn ak-btn-small" disabled={settling === d.reference} onClick={() => settle(d.reference)}>
                            {settling === d.reference ? 'Settling…' : 'Settle'}
                          </button>
                        : <span className="text-akoro-dim text-[0.8rem] font-semibold">Manual</span>}
                    </td>
                  </tr>
                )) : <tr><td colSpan={6} className="text-akoro-dim">Local records match every successful charge. Nothing to settle.</td></tr>}
              </tbody>
            </table>
          </>
        )}

        <div className={`ak-save-toast ${toast ? 'ak-save-toast-show' : ''}`} role="status">{toast}</div>
      </div>
    </PageLayout>
  );
}
