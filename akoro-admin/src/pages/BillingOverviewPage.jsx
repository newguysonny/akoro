import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet } from '../services/api.js';
import { refId, subPrice } from './billing/bits.jsx';

/**
 * BillingOverviewPage — the billing Overview panel (plan §4.6 #5), an exact
 * conversion of the prototype's renderOverview, now computed from live
 * subscription + invoice records. The revenue metrics the prototype
 * deliberately left out (MRR/ARR, revenue to date) are grounded as of Phase 3
 * — a real gateway and real paid invoices exist — so they ship in Phase 5.
 *
 *   GET /api/admin/billing/overview
 *
 * KPI cards deep-link into the Subscriptions list filtered by status
 * (?status=active|trial|past_due), matching the prototype's
 * goSubsFiltered() behavior.
 */

const naira = (n) => `₦${Number(n ?? 0).toLocaleString()}`;

const StatCard = ({ onClick, label, value, note }) => (
  <div
    className={`ak-stat ${onClick ? 'ak-clickable' : ''}`}
    {...(onClick ? { onClick } : {})}
  >
    <div className="ak-stat-label">{label}</div>
    <div className="ak-stat-value">{value}</div>
    {note && <div className="text-[0.75rem] text-akoro-dim mt-1 font-semibold">{note}</div>}
  </div>
);

export default function BillingOverviewPage() {
  const navigate = useNavigate();

  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState('');
  const [data, setData]           = useState(null);

  const load = useCallback(async () => {
    try {
      setLoadError('');
      const res = await apiGet('/api/admin/billing/overview');
      setData(res.data ?? null);
    } catch (e) {
      setLoadError(e.message || 'Could not load the overview.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const mixTotal = data ? data.mix.reduce((sum, m) => sum + m.n, 0) || 1 : 1;

  return (
    <PageLayout title="Billing Overview" subtitle="Subscription health at a glance">
      <div className="ak-page">

        <h1 className="ak-h1">Overview</h1>
        <p className="ak-sub">Subscription health at a glance, computed from live subscription and invoice records. Revenue metrics are grounded in paid invoices since the Paystack gateway went live.</p>

        {loading && <p className="ak-sub">Loading…</p>}
        {loadError && <p className="ak-sub text-akoro-coral">{loadError}</p>}

        {!loading && data && (
          <>
            {/* KPI row — prototype's five stats, deep-linking like goSubsFiltered */}
            <div className="ak-stat-row">
              <StatCard label="Paying subscribers" value={data.kpis.paying} note="Active paid plans"
                onClick={() => navigate('/subscriptions?status=active')} />
              <StatCard label="Trials in progress" value={data.kpis.trials} note={`${data.kpis.trialsEnding} ending within 7 days`}
                onClick={() => navigate('/subscriptions?status=trial')} />
              <StatCard label="Trial conversion"
                value={data.kpis.conversion.pct === null ? '—' : `${data.kpis.conversion.pct}%`}
                note={`${data.kpis.conversion.converted} of ${data.kpis.conversion.concluded} concluded trials`} />
              <StatCard label="Past due" value={data.kpis.pastDue} note={`${naira(data.kpis.atRisk)} at risk`}
                onClick={() => navigate('/subscriptions?status=past_due')} />
              <StatCard label="Active pilot schools" value={data.kpis.activePilots} note="No subscription records"
                onClick={() => navigate('/pilot-schools')} />
            </div>

            {/* Revenue — grounded since the gateway went live (plan §4.6 #5) */}
            <div className="ak-section-title">Revenue</div>
            <div className="ak-stat-row">
              <StatCard label="MRR" value={naira(data.revenue.mrr)} note="Active subs, annual normalized monthly" />
              <StatCard label="ARR" value={naira(data.revenue.arr)} note="MRR × 12" />
              <StatCard label="Revenue to date" value={naira(data.revenue.revenueToDate)} note="Paid invoices" />
              <StatCard label="Paying customers" value={data.revenue.payingCustomers}
                note={data.revenue.payingCustomers ? `${naira(data.revenue.avgPerCustomer)} avg per customer` : 'No paid invoices yet'} />
            </div>
            <p className="ak-sub !text-[0.78rem] !mt-2 !mb-0">
              LTV and churn stay off this page until there is enough subscription history for them to mean something.
            </p>

            {/* Subscribers by plan — prototype's mix rows */}
            <div className="ak-section-title">Subscribers by plan</div>
            <div className="ak-settings-card">
              {data.mix.map((m) => (
                <div key={m.label} className="flex items-center gap-3 mb-3 last:mb-0 text-[0.88rem] font-semibold">
                  <span className="w-[90px] shrink-0">{m.label}</span>
                  <div className="flex-1 h-[8px] rounded-full bg-akoro-purplesoft overflow-hidden">
                    <div className="h-full rounded-full bg-akoro-purple" style={{ width: `${Math.round((m.n / mixTotal) * 100)}%` }} />
                  </div>
                  <span>{m.n}</span>
                </div>
              ))}
            </div>

            {/* Needs attention */}
            <div className="ak-section-title">Needs attention</div>
            <table className="ak-table">
              <thead><tr><th>Subscription</th><th>Issue</th><th></th></tr></thead>
              <tbody>
                {data.attention.length ? data.attention.map((a) => (
                  <tr key={a.subscription_id + a.kind}>
                    <td>{refId('SUB', a.subscription_id)}{a.learner_name ? ` · ${a.learner_name}` : ''}</td>
                    <td>{a.kind === 'past_due' ? `Payment failed, ${subPrice({ price: a.price, cycle: a.cycle })} unpaid` : `Trial ends ${a.next_date}`}</td>
                    <td><button className="ak-btn ak-btn-ghost ak-btn-small" onClick={() => navigate(`/subscriptions?id=${a.subscription_id}`)}>View</button></td>
                  </tr>
                )) : <tr><td colSpan={3} className="text-akoro-dim">Nothing needs attention right now.</td></tr>}
              </tbody>
            </table>

            {/* Upcoming renewals */}
            <div className="ak-section-title">Upcoming renewals (next 30 days)</div>
            <table className="ak-table">
              <thead><tr><th>Subscription</th><th>Learner</th><th>Renews</th><th>Amount</th></tr></thead>
              <tbody>
                {data.renewals.length ? data.renewals.map((r) => (
                  <tr key={r.subscription_id} className="ak-clickable" onClick={() => navigate(`/subscriptions?id=${r.subscription_id}`)}>
                    <td>{refId('SUB', r.subscription_id)}</td>
                    <td>{r.learner_name ?? '—'}</td>
                    <td>{r.renews}</td>
                    <td>{subPrice({ price: r.price, cycle: r.cycle })}</td>
                  </tr>
                )) : <tr><td colSpan={4} className="text-akoro-dim">No renewals in the next 30 days.</td></tr>}
              </tbody>
            </table>
          </>
        )}
      </div>
    </PageLayout>
  );
}
