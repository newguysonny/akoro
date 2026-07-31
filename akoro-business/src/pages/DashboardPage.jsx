import { useState, useEffect } from 'react';
import { Ticket, CheckCircle2, KeyRound, TrendingUp } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { useStartup } from '../contexts/StartupContext.jsx';
import { apiGet } from '../services/api.js';
import { INK, MUTED, MUTED2, BORDER, WHITE, GREEN, ACCENT, FONT } from '../constants.js';

const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DashboardPage() {
  const { current } = useStartup();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!current) return;
    apiGet(`/api/vouchers/startups/${current.id}/analytics`).then((r) => setStats(r.analytics)).catch(() => setStats({}));
  }, [current]);

  if (!current) return <PageLayout title="Dashboard">Loading…</PageLayout>;

  const cards = [
    { label: 'Codes issued', value: stats?.totalCodes ?? '—', icon: Ticket, c: ACCENT },
    { label: 'Codes redeemed', value: stats?.usedCodes ?? '—', icon: CheckCircle2, c: GREEN },
    { label: 'Active API keys', value: stats?.activeApiKeys ?? '—', icon: KeyRound, c: '#F59E0B' },
    { label: 'Gross sales', value: stats ? usd(stats.grossSalesUsd) : '—', icon: TrendingUp, c: '#0EA5E9' },
  ];

  return (
    <PageLayout title={`${current.name} — Dashboard`} subtitle={`${usd(current.credit_rate_usd)} per credit`}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 26 }}>
        {cards.map((c) => (
          <div key={c.label} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: MUTED, fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>
              <c.icon size={15} color={c.c} /> {c.label}
            </div>
            <div style={{ fontSize: 26, fontWeight: 900, color: INK }}>{c.value}</div>
          </div>
        ))}
      </div>
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: INK, marginBottom: 8 }}>Integrate in one call</div>
        <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6, marginBottom: 12 }}>
          Your backend calls <code>POST /api/vouchers/v1/validate</code> with an API key (see API Keys) and a voucher code.
          We're the source of truth — you never store or trust a code as valid on your own.
        </p>
        <pre style={{ background: '#0F1115', color: '#E5E7EB', borderRadius: 10, padding: 14, fontSize: 11.5, overflowX: 'auto', fontFamily: 'monospace' }}>
{`curl -X POST ${import.meta.env.VITE_API_URL || 'https://akoro.app'}/api/vouchers/v1/validate \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"voucher_code":"X9K7-MQPL-3R9T","customer_id":"cust_123"}'`}
        </pre>
      </div>
    </PageLayout>
  );
}
