/**
 * OrderHistoryPage (instructor) — the instructor's own purchases from the
 * Tools & Assets marketplace. Backed by GET /api/instructor/tools/purchases.
 */
import { useState, useEffect } from 'react';
import { Receipt , Wrench } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Skeleton } from '../components/Primitives.jsx';
import { apiGet } from '../services/api.js';
import { GREEN, RED } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const ngn = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const STATUS = {
  success:  { label: 'Paid',     bg: '#DCFCE7', color: GREEN },
  pending:  { label: 'Pending',  bg: '#FEF3C7', color: '#B45309' },
  failed:   { label: 'Failed',   bg: '#FEE2E2', color: RED },
  refunded: { label: 'Refunded', bg: '#F1F0F4', color: C.muted },
};

export default function OrderHistoryPage() {
  const [rows, setRows] = useState(null);   // null = loading

  useEffect(() => {
    let alive = true;
    apiGet('/api/instructor/tools/purchases')
      .then((r) => { if (alive) setRows(r?.purchases ?? r?.data?.purchases ?? []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, []);

  return (
    <PageLayout title="Order history" subtitle="Your tool & asset purchases">
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        {rows === null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[1,2,3,4].map(i => <Skeleton key={i} height={64} />)}</div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '64px 20px', color: C.muted, fontFamily: C.font }}>
            <Ico lucide={Receipt} ti="ti-receipt" size={40} style={{ marginBottom: 12, opacity: 0.5 }} />
            <div style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>No purchases yet</div>
            <div style={{ fontSize: 13.5, marginTop: 4 }}>Tools & assets you unlock will show up here.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map((p) => {
              const s = STATUS[p.access_granted ? 'success' : (p.paystack_status || 'pending')] || STATUS.pending;
              const tool = p.platform_tools || {};
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '13px 14px', fontFamily: C.font }}>
                  <span style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico lucide={Wrench} ti="ti-tool" size={20} color={C.brand} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tool.name || 'Tool'}</div>
                    <div style={{ fontSize: 12, color: C.muted, textTransform: 'capitalize' }}>{tool.kind || 'tool'} · {fmtDate(p.purchased_at)}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: C.ink }}>{(p.amount_kobo || 0) === 0 ? 'Free' : ngn((p.amount_kobo || 0) / 100)}</div>
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
