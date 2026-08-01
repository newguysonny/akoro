/**
 * MarketplaceDiscovery.jsx — the agent app's browse/buy surface, styled
 * after the learner app's DiscoveryTab.jsx: a category chip row plus
 * horizontal "rails" of rich cards (cover photo, category badge, price),
 * with a bottom-sheet purchase flow instead of an inline expanding card.
 */
import { useState, useEffect, useMemo } from 'react';
import { apiGet, apiPost } from '../services/api.js';
import { BRAND, GREEN, GOLD, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, FONT, CATEGORIES } from '../constants.js';

const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (n) => Number(n || 0).toLocaleString();
const fmtCount = (n) => { const v = Number(n) || 0; return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(v); };
const catInfo = (key) => CATEGORIES[key] || CATEGORIES.other;

/* ── Startup card (Discovery-style vertical) ─────────────────────────── */
const CARD_W = 172;
function StartupCard({ s, onOpen, wide }) {
  const cat = catInfo(s.category);
  return (
    <button onClick={() => onOpen(s)} style={{
      textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
      fontFamily: FONT, display: 'flex', flexDirection: 'column', gap: 7,
      width: wide ? '100%' : CARD_W, flexShrink: 0,
    }}>
      <div style={{
        width: '100%', aspectRatio: '16/10', borderRadius: 12, overflow: 'hidden', position: 'relative',
        background: `linear-gradient(135deg, ${cat.color}22, ${cat.color}0D)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${cat.color}33`,
      }}>
        {s.cover_image_url
          ? <img src={s.cover_image_url} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          : null}
        <span style={{ fontSize: 42, opacity: s.cover_image_url ? 0 : 1 }}>{cat.icon}</span>
        {s.boughtBefore && <span style={{ position: 'absolute', top: 7, left: 7, fontSize: 9, fontWeight: 900, color: '#fff', background: GREEN, padding: '3px 7px', borderRadius: 6 }}>BOUGHT BEFORE</span>}
        <span style={{ position: 'absolute', bottom: 7, right: 7, fontSize: 9, fontWeight: 900, color: cat.color, background: '#fff', padding: '3px 7px', borderRadius: 6 }}>{cat.icon} {cat.label}</span>
      </div>

      <div style={{ fontSize: 13.5, fontWeight: 900, color: INK, lineHeight: 1.25,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 34 }}>
        {s.name}
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {s.description || `${usd(s.credit_rate_usd)} per credit`}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 900, color: INK }}>{usd(s.credit_rate_usd)}</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: MUTED2 }}>/ credit</span>
        {s.codesSold > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, color: MUTED2, marginLeft: 'auto' }}>🎟️ {fmtCount(s.codesSold)} sold</span>}
      </div>
    </button>
  );
}

/* ── Section rail: header + See all + horizontal scroll / grid ──────── */
function Rail({ title, hi, accent, count, loading, expanded, onToggle, children, emptyText }) {
  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 4px', gap: 10 }}>
        <h2 style={{ fontSize: 18, fontWeight: 900, color: INK, margin: 0, lineHeight: 1.15 }}>
          {title}<span style={{ color: accent }}>{hi}</span>
        </h2>
        {count > 0 && (
          <button onClick={onToggle} style={{ background: 'none', border: 'none', color: BRAND, fontSize: 12.5, fontWeight: 900, cursor: 'pointer', fontFamily: FONT, flexShrink: 0 }}>
            {expanded ? 'Show less' : 'See all'}
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', gap: 12, padding: '12px 4px 4px', overflow: 'hidden' }}>
          {[0, 1, 2].map((i) => <div key={i} style={{ width: CARD_W, flexShrink: 0, height: 160, borderRadius: 12, background: LIGHT }} />)}
        </div>
      ) : count === 0 ? (
        <p style={{ fontSize: 12.5, fontWeight: 600, color: MUTED2, padding: '10px 4px 0', margin: 0 }}>{emptyText}</p>
      ) : expanded ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px 10px', padding: '12px 4px 4px' }}>{children}</div>
      ) : (
        <div style={{ display: 'flex', gap: 12, padding: '12px 4px 6px', overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>{children}</div>
      )}
    </section>
  );
}

/* ── Category chips ───────────────────────────────────────────────── */
function Categories({ value, onChange, counts }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 12, padding: '0 0 2px', overflowX: 'auto', scrollbarWidth: 'none' }}>
      <Chip active={value === 'all'} onClick={() => onChange('all')} icon="🧭" label="All" />
      {Object.entries(CATEGORIES).map(([key, c]) => counts[key] > 0 && (
        <Chip key={key} active={value === key} onClick={() => onChange(key)} icon={c.icon} label={c.label} color={c.color} />
      ))}
    </div>
  );
}
function Chip({ active, onClick, icon, label, color = BRAND }) {
  return (
    <button onClick={onClick} style={{
      flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '9px 15px', borderRadius: 100,
      border: active ? `1.5px solid ${color}` : `1.5px solid ${BORDER}`,
      background: active ? `${color}12` : WHITE, cursor: 'pointer', fontFamily: FONT,
    }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: active ? color : INK, whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  );
}

/* ── Purchase sheet — swipe-up bottom sheet, opened from a card tap ───
 * Two ways to buy: pick one of the business's fixed-price products
 * (gift-card-style denominations), or a custom credits × quantity amount
 * priced off the base rate + bulk discount tiers. Both are always
 * available — a product list doesn't replace the custom option. */
function PurchaseSheet({ startup, onClose, onBought, onToast }) {
  const hasProducts = (startup.products || []).length > 0;
  const [mode, setMode] = useState(hasProducts ? 'products' : 'custom');
  const cat = catInfo(startup.category);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(17,12,40,.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: WHITE, width: '100%', maxWidth: 540, maxHeight: '86vh', borderRadius: '22px 22px 0 0', overflowY: 'auto', fontFamily: FONT, animation: 'sheet-up .28s cubic-bezier(.34,1.4,.6,1)' }}>
        <style>{`@keyframes sheet-up{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
        <div style={{ position: 'sticky', top: 0, background: WHITE, padding: '10px 0 4px', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 38, height: 4, borderRadius: 4, background: BORDER }} />
        </div>

        <div style={{ padding: '4px 20px 26px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 54, height: 54, borderRadius: 14, flexShrink: 0, overflow: 'hidden', position: 'relative', background: `linear-gradient(135deg, ${cat.color}22, ${cat.color}0D)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {startup.cover_image_url
                ? <img src={startup.cover_image_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                : <span style={{ fontSize: 26 }}>{cat.icon}</span>}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{startup.name}</div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{cat.icon} {cat.label} · {usd(startup.credit_rate_usd)} / credit</div>
            </div>
          </div>

          {startup.description && <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, margin: '0 0 16px' }}>{startup.description}</p>}

          {hasProducts && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <ModeTab active={mode === 'products'} onClick={() => setMode('products')} label="Voucher packs" />
              <ModeTab active={mode === 'custom'} onClick={() => setMode('custom')} label="Custom amount" />
            </div>
          )}

          {mode === 'products'
            ? <ProductsPurchase startup={startup} onBought={onBought} onToast={onToast} onClose={onClose} />
            : <CustomPurchase startup={startup} onBought={onBought} onToast={onToast} onClose={onClose} />}
        </div>
      </div>
    </div>
  );
}

function ModeTab({ active, onClick, label }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '9px 0', borderRadius: 10, border: active ? `1.5px solid ${BRAND}` : `1.5px solid ${BORDER}`,
      background: active ? `${BRAND}12` : WHITE, cursor: 'pointer', fontFamily: FONT,
      fontSize: 12.5, fontWeight: 800, color: active ? BRAND : MUTED,
    }}>{label}</button>
  );
}

function ProductsPurchase({ startup, onBought, onToast, onClose }) {
  const [selected, setSelected] = useState(null);
  const [qty, setQty] = useState(null);
  const [busy, setBusy] = useState(false);

  const pick = (p) => { setSelected(p); setQty(p.min_order_qty); };

  const buy = async () => {
    setBusy(true);
    try {
      const r = await apiPost('/api/vouchers/purchase-product', { startupId: startup.id, productId: selected.id, quantity: qty });
      onToast(`Bought ${r.quantity} × ${r.productName} · ${usd(r.totalCostUsd)}`);
      onBought(); onClose();
    } catch (e) {
      onToast(e.message?.includes('INSUFFICIENT') || e.status === 402 ? 'Insufficient wallet balance — top up first' : (e.message || 'Purchase failed'));
    } finally { setBusy(false); }
  };

  return (
    <div>
      {(startup.products || []).map((p) => (
        <div key={p.id} style={{ border: `1px solid ${selected?.id === p.id ? BRAND : BORDER}`, borderRadius: 12, padding: 14, marginBottom: 10, cursor: 'pointer' }}
          onClick={() => pick(selected?.id === p.id ? null : p)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 900, color: INK }}>{p.name}</div>
              <div style={{ fontSize: 11.5, color: MUTED2, marginTop: 2 }}>{fmt(p.credits)} credits · min. order {p.min_order_qty}</div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 900, color: INK }}>{usd(p.price_usd)}</div>
          </div>

          {selected?.id === p.id && (
            <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
              <label style={lbl}>Quantity (min. {p.min_order_qty})</label>
              <input type="number" min={p.min_order_qty} value={qty} onChange={(e) => setQty(Number(e.target.value))} style={inp} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0' }}>
                <span style={{ fontSize: 12.5, color: MUTED, fontWeight: 700 }}>Total</span>
                <span style={{ fontSize: 18, fontWeight: 900, color: INK }}>{usd(p.price_usd * (qty || 0))}</span>
              </div>
              <button onClick={buy} disabled={busy || !qty || qty < p.min_order_qty} style={{ width: '100%', padding: 13, borderRadius: 12, border: 'none', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: '#fff', fontSize: 14, fontWeight: 900, cursor: 'pointer', fontFamily: FONT }}>
                {busy ? 'Buying…' : 'Confirm purchase'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CustomPurchase({ startup, onBought, onToast, onClose }) {
  const [unitCredits, setUnitCredits] = useState(100);
  const [qty, setQty] = useState(10);
  const [busy, setBusy] = useState(false);

  const tierFor = (q) => {
    const applicable = (startup.discountTiers || []).filter((t) => q * unitCredits >= t.min_credits);
    return applicable.sort((a, b) => b.min_credits - a.min_credits)[0];
  };
  const tier = tierFor(qty);
  const unitPrice = startup.credit_rate_usd * (1 - (tier?.discount_pct || 0) / 100);

  const buy = async () => {
    setBusy(true);
    try {
      const r = await apiPost('/api/vouchers/purchase', { startupId: startup.id, quantity: qty, unitCredits });
      onToast(`Bought ${r.quantity} codes · ${usd(r.totalCostUsd)}`);
      onBought(); onClose();
    } catch (e) {
      onToast(e.message?.includes('INSUFFICIENT') || e.status === 402 ? 'Insufficient wallet balance — top up first' : (e.message || 'Purchase failed'));
    } finally { setBusy(false); }
  };

  return (
    <div>
      {startup.discountTiers?.length > 0 && (
        <div style={{ fontSize: 11.5, color: MUTED2, background: LIGHT, borderRadius: 10, padding: '8px 12px', marginBottom: 16 }}>
          Bulk discounts: {startup.discountTiers.map((t) => `${fmt(t.min_credits)}+ → −${t.discount_pct}%`).join(' · ')}
        </div>
      )}

      <label style={lbl}>Credits per code</label>
      <input type="number" min="1" value={unitCredits} onChange={(e) => setUnitCredits(Number(e.target.value))} style={inp} />
      <label style={lbl}>Number of codes</label>
      <input type="number" min="1" value={qty} onChange={(e) => setQty(Number(e.target.value))} style={inp} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '14px 0' }}>
        <span style={{ fontSize: 12.5, color: MUTED, fontWeight: 700 }}>Total{tier ? ` (−${tier.discount_pct}% tier)` : ''}</span>
        <span style={{ fontSize: 19, fontWeight: 900, color: INK }}>{usd(unitPrice * qty)}</span>
      </div>

      <button onClick={buy} disabled={busy} style={{ width: '100%', padding: 14, borderRadius: 13, border: 'none', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: '#fff', fontSize: 14.5, fontWeight: 900, cursor: 'pointer', fontFamily: FONT }}>
        {busy ? 'Buying…' : 'Confirm purchase'}
      </button>
    </div>
  );
}

/* ── Main: MarketplaceDiscovery ───────────────────────────────────── */
export default function MarketplaceDiscovery({ onToast, onBought }) {
  const [startups, setStartups] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [cat, setCat] = useState('all');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    apiGet('/api/vouchers/marketplace')
      .then((r) => setStartups(r.startups || []))
      .catch((e) => { setLoadErr(e.message || 'Could not load the marketplace'); setStartups([]); });
  }, []);

  const q = query.trim().toLowerCase();
  const byQuery = (s) => !q || `${s.name} ${s.description || ''}`.toLowerCase().includes(q);
  const byCat = (s) => cat === 'all' || (s.category || 'other') === cat;

  const filtered = useMemo(() => (startups || []).filter((s) => byCat(s) && byQuery(s)), [startups, cat, q]);
  const counts = useMemo(() => {
    const c = {};
    (startups || []).forEach((s) => { const k = s.category || 'other'; c[k] = (c[k] || 0) + 1; });
    return c;
  }, [startups]);

  const recommended = useMemo(() => [...filtered].sort((a, b) => (b.codesSold - a.codesSold)), [filtered]);
  const newest = useMemo(() => [...filtered].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [filtered]);
  const toggle = (k) => setExpanded((e) => ({ ...e, [k]: !e[k] }));

  const rail = (key, title, hi, accent, items) => (
    <Rail title={title} hi={hi} accent={accent} count={items.length} loading={false}
      expanded={!!expanded[key]} onToggle={() => toggle(key)} emptyText="Nothing here yet.">
      {(expanded[key] ? items : items.slice(0, 10)).map((s) => (
        <StartupCard key={`${key}-${s.id}`} s={s} wide={expanded[key]} onOpen={setPicked} />
      ))}
    </Rail>
  );

  if (startups === null) return <div style={{ textAlign: 'center', padding: 40, color: MUTED2 }}>Loading…</div>;
  if (!startups.length) return <div style={{ textAlign: 'center', padding: 40, color: MUTED2, fontSize: 13 }}>{loadErr ? `Couldn't load the marketplace — ${loadErr}` : 'No startups are selling credit yet.'}</div>;

  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: .5 }}>🔍</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search businesses"
          style={{ width: '100%', boxSizing: 'border-box', padding: '11px 13px 11px 36px', borderRadius: 13, border: `1px solid ${BORDER}`, background: WHITE, fontSize: 13, fontWeight: 600, color: INK, fontFamily: FONT, outline: 'none' }} />
      </div>

      <Categories value={cat} onChange={setCat} counts={counts} />

      {rail('reco', 'Recommended ', 'for you', BRAND, recommended)}
      {rail('new', 'New ', 'businesses', GOLD, newest)}
      {rail('all', 'All ', 'businesses', '#EC4899', filtered)}

      {picked && <PurchaseSheet startup={picked} onClose={() => setPicked(null)} onBought={onBought} onToast={onToast} />}
    </div>
  );
}

const lbl = { display: 'block', fontSize: 11.5, fontWeight: 700, color: MUTED2, margin: '10px 0 4px' };
const inp = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER}`, fontSize: 13.5, fontFamily: FONT, outline: 'none' };
