import { useState, useEffect } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { useStartup } from '../contexts/StartupContext.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { INK, MUTED, MUTED2, BORDER, WHITE, ACCENT, RED, FONT } from '../constants.js';

export default function DiscountTiersPage() {
  const { current } = useStartup();
  const [tiers, setTiers] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!current) return;
    // Discount tiers aren't on /startups/mine — read them via the public
    // marketplace listing (same data a shopping agent would see).
    apiGet('/api/vouchers/marketplace').then((r) => {
      const mine = r.startups?.find((s) => s.id === current.id);
      setTiers(mine?.discountTiers?.map((t) => ({ min_credits: t.min_credits, discount_pct: t.discount_pct })) || []);
    }).catch(() => setTiers([]));
  }, [current]);

  const setTier = (i, field, v) => setTiers((t) => t.map((row, j) => j === i ? { ...row, [field]: v } : row));
  const addTier = () => setTiers((t) => [...t, { min_credits: 1000, discount_pct: 5 }]);
  const delTier = (i) => setTiers((t) => t.filter((_, j) => j !== i));

  const save = async () => {
    setBusy(true);
    try {
      await apiPost(`/api/vouchers/startups/${current.id}/discount-tiers`, { tiers });
      setToast('Saved ✓');
    } catch (e) { setToast(e.message || 'Could not save'); }
    finally { setBusy(false); setTimeout(() => setToast(''), 2500); }
  };

  if (!current || tiers === null) return <PageLayout title="Discount Tiers">Loading…</PageLayout>;

  return (
    <PageLayout title="Discount Tiers" subtitle="Bigger packages, steeper discount — an agent gets the best tier their quantity qualifies for"
      action={<button onClick={save} disabled={busy} style={primaryBtn}><Save size={14} /> {busy ? 'Saving…' : 'Save'}</button>}>
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 20 }}>
        {tiers.length === 0 && <div style={{ color: MUTED2, fontSize: 13, marginBottom: 14 }}>No tiers yet — every purchase is at your base rate.</div>}
        {tiers.map((t, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, color: MUTED, whiteSpace: 'nowrap' }}>Buy at least</span>
            <input type="number" min="1" value={t.min_credits} onChange={(e) => setTier(i, 'min_credits', Number(e.target.value))} style={{ ...inp, width: 120 }} />
            <span style={{ fontSize: 12.5, color: MUTED, whiteSpace: 'nowrap' }}>credits → discount</span>
            <input type="number" min="0" max="99" step="0.5" value={t.discount_pct} onChange={(e) => setTier(i, 'discount_pct', Number(e.target.value))} style={{ ...inp, width: 90 }} />
            <span style={{ fontSize: 12.5, color: MUTED }}>%</span>
            <button onClick={() => delTier(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED, marginLeft: 'auto' }}><Trash2 size={15} /></button>
          </div>
        ))}
        <button onClick={addTier} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: ACCENT, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', marginTop: 6, fontFamily: FONT }}>
          <Plus size={14} /> Add tier
        </button>
      </div>
      {toast && <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 700, color: INK }}>{toast}</div>}
    </PageLayout>
  );
}

const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 9, border: 'none', background: ACCENT, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT };
const inp = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 13, fontFamily: FONT, outline: 'none' };
