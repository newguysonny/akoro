import { useState, useEffect } from 'react';
import { PageLayout } from '../components/Layout.jsx';
import { useStartup } from '../contexts/StartupContext.jsx';
import { apiGet } from '../services/api.js';
import { INK, MUTED, MUTED2, BORDER, WHITE, LIGHT, FONT } from '../constants.js';

export default function RedemptionsPage() {
  const { current } = useStartup();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!current) return;
    apiGet(`/api/vouchers/startups/${current.id}/redemptions`).then((r) => setRows(r.redemptions || [])).catch(() => setRows([]));
  }, [current]);

  if (!current) return null;
  return (
    <PageLayout title="Redemptions" subtitle="Every voucher your app has redeemed via the validate API">
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
        {rows === null ? <div style={{ padding: 30, color: MUTED2 }}>Loading…</div> : rows.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: MUTED2, fontSize: 13 }}>No redemptions yet.</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: FONT }}>
            <thead>
              <tr>{['When', 'Code', 'Credits', 'Customer'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 800, color: MUTED2, background: LIGHT }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={td}>{new Date(r.redeemed_at).toLocaleString()}</td>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{r.codes?.code}</td>
                  <td style={td}>{r.codes?.credits}</td>
                  <td style={td}>{r.customer_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageLayout>
  );
}

const td = { padding: '10px 16px', fontSize: 12.5, color: MUTED };
