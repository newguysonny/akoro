import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowRight, Check, Lock, Loader2, LayoutGrid, Wrench, BookOpen } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, WHITE, GREEN, FONT } from '../constants.js';

const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;

const CATEGORIES = [
  { key: 'all',    label: 'All',    icon: LayoutGrid },
  { key: 'tools',  label: 'Tools',  icon: Wrench },
  { key: 'assets', label: 'Assets', icon: BookOpen },
];

/* ── Tool / asset card ───────────────────────────────────────────── */
function AppCard({ item, busy, onBuy }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: WHITE, border: `1px solid ${item.owned ? `${GREEN}40` : BORDER}`, borderRadius: 16,
        padding: '24px 22px 20px', display: 'flex', flexDirection: 'column',
        alignItems: 'center', textAlign: 'center', fontFamily: FONT,
        boxShadow: hover ? '0 10px 30px rgba(26,26,46,.10)' : '0 1px 3px rgba(26,26,46,.04)',
        transform: hover ? 'translateY(-3px)' : 'none', transition: 'all .18s',
      }}
    >
      <div style={{ width: 60, height: 60, borderRadius: 16, background: `${AMBER}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 14 }}>
        {item.emoji || (item._kind === 'tool' ? '🛠️' : '📚')}
      </div>

      <h3 style={{ fontSize: 15.5, fontWeight: 800, color: INK, margin: '0 0 7px' }}>{item.name}</h3>
      <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.55, margin: '0 0 14px', minHeight: 38 }}>{item.description}</p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 14, gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, background: `${AMBER}12`, color: AMBER, fontSize: 11, fontWeight: 700 }}>
          {item._kind === 'tool' ? <Wrench size={11} /> : <BookOpen size={11} />}
          {item.tag || (item._kind === 'tool' ? 'Tool' : 'Asset')}
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 900, color: item.price === 0 ? GREEN : INK }}>
          {item.price === 0 ? 'Free' : naira(item.price)}
        </span>
      </div>

      {item.owned ? (
        <button disabled style={{
          width: '100%', padding: '11px', borderRadius: 10, border: 'none',
          background: `${GREEN}15`, color: GREEN, fontSize: 13, fontWeight: 800,
          fontFamily: FONT, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        }}>
          <Check size={15} /> Unlocked
        </button>
      ) : (
        <button onClick={() => onBuy(item)} disabled={busy} style={{
          width: '100%', padding: '11px', borderRadius: 10, border: 'none',
          background: busy ? '#E5E7EB' : `linear-gradient(135deg,${AMBER},#D4651E)`,
          color: busy ? '#9CA3AF' : WHITE, fontSize: 13, fontWeight: 800,
          fontFamily: FONT, cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        }}>
          {busy ? <Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> : <Lock size={14} />}
          {item.price === 0 ? 'Get' : 'Unlock'}
        </button>
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */
export default function AppCenterPage() {
  const navigate = useNavigate();
  const [tools, setTools]   = useState([]);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast]   = useState('');
  const [cat, setCat]       = useState('all');
  const [query, setQuery]   = useState('');

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(async () => {
    try {
      const res = await apiGet('/api/instructor/tools');
      setTools((res.tools || []).map((t) => ({ ...t, _kind: 'tool' })));
      setAssets((res.assets || []).map((a) => ({ ...a, _kind: 'asset' })));
    } catch (e) {
      showToast(e.message || 'Could not load catalog');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('tool_ref');
    if (ref) {
      window.history.replaceState({}, '', window.location.pathname);
      apiGet(`/api/instructor/tools/verify/${ref}`)
        .then((r) => showToast(r?.owned ? 'Unlocked ✓' : (r?.message || 'Payment not completed')))
        .catch((e) => showToast(e.message || 'Verification failed'))
        .finally(load);
    } else { load(); }
  }, [load]);

  const buy = async (item) => {
    // Paid → review on the checkout page; free → unlock directly.
    if (item.price !== 0) {
      navigate('/purchase', { state: { title: item.name, subtitle: 'App / tool unlock', amountNaira: item.price, initPath: '/api/instructor/tools/checkout', initBody: { toolId: item.id } } });
      return;
    }
    setBusyId(item.id);
    try {
      const res = await apiPost('/api/instructor/tools/checkout', { toolId: item.id });
      if (res?.owned) { showToast('Unlocked ✓'); await load(); }
      else showToast(res?.error || 'Could not unlock');
    } catch (e) { showToast(e.message || 'Checkout failed'); }
    finally { setBusyId(null); }
  };

  const q = query.trim().toLowerCase();
  const catalog = useMemo(() => {
    let list = cat === 'tools' ? tools : cat === 'assets' ? assets : [...tools, ...assets];
    if (q) list = list.filter((i) => i.name?.toLowerCase().includes(q) || i.description?.toLowerCase().includes(q));
    return list;
  }, [cat, q, tools, assets]);

  const total    = tools.length + assets.length;
  const unlocked = [...tools, ...assets].filter((i) => i.owned).length;

  return (
    <PageLayout title="App Center" subtitle="Browse and unlock tools & assets for your agent">
      {/* Hero */}
      <div style={{
        background: `linear-gradient(120deg, ${INK} 0%, #23233f 100%)`,
        borderRadius: 18, padding: '26px 28px', marginBottom: 22,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 20, fontFamily: FONT,
      }}>
        <div style={{ maxWidth: 460 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <LayoutGrid size={20} color={AMBER} />
            <h2 style={{ fontSize: 21, fontWeight: 800, color: WHITE, margin: 0 }}>Power up your teaching</h2>
          </div>
          <p style={{ fontSize: 13.5, color: 'rgba(255,255,255,.7)', margin: 0, lineHeight: 1.6 }}>
            Unlock platform tools and exam resources your AI agent uses to generate lesson plans, worksheets, reports and more.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {[
            { n: tools.length,  l: 'TOOLS',    c: AMBER },
            { n: assets.length, l: 'ASSETS',   c: WHITE },
            { n: unlocked,      l: 'UNLOCKED', c: GREEN },
          ].map((s) => (
            <div key={s.l} style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12, padding: '12px 18px', textAlign: 'center', minWidth: 74 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.c }}>{s.n}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 1, color: 'rgba(255,255,255,.55)' }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Search + filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>
        <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 220 }}>
          <Search size={16} color={MUTED2} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tools & assets…"
            style={{ width: '100%', padding: '11px 14px 11px 40px', borderRadius: 12, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13.5, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {CATEGORIES.map((c) => {
            const on = cat === c.key;
            return (
              <button key={c.key} onClick={() => setCat(c.key)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 15px',
                borderRadius: 999, border: `1.5px solid ${on ? AMBER : BORDER}`, cursor: 'pointer',
                background: on ? AMBER : WHITE, color: on ? WHITE : MUTED,
                fontSize: 13, fontWeight: 700, fontFamily: FONT, transition: 'all .15s',
              }}>
                <c.icon size={14} /> {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 18 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} style={{ height: 230, borderRadius: 16, background: '#F3F4F6', animation: 'pulse-dot 1.5s ease-in-out infinite' }} />)}
        </div>
      ) : catalog.length === 0 ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: MUTED2, fontFamily: FONT, fontSize: 14 }}>
          {q ? 'No tools or assets match your search.' : 'Nothing here yet — check back soon.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 18 }}>
          {catalog.map((item) => <AppCard key={`${item._kind}-${item.id}`} item={item} busy={busyId === item.id} onBuy={buy} />)}
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
