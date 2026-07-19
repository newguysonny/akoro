/**
 * ToolPurchasesPage (school) — the school's own purchases from the Tools &
 * Assets marketplace (shared with instructors). Backed by
 * GET /api/instructor/tools/purchases.
 */
import { useState, useEffect } from 'react';
import { Receipt } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Skeleton } from '../components/Primitives.jsx';
import { apiGet } from '../services/api.js';
import { INK, MUTED, BORDER, LIGHT, WHITE, GREEN, RED, FONT } from '../constants.js';

const ngn = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const STATUS = {
  success:  { label: 'Paid',     bg: '#DCFCE7', color: GREEN },
  pending:  { label: 'Pending',  bg: '#FEF3C7', color: '#B45309' },
  failed:   { label: 'Failed',   bg: '#FEE2E2', color: RED },
  refunded: { label: 'Refunded', bg: '#F1F0F4', color: MUTED },
};

export default function ToolPurchasesPage() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let alive = true;
    apiGet('/api/instructor/tools/purchases')
      .then((r) => { if (alive) setRows(r?.purchases ?? r?.data?.purchases ?? []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, []);

  return (
    <PageLayout title="Tool & Asset Purchases" subtitle="Your Tools & Assets marketplace payments">
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        {rows === null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[1,2,3,4].map(i => <Skeleton key={i} height={64} />)}</div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '64px 20px', color: MUTED, fontFamily: FONT }}>
            <Receipt size={40} style={{ marginBottom: 12, opacity: 0.5 }} />
            <div style={{ fontSize: 16, fontWeight: 800, color: INK }}>No purchases yet</div>
            <div style={{ fontSize: 13.5, marginTop: 4 }}>Tools & assets you unlock will show up here.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map((p) => {
              const s = STATUS[p.access_granted ? 'success' : (p.paystack_status || 'pending')] || STATUS.pending;
              const tool = p.platform_tools || {};
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '13px 14px', fontFamily: FONT }}>
                  <span style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, background: LIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{tool.emoji || '🛠️'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tool.name || 'Tool'}</div>
                    <div style={{ fontSize: 12, color: MUTED, textTransform: 'capitalize' }}>{tool.kind || 'tool'} · {fmtDate(p.purchased_at)}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: INK }}>{(p.amount_kobo || 0) === 0 ? 'Free' : ngn((p.amount_kobo || 0) / 100)}</div>
                    <span style={{ display: 'inline-block', marginTop: 4, fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: s.bg, color: s.color }}>{s.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
