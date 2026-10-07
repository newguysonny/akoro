/**
 * CartPage.jsx — review + checkout for the local cart. Each line item still
 * checks out as its own atomic purchase call (purchase-product or purchase)
 * — there's no multi-item backend endpoint — so checkout runs them one at a
 * time and reports exactly which succeeded, which failed, and why, instead
 * of an all-or-nothing black box.
 */
import { useState, useEffect } from 'react';
import { useCart } from '../contexts/CartContext.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { BRAND, GREEN, RED, GOLD, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, FONT, CATEGORIES } from '../constants.js';
import { Icon } from './Icons.jsx';

const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (n) => Number(n || 0).toLocaleString();
const catInfo = (key) => CATEGORIES[key] || CATEGORIES.other;
const BILLING_LABELS = { one_time: 'One-time', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

// Mirrors modules/vouchers/lib/pricing.js + agent.js: best applicable tier,
// per-credit rate, then price per CODE = rate x credits.
function livePriceFor(item, startup) {
  if (item.type === 'product') {
    const p = (startup.products || []).find((x) => x.id === item.productId);
    return p ? Number(p.price_usd) : null;      // null = no longer sold
  }
  const totalCredits = item.quantity * item.unitCredits;
  const tier = (startup.discountTiers || []).filter((t) => totalCredits >= t.min_credits)
    .sort((a, b) => b.min_credits - a.min_credits)[0];
  const perCredit = Number(startup.credit_rate_usd) * (1 - (tier?.discount_pct || 0) / 100);
  return perCredit * item.unitCredits;
}

export default function CartPage({ onClose, onBought, onToast }) {
  const { items, removeItem, updateQty, updatePrice, clear } = useCart();
  const [checkingOut, setCheckingOut] = useState(false);
  const [results, setResults] = useState(null);   // { succeeded: [], failed: [{item, reason}] } after checkout
  // Prices in the cart are snapshots from when the item was added; the server
  // charges its CURRENT price. Re-check on open so the total shown is the
  // total charged, and surface anything that changed or disappeared.
  const [priceCheck, setPriceCheck] = useState({ changed: [], gone: [] });

  useEffect(() => {
    if (!items.length) return;
    apiGet('/api/vouchers/marketplace').then((r) => {
      const byId = Object.fromEntries((r.startups || []).map((s) => [s.id, s]));
      const changed = [], gone = [];
      items.forEach((i) => {
        const s = byId[i.startupId];
        if (!s) { gone.push(i); return; }
        const live = livePriceFor(i, s);
        if (live == null) { gone.push(i); return; }
        if (Math.abs(live - i.unitPriceUsd) > 0.005) {
          changed.push({ cartId: i.cartId, name: i.productName || i.startupName, from: i.unitPriceUsd, to: live });
          updatePrice(i.cartId, live);
        }
      });
      setPriceCheck({ changed, gone });
    }).catch(() => { /* offline — checkout still validates server-side */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const subtotal = items.reduce((s, i) => s + i.unitPriceUsd * i.quantity, 0);
  const minQtyFor = (i) => i.type === 'product' ? i.minOrderQty : 1;

  const checkout = async () => {
    setCheckingOut(true);
    setResults(null);
    const succeeded = [];
    const failed = [];
    for (const item of items) {
      try {
        const body = item.type === 'product'
          ? { startupId: item.startupId, productId: item.productId, quantity: item.quantity }
          : { startupId: item.startupId, quantity: item.quantity, unitCredits: item.unitCredits };
        const path = item.type === 'product' ? '/api/vouchers/purchase-product' : '/api/vouchers/purchase';
        const r = await apiPost(path, body);
        succeeded.push({ item, result: r });
      } catch (e) {
        failed.push({ item, reason: e.message?.includes('INSUFFICIENT') || e.status === 402 ? 'Insufficient wallet balance' : (e.message || 'Purchase failed') });
      }
    }
    setResults({ succeeded, failed });
    setCheckingOut(false);
    // Only clear items that actually went through — a failed item (e.g. one
    // that needed a top-up) stays in the cart so the agent can retry it.
    succeeded.forEach(({ item }) => removeItem(item.cartId));
    if (succeeded.length) onBought();
    if (succeeded.length && !failed.length) onToast(`Order placed — ${succeeded.length} item${succeeded.length > 1 ? 's' : ''}, ${usd(succeeded.reduce((s, x) => s + x.item.unitPriceUsd * x.item.quantity, 0))}`);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2600, background: WHITE, overflowY: 'auto', fontFamily: FONT }}>
      <div style={{ position: 'sticky', top: 0, background: WHITE, borderBottom: `1px solid ${BORDER}`, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, zIndex: 1 }}>
        <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: LIGHT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={16} /></button>
        <div style={{ fontSize: 16, fontWeight: 900, color: INK }}>Your order {items.length > 0 ? `(${items.length})` : ''}</div>
        {items.length > 0 && (
          <button onClick={clear} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: RED, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Clear</button>
        )}
      </div>

      <div style={{ padding: '16px 18px 120px' }}>
        {results && (
          <div style={{ marginBottom: 16 }}>
            {results.succeeded.length > 0 && (
              <div style={{ background: '#F0FDF4', border: `1px solid ${GREEN}44`, borderRadius: 12, padding: 14, marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: INK }}><Icon name="check-circle" size={14} style={{ marginRight: 5, color: GREEN }} /> {results.succeeded.length} item{results.succeeded.length > 1 ? 's' : ''} bought</div>
                <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>Check My Codes for your new codes.</div>
              </div>
            )}
            {results.failed.length > 0 && (
              <div style={{ background: '#FEF2F2', border: `1px solid ${RED}44`, borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: INK, marginBottom: 6 }}><Icon name="alert-triangle" size={14} style={{ marginRight: 5, color: RED }} /> {results.failed.length} item{results.failed.length > 1 ? 's' : ''} couldn't be bought</div>
                {results.failed.map(({ item, reason }) => (
                  <div key={item.cartId} style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>{item.startupName} — {reason}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {priceCheck.changed.length > 0 && (
          <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 12, padding: 13, marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: '#92400E' }}>Prices changed since you added these</div>
            {priceCheck.changed.map((c) => (
              <div key={c.cartId} style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>{c.name}: {usd(c.from)} → {usd(c.to)} each</div>
            ))}
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 5 }}>The total below is up to date.</div>
          </div>
        )}
        {priceCheck.gone.length > 0 && (
          <div style={{ background: '#FEF2F2', border: `1px solid ${RED}44`, borderRadius: 12, padding: 13, marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: INK }}>No longer available</div>
            {priceCheck.gone.map((g) => (
              <div key={g.cartId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 5 }}>
                <span style={{ fontSize: 11.5, color: MUTED }}>{g.productName || g.startupName}</span>
                <button onClick={() => removeItem(g.cartId)} style={{ background: 'none', border: 'none', color: RED, fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>Remove</button>
              </div>
            ))}
          </div>
        )}

        {items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: MUTED2, fontSize: 13 }}>
            {results ? 'Your cart is empty.' : 'Your cart is empty — add a voucher pack or custom amount from a business’s menu.'}
          </div>
        ) : (
          items.map((item) => {
            const cat = catInfo(item.category);
            const min = minQtyFor(item);
            return (
              <div key={item.cartId} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: `1px solid ${BORDER}` }}>
                <div style={{ width: 60, height: 60, borderRadius: 10, flexShrink: 0, overflow: 'hidden', background: `linear-gradient(135deg, ${cat.color}22, ${cat.color}0D)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
                  {(item.imageUrl || item.coverImageUrl)
                    ? <img src={item.imageUrl || item.coverImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    : cat.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{item.startupName}</div>
                  <div style={{ fontSize: 11.5, color: MUTED, marginTop: 1 }}>
                    {item.type === 'product' ? item.productName : `Custom · ${fmt(item.unitCredits)} credits/code`}
                    {item.billingPeriod && item.billingPeriod !== 'one_time' && (
                      <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 900, color: GOLD, background: `${GOLD}18`, padding: '1px 6px', borderRadius: 5 }}>{BILLING_LABELS[item.billingPeriod]}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                    <Stepper value={item.quantity} min={min} onChange={(q) => updateQty(item.cartId, q)} />
                    <span style={{ fontSize: 13, fontWeight: 900, color: INK, marginLeft: 'auto' }}>{usd(item.unitPriceUsd * item.quantity)}</span>
                    <button onClick={() => removeItem(item.cartId)} style={{ background: 'none', border: 'none', color: MUTED2, cursor: 'pointer', display: 'flex', alignItems: 'center' }}><Icon name="x" size={13} /></button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {items.length > 0 && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: WHITE, borderTop: `1px solid ${BORDER}`, padding: '14px 18px calc(14px + env(safe-area-inset-bottom,0px))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: MUTED, fontWeight: 700 }}>Total</span>
            <span style={{ fontSize: 20, fontWeight: 900, color: INK }}>{usd(subtotal)}</span>
          </div>
          <button onClick={checkout} disabled={checkingOut} style={{ width: '100%', padding: 15, borderRadius: 13, border: 'none', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: '#fff', fontSize: 15, fontWeight: 900, cursor: 'pointer', fontFamily: FONT }}>
            {checkingOut ? 'Placing order…' : `Checkout · ${usd(subtotal)}`}
          </button>
        </div>
      )}
    </div>
  );
}

function Stepper({ value, min, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${BORDER}`, borderRadius: 9, padding: '4px 6px' }}>
      <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} style={stepBtn}>−</button>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: INK, minWidth: 22, textAlign: 'center' }}>{value}</span>
      <button onClick={() => onChange(value + 1)} style={stepBtn}>+</button>
    </div>
  );
}
const stepBtn = { width: 22, height: 22, borderRadius: 6, border: 'none', background: LIGHT, cursor: 'pointer', fontSize: 14, fontWeight: 900, color: INK, display: 'flex', alignItems: 'center', justifyContent: 'center' };
