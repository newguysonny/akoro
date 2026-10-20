import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowRight, Check, Lock, Loader2, LayoutGrid, Wrench, BookOpen, Play } from 'lucide-react';
import ToolWorkbench from '../components/ToolWorkbench.jsx';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { GREEN } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;

const CATEGORIES = [
  { key: 'all',    label: 'All',    icon: LayoutGrid, ti: 'ti-layout-grid' },
  { key: 'tools',  label: 'Tools',  icon: Wrench, ti: 'ti-tool' },
  { key: 'assets', label: 'Assets', icon: BookOpen, ti: 'ti-book' },
];

/* ── Tool / asset card ───────────────────────────────────────────── */
function AppCard({ item, busy, onBuy, onOpen }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: C.surface, border: `1px solid ${item.owned ? `${GREEN}40` : C.border}`, borderRadius: 16,
        padding: '24px 22px 20px', display: 'flex', flexDirection: 'column',
        alignItems: 'center', textAlign: 'center', fontFamily: C.font,
        boxShadow: hover ? '0 10px 30px rgba(26,26,46,.10)' : '0 1px 3px rgba(26,26,46,.04)',
        transform: hover ? 'translateY(-3px)' : 'none', transition: 'all .18s',
      }}
    >
      <div style={{ width: 60, height: 60, borderRadius: 16, background: tint(8), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 14 }}>
        {(() => { const I = item._kind === 'tool' ? Wrench : BookOpen; const ti = item._kind === 'tool' ? 'ti-tool' : 'ti-book'; return <Ico lucide={I} ti={ti} size={28} color={C.brand} />; })()}
      </div>

      <h3 style={{ fontSize: 15.5, fontWeight: 800, color: C.ink, margin: '0 0 7px' }}>{item.name}</h3>
      <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55, margin: '0 0 14px', minHeight: 38 }}>{item.description}</p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 14, gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, background: tint(7), color: C.brand, fontSize: 11, fontWeight: 700 }}>
          {item._kind === 'tool' ? <Ico lucide={Wrench} ti="ti-tool" size={11} /> : <Ico lucide={BookOpen} ti="ti-book" size={11} />}
          {item.tag || (item._kind === 'tool' ? 'Tool' : 'Asset')}
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 900, color: item.price === 0 ? GREEN : C.ink }}>
          {item.price === 0 ? 'Free' : naira(item.price)}
        </span>
      </div>

      {item.owned ? (
        /* "Unlocked ✓" used to be a disabled badge — the page sold you a tool
           and then gave you nowhere to use it. If the item is one the workbench
           can run, this opens it; if not, it stays a badge, because promising
           an action we cannot perform is worse than the badge was. */
        onOpen ? (
          <button onClick={() => onOpen(item)} style={{
            width: '100%', padding: '11px', borderRadius: 10, border: `1px solid ${GREEN}40`,
            background: `${GREEN}12`, color: GREEN, fontSize: 13, fontWeight: 800,
            fontFamily: C.font, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          }}>
            <Ico lucide={Play} ti="ti-player-play" size={14} /> Open
          </button>
        ) : (
          <button disabled style={{
            width: '100%', padding: '11px', borderRadius: 10, border: 'none',
            background: `${GREEN}15`, color: GREEN, fontSize: 13, fontWeight: 800,
            fontFamily: C.font, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          }}>
            <Ico lucide={Check} ti="ti-check" size={15} /> Unlocked
          </button>
        )
      ) : (
        <button onClick={() => onBuy(item)} disabled={busy} style={{
          width: '100%', padding: '11px', borderRadius: 10, border: 'none',
          background: busy ? '#E5E7EB' : `linear-gradient(135deg,${C.brand},${C.brandDeep})`,
          color: busy ? '#9CA3AF' : '#fff', fontSize: 13, fontWeight: 800,
          fontFamily: C.font, cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        }}>
          {busy ? <Ico lucide={Loader2} ti="ti-loader-2" size={15} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico lucide={Lock} ti="ti-lock" size={14} />}
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
  // Which catalog keys the workbench can run. The catalog and the teaching
  // tools share one key namespace — lockState() looks platform_tools up BY the
  // teaching-tool key — so a catalog item is runnable exactly when a tool of
  // the same key exists. Asked rather than assumed, so a catalog entry with no
  // runner keeps the old badge instead of an Open button that goes nowhere.
  const [runnable, setRunnable] = useState(new Set());
  const [openKey, setOpenKey]   = useState(null);
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
    apiGet('/api/teaching/tools')
      .then((r) => setRunnable(new Set((r.data || []).map((t) => t.key))))
      .catch(() => { /* no workbench access — every card keeps its badge */ });
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

  if (openKey) {
    return (
      <PageLayout title="Workbench" subtitle="Run a tool you have unlocked">
        <ToolWorkbench toolKey={openKey} onBack={() => setOpenKey(null)} />
      </PageLayout>
    );
  }

  return (
    <PageLayout title="App Center" subtitle="Browse and unlock tools & assets for your agent">
      {/* Hero */}
      <div style={{
        background: `linear-gradient(120deg, ${C.hero} 0%, #23233f 100%)`,
        borderRadius: 18, padding: '26px 28px', marginBottom: 22,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 20, fontFamily: C.font,
      }}>
        <div style={{ maxWidth: 460 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Ico lucide={LayoutGrid} ti="ti-layout-grid" size={20} color={C.brand} />
            <h2 style={{ fontSize: 21, fontWeight: 800, color: '#fff', margin: 0 }}>Power up your teaching</h2>
          </div>
          <p style={{ fontSize: 13.5, color: 'rgba(255,255,255,.7)', margin: 0, lineHeight: 1.6 }}>
            Unlock platform tools and exam resources your AI agent uses to generate lesson plans, worksheets, reports and more.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {[
            { n: tools.length,  l: 'TOOLS',    c: C.brand },
            { n: assets.length, l: 'ASSETS',   c: '#fff' },
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
          <Ico lucide={Search} ti="ti-search" size={16} color={C.muted2} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tools & assets…"
            style={{ width: '100%', padding: '11px 14px 11px 40px', borderRadius: 12, border: `1.5px solid ${C.border}`, outline: 'none', fontSize: 13.5, fontFamily: C.font, color: C.ink, background: C.surface, boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {CATEGORIES.map((c) => {
            const on = cat === c.key;
            return (
              <button key={c.key} onClick={() => setCat(c.key)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 15px',
                borderRadius: 999, border: `1.5px solid ${on ? C.brand : C.border}`, cursor: 'pointer',
                background: on ? C.brand : C.surface, color: on ? '#fff' : C.muted,
                fontSize: 13, fontWeight: 700, fontFamily: C.font, transition: 'all .15s',
              }}>
                <Ico lucide={c.icon} ti={c.ti} size={14} /> {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 18 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} style={{ height: 230, borderRadius: 16, background: C.tagBg, animation: 'pulse-dot 1.5s ease-in-out infinite' }} />)}
        </div>
      ) : catalog.length === 0 ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: C.muted2, fontFamily: C.font, fontSize: 14 }}>
          {q ? 'No tools or assets match your search.' : 'Nothing here yet — check back soon.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 18 }}>
          {catalog.map((item) => (
            <AppCard
              key={`${item._kind}-${item.id}`}
              item={item}
              busy={busyId === item.id}
              onBuy={buy}
              onOpen={item.owned && runnable.has(item.key) ? () => setOpenKey(item.key) : null}
            />
          ))}
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.hero, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
