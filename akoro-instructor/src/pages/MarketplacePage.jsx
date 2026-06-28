import { useState, useEffect, useCallback } from 'react';
import { Check, Lock, Loader2 } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, GREEN, FONT } from '../constants.js';

const BRAND = AMBER;
const FONTF = FONT;
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;

/* ─── Item card ───────────────────────────────────────────────────── */
function ItemCard({ item, busy, onBuy }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, border: `1px solid ${item.owned ? `${GREEN}40` : BORDER}`, boxShadow: '0 1px 4px rgba(0,0,0,.05)', padding: '14px 16px', display: 'flex', gap: 13, alignItems: 'flex-start' }}>
      <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, background: `${BRAND}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{item.emoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 14, fontWeight: 800, color: INK, margin: 0 }}>{item.name}</p>
          {item.tag && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: `${BRAND}12`, color: BRAND }}>{item.tag}</span>}
        </div>
        <p style={{ fontSize: 12.5, color: MUTED, margin: '5px 0 10px', lineHeight: 1.55 }}>{item.description}</p>
        <span style={{ fontSize: 14, fontWeight: 900, color: item.price === 0 ? GREEN : INK }}>
          {item.price === 0 ? 'Free' : naira(item.price)}
        </span>
      </div>
      {/* Owned badge or Unlock button */}
      {item.owned ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 10, background: `${GREEN}15`, color: GREEN, fontSize: 12, fontWeight: 800, flexShrink: 0, marginTop: 2 }}>
          <Check size={13} /> Unlocked
        </span>
      ) : (
        <button onClick={() => onBuy(item)} disabled={busy}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: 'none', background: busy ? '#E5E7EB' : `linear-gradient(135deg,${BRAND},#D4651E)`, color: busy ? '#9CA3AF' : '#fff', fontSize: 12.5, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: FONTF, flexShrink: 0, marginTop: 2 }}>
          {busy ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Lock size={12} />}
          {item.price === 0 ? 'Get' : 'Unlock'}
        </button>
      )}
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────────── */
export default function MarketplacePage() {
  const [tab, setTab]       = useState('tools');
  const [tools, setTools]   = useState([]);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast]   = useState('');

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(async () => {
    try {
      const res = await apiGet('/api/instructor/tools');
      setTools(res.tools || []);
      setAssets(res.assets || []);
    } catch (e) {
      showToast(e.message || 'Could not load catalog');
    } finally {
      setLoading(false);
    }
  }, []);

  /* Initial load + handle Paystack redirect (?tool_ref=...) */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('tool_ref');
    if (ref) {
      // Clean the URL, then verify the payment before loading the catalog
      window.history.replaceState({}, '', window.location.pathname);
      apiGet(`/api/instructor/tools/verify/${ref}`)
        .then((r) => showToast(r?.owned ? 'Unlocked ✓' : (r?.message || 'Payment not completed')))
        .catch((e) => showToast(e.message || 'Verification failed'))
        .finally(load);
    } else {
      load();
    }
  }, [load]);

  const buy = async (item) => {
    setBusyId(item.id);
    try {
      const res = await apiPost('/api/instructor/tools/checkout', { toolId: item.id });
      if (res?.authorization_url) {
        window.location.href = res.authorization_url;   // redirect to Paystack
        return;
      }
      if (res?.owned) { showToast('Unlocked ✓'); await load(); }
      else showToast(res?.error || 'Could not unlock');
    } catch (e) {
      showToast(e.message || 'Checkout failed');
    } finally {
      setBusyId(null);
    }
  };

  const items     = tab === 'tools' ? tools : assets;
  const ownedCount = items.filter((i) => i.owned).length;

  return (
    <PageLayout title="Tools & Assets" subtitle="Unlock platform tools & exam resources for your agent">
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', background: '#fff', borderRadius: 12, padding: 4, marginBottom: 18, border: `1px solid ${BORDER}`, gap: 4 }}>
          {[['tools', `🛠️ Tools${tools.length ? ` (${tools.length})` : ''}`], ['assets', `📚 Assets${assets.length ? ` (${assets.length})` : ''}`]].map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '9px 0', borderRadius: 9, border: 'none',
              background: tab === t ? BRAND : 'transparent',
              color: tab === t ? '#fff' : MUTED2,
              fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONTF, transition: 'all .2s',
            }}>{label}</button>
          ))}
        </div>

        {/* Summary strip */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, padding: '0 2px' }}>
          <p style={{ fontSize: 11, fontWeight: 900, color: BRAND, letterSpacing: 1.5, textTransform: 'uppercase', margin: 0 }}>
            {tab === 'tools' ? 'Teaching Tools' : 'Exam Resources'}
          </p>
          {!loading && <span style={{ fontSize: 12, fontWeight: 700, color: MUTED }}>{ownedCount} of {items.length} unlocked</span>}
        </div>

        {/* List */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ height: 92, borderRadius: 16, background: '#F3F4F6', animation: 'pulse-dot 1.5s ease-in-out infinite' }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px', color: MUTED2, fontSize: 14 }}>
            Nothing here yet — check back soon.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {items.map((item) => (
              <ItemCard key={item.id} item={item} busy={busyId === item.id} onBuy={buy} />
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
