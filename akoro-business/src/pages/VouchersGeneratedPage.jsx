import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { useStartup } from '../contexts/StartupContext.jsx';
import { apiGet } from '../services/api.js';
import { INK, MUTED, MUTED2, BORDER, WHITE, LIGHT, GREEN, RED, ACCENT, FONT } from '../constants.js';

const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function VouchersGeneratedPage() {
  const { current } = useStartup();
  const [batches, setBatches] = useState(null);
  const [lookupCode, setLookupCode] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupErr, setLookupErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!current) return;
    apiGet(`/api/vouchers/startups/${current.id}/batches`).then((r) => setBatches(r.batches || [])).catch(() => setBatches([]));
  }, [current]);

  const lookup = async (e) => {
    e.preventDefault();
    setBusy(true); setLookupErr(''); setLookupResult(null);
    try {
      const r = await apiGet(`/api/vouchers/startups/${current.id}/codes/lookup?code=${encodeURIComponent(lookupCode.trim())}`);
      setLookupResult(r.code);
    } catch (e2) { setLookupErr(e2.status === 404 ? "No code found matching that value." : (e2.message || 'Lookup failed')); }
    finally { setBusy(false); }
  };

  if (!current) return null;
  const totalCodes = (batches || []).reduce((s, b) => s + b.quantity, 0);
  const totalRevenue = (batches || []).filter((b) => b.status === 'paid').reduce((s, b) => s + Number(b.total_cost_usd), 0);

  return (
    <PageLayout title="Vouchers Generated" subtitle="Who bought how many codes, and when">
      {/* Code lookup — support tool */}
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: INK, marginBottom: 10 }}>Look up a code</div>
        <form onSubmit={lookup} style={{ display: 'flex', gap: 8 }}>
          <input value={lookupCode} onChange={(e) => setLookupCode(e.target.value)} placeholder="X9K7-MQPL-3R9T" style={{ flex: 1, maxWidth: 260, padding: '9px 12px', borderRadius: 9, border: `1px solid ${BORDER}`, fontSize: 13, fontFamily: 'monospace' }} />
          <button type="submit" disabled={busy || !lookupCode.trim()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 9, border: 'none', background: ACCENT, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
            <Search size={14} /> {busy ? 'Searching…' : 'Search'}
          </button>
        </form>
        {lookupErr && <div style={{ marginTop: 10, fontSize: 12.5, color: RED, fontWeight: 700 }}>{lookupErr}</div>}
        {lookupResult && (
          <div style={{ marginTop: 12, padding: 14, background: LIGHT, borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <code style={{ fontSize: 13, fontWeight: 800 }}>{lookupResult.code}</code>
              <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 9px', borderRadius: 100, color: lookupResult.status === 'active' ? GREEN : lookupResult.status === 'used' ? MUTED2 : RED, background: lookupResult.status === 'active' ? `${GREEN}14` : `${MUTED2}14` }}>{lookupResult.status}</span>
            </div>
            <div style={{ fontSize: 12, color: MUTED }}>{lookupResult.credits} credits · issued to {lookupResult.agent?.full_name || lookupResult.agent?.email || 'unknown agent'}</div>
            {lookupResult.used_at && <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>Redeemed {new Date(lookupResult.used_at).toLocaleString()}{lookupResult.used_by_customer_id ? ` · customer ${lookupResult.used_by_customer_id}` : ''}</div>}
          </div>
        )}
      </div>

      {/* Generation history */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
        <Stat label="Total codes generated" value={totalCodes.toLocaleString()} />
        <Stat label="Gross sales" value={usd(totalRevenue)} />
      </div>
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
        {batches === null ? <div style={{ padding: 30, color: MUTED2 }}>Loading…</div> : batches.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: MUTED2, fontSize: 13 }}>No purchases yet.</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: FONT }}>
            <thead>
              <tr>{['When', 'Agent', 'Codes', 'Credits ea.', 'Total', 'Status'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 800, color: MUTED2, background: LIGHT }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={td}>{new Date(b.created_at).toLocaleString()}</td>
                  <td style={td}>{b.agent?.full_name || b.agent?.email || '—'}</td>
                  <td style={td}>{b.quantity}</td>
                  <td style={td}>{b.unit_credits}</td>
                  <td style={{ ...td, fontWeight: 800, color: INK }}>{usd(b.total_cost_usd)}</td>
                  <td style={td}>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 9px', borderRadius: 100, color: b.status === 'paid' ? GREEN : b.status === 'failed' ? RED : MUTED2, background: b.status === 'paid' ? `${GREEN}14` : b.status === 'failed' ? `${RED}14` : `${MUTED2}14` }}>{b.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageLayout>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ flex: '1 1 180px', background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 11.5, color: MUTED, fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, color: INK }}>{value}</div>
    </div>
  );
}

const td = { padding: '10px 16px', fontSize: 12.5, color: MUTED };
