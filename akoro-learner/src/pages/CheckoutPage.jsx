/**
 * CheckoutPage — cart → checkout. Review the order, apply a coupon, pick a
 * payment method, then pay (one Paystack transaction for the whole cart, or a
 * direct grant when everything is free).
 */
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { ArrowLeft, Tag, CreditCard, Landmark, Smartphone, Check, ShieldCheck, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useCart } from '../contexts/CartContext.jsx';
import { applyCoupon as applyCouponApi, checkoutCart, verifyCheckout } from '../services/cartApi.js';
import Toast from '../components/common/Toast.jsx';

const FONT = "'Nunito', sans-serif";
const BRAND = '#6C3BFF', GREEN = '#10B981', RED = '#EF4444';
const ngn = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;

const METHODS = [
  { key: 'any',  label: 'Any method',    sub: 'Card, bank or USSD on the next screen', icon: ShieldCheck },
  { key: 'card', label: 'Card',          sub: 'Debit / credit card',                   icon: CreditCard },
  { key: 'bank', label: 'Bank transfer', sub: 'Pay from your bank app',                 icon: Landmark },
  { key: 'ussd', label: 'USSD',          sub: 'Dial a code on your phone',              icon: Smartphone },
];

export default function CheckoutPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // Pop real history if present; else fall back to the cart. Prevents the
  // cart↔checkout back-loop.
  const goBack = () => { (location.key && location.key !== 'default') ? navigate(-1) : navigate('/cart'); };
  const [params] = useSearchParams();
  const payStatus = params.get('payment');   // 'success' | 'failed' | 'cancelled' | null
  const { cart, count, refresh } = useCart();
  const items = cart.items || [];
  const isFree = (cart.subtotal_kobo || 0) === 0;

  const [method, setMethod]     = useState('any');
  const [code, setCode]         = useState('');
  const [coupon, setCoupon]     = useState(null);   // { coupon_code, discount_ngn, final_ngn }
  const [applying, setApplying] = useState(false);
  const [busy, setBusy]         = useState(false);
  const [toast, setToast]       = useState(null);
  const [verifyState, setVerifyState] = useState('checking');   // checking | done | pending

  // Returned from Paystack — actively reconcile with the backend (safety net for
  // a delayed/missed webhook), then refresh so the fulfilled cart clears.
  useEffect(() => {
    if (payStatus !== 'success') return;
    const reference = params.get('reference') || params.get('trxref');
    let alive = true;
    (async () => {
      if (reference) {
        try {
          const d = await verifyCheckout(reference);
          if (alive) setVerifyState(d?.fulfilled ? 'done' : 'pending');
        } catch { if (alive) setVerifyState('pending'); }
      } else {
        if (alive) setVerifyState('done');   // no ref (e.g. free cart) — webhook/direct grant already ran
      }
      refresh();
    })();
    return () => { alive = false; };
  }, [payStatus, params, refresh]);

  // ── Post-payment return screens ────────────────────────────────────────────
  if (payStatus === 'success') {
    const boughtCount = Number(params.get('items')) || null;
    const paidNgn = params.get('amount') ? Number(params.get('amount')) / 100 : null;
    return (
      <Shell onBack={goBack} count={count} title="Order confirmed">
        <div style={{ maxWidth: 480, margin: '0 auto', padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, borderRadius: 20, margin: '0 auto 18px', background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CheckCircle2 size={38} color={GREEN} /></div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 8px' }}>Payment successful 🎉</h1>
          <p style={{ fontSize: 14.5, color: 'var(--ak-text-muted)', lineHeight: 1.6, margin: 0 }}>
            {verifyState === 'checking'
              ? 'Confirming your payment…'
              : verifyState === 'pending'
                ? 'We’ve received your payment — your access unlocks automatically once it finishes confirming (this can take a moment for bank/USSD).'
                : <>You now have access to {boughtCount ? `all ${boughtCount} item${boughtCount === 1 ? '' : 's'}` : 'everything you purchased'}. It’s ready in your sessions and library.</>}
          </p>
          {paidNgn != null && (
            <div style={{ margin: '20px auto 0', maxWidth: 300, background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 14, padding: '14px 16px', fontSize: 13.5, fontFamily: FONT }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ak-text-muted)' }}><span>Items</span><span style={{ color: 'var(--ak-text)', fontWeight: 800 }}>{boughtCount ?? '—'}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}><span style={{ color: 'var(--ak-text-muted)' }}>Amount paid</span><span style={{ color: 'var(--ak-text)', fontWeight: 900 }}>{ngn(paidNgn)}</span></div>
            </div>
          )}
          <button onClick={() => navigate('/app')} style={{ marginTop: 24, width: '100%', maxWidth: 300, padding: '13px', borderRadius: 13, border: 'none', background: `linear-gradient(135deg, ${BRAND}, ${BRAND}CC)`, color: '#fff', fontSize: 14.5, fontWeight: 900, cursor: 'pointer', fontFamily: FONT }}>Go to my sessions</button>
          <div><button onClick={() => navigate('/app')} style={{ marginTop: 10, background: 'none', border: 'none', color: BRAND, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Keep learning →</button></div>
        </div>
      </Shell>
    );
  }
  if (payStatus && payStatus !== 'success') {
    return (
      <Shell onBack={goBack} count={count} title="Payment not completed">
        <div style={{ maxWidth: 480, margin: '0 auto', padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, borderRadius: 20, margin: '0 auto 18px', background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><XCircle size={38} color={RED} /></div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 8px' }}>Payment not completed</h1>
          <p style={{ fontSize: 14.5, color: 'var(--ak-text-muted)', lineHeight: 1.6, margin: 0 }}>Your payment didn’t go through and you weren’t charged. Your cart is still saved — try again whenever you’re ready.</p>
          <button onClick={() => navigate('/checkout')} style={{ marginTop: 24, width: '100%', maxWidth: 300, padding: '13px', borderRadius: 13, border: 'none', background: `linear-gradient(135deg, ${BRAND}, ${BRAND}CC)`, color: '#fff', fontSize: 14.5, fontWeight: 900, cursor: 'pointer', fontFamily: FONT }}>Back to checkout</button>
        </div>
      </Shell>
    );
  }

  if (!items.length) {
    return (
      <Shell onBack={goBack} count={count}>
        <div style={{ textAlign: 'center', padding: '64px 20px', color: 'var(--ak-text-muted)' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ak-text)' }}>Nothing to check out</div>
          <button onClick={() => navigate('/app')} style={{ marginTop: 16, padding: '11px 22px', borderRadius: 12, border: 'none', background: BRAND, color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Browse courses</button>
        </div>
      </Shell>
    );
  }

  const total = coupon ? coupon.final_ngn : cart.subtotal_ngn;

  const apply = async () => {
    if (!code.trim()) return;
    setApplying(true);
    try {
      const res = await applyCouponApi(code.trim());
      const d = res?.data ?? res;
      if (d?.valid) { setCoupon(d); setToast({ msg: `Coupon applied — you save ${ngn(d.savings_ngn)}`, color: GREEN }); }
      else setToast({ msg: 'Coupon could not be applied', color: RED });
    } catch (e) {
      setToast({ msg: e?.message || 'Invalid or expired coupon', color: RED });
    } finally { setApplying(false); }
  };
  const clearCoupon = () => { setCoupon(null); setCode(''); };

  const pay = async () => {
    setBusy(true);
    try {
      const res = await checkoutCart({ coupon_code: coupon?.coupon_code, method: isFree ? undefined : method });
      const d = res?.data ?? res;
      if (d?.checkout_url) { window.location.href = d.checkout_url; return; }
      if (d?.free) { setToast({ msg: d.message || 'Access granted! 🎉', color: GREEN }); await refresh(); setTimeout(() => navigate('/app'), 1200); return; }
      setToast({ msg: 'Checkout started', color: GREEN }); await refresh();
    } catch (e) {
      setToast({ msg: e?.message || 'Checkout failed — please retry', color: RED });
    } finally { setBusy(false); }
  };

  const card = { background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 16, padding: 16, marginBottom: 14 };
  const h = { fontSize: 12.5, fontWeight: 900, color: 'var(--ak-text)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.4 };

  return (
    <Shell onBack={goBack} count={count}>
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '16px 18px 150px' }}>
        {/* Order summary */}
        <div style={card}>
          <div style={h}>Order summary</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {items.map((i) => (
              <div key={i.cart_item_id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 9, fontWeight: 900, color: BRAND, background: `${BRAND}14`, padding: '2px 7px', borderRadius: 5, textTransform: 'uppercase', flexShrink: 0 }}>
                  {i.item_type === 'agent' ? 'Guide' : i.course_type === 'video' ? 'Video' : 'Live'}
                </span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: i.is_free ? GREEN : 'var(--ak-text)', flexShrink: 0 }}>{i.is_free ? 'Free' : ngn(i.price_ngn)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Coupon */}
        {!isFree && (
          <div style={card}>
            <div style={h}><Tag size={12} style={{ verticalAlign: -1 }} /> Discount code</div>
            {coupon ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 800, color: GREEN, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Check size={15} /> {coupon.coupon_code} · −{ngn(coupon.savings_ngn)}</span>
                <button onClick={clearCoupon} style={{ background: 'none', border: 'none', color: RED, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Remove</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Enter code" style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--ak-border2)', background: 'var(--ak-bg)', fontSize: 13, fontWeight: 700, color: 'var(--ak-text)', fontFamily: FONT, outline: 'none', textTransform: 'uppercase' }} />
                <button onClick={apply} disabled={applying || !code.trim()} style={{ padding: '10px 18px', borderRadius: 10, border: `1.5px solid ${BRAND}`, background: 'transparent', color: BRAND, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>{applying ? '…' : 'Apply'}</button>
              </div>
            )}
          </div>
        )}

        {/* Payment method */}
        {!isFree && (
          <div style={card}>
            <div style={h}>Payment method</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {METHODS.map((m) => {
                const on = method === m.key;
                const Icon = m.icon;
                return (
                  <button key={m.key} onClick={() => setMethod(m.key)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', fontFamily: FONT, background: on ? `${BRAND}0D` : 'var(--ak-bg)', border: `1.5px solid ${on ? BRAND : 'var(--ak-border2)'}` }}>
                    <Icon size={19} color={on ? BRAND : 'var(--ak-text-muted)'} style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)' }}>{m.label}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--ak-text-muted)' }}>{m.sub}</div>
                    </div>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${on ? BRAND : 'var(--ak-border2)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {on && <span style={{ width: 9, height: 9, borderRadius: '50%', background: BRAND }} />}
                    </span>
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 11.5, color: 'var(--ak-text-muted)' }}>
              <ShieldCheck size={13} /> Payments are processed securely by Paystack.
            </div>
            {(method === 'bank' || method === 'ussd') && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginTop: 8, padding: '9px 11px', borderRadius: 10, background: `${BRAND}0A`, border: `1px solid ${BRAND}22`, fontSize: 11.5, color: 'var(--ak-text-sec)', lineHeight: 1.5 }}>
                <Clock size={13} color={BRAND} style={{ flexShrink: 0, marginTop: 1 }} />
                {method === 'bank' ? 'Bank transfers' : 'USSD payments'} can take a moment to confirm — your access unlocks automatically once the payment clears.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sticky pay bar */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--ak-surface)', borderTop: '1px solid var(--ak-border)', padding: '14px 18px calc(14px + env(safe-area-inset-bottom,0px))' }}>
        <div style={{ maxWidth: 620, margin: '0 auto' }}>
          {coupon && !isFree && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--ak-text-muted)', marginBottom: 4 }}>
              <span>Subtotal</span><span>{ngn(cart.subtotal_ngn)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--ak-text-muted)', fontWeight: 700 }}>{isFree ? 'Total' : coupon ? 'Total after discount' : 'Total'}</span>
            <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--ak-text)' }}>{isFree ? 'Free' : ngn(total)}</span>
          </div>
          <button onClick={pay} disabled={busy} style={{ width: '100%', padding: '14px', borderRadius: 14, border: 'none', background: busy ? '#C7C2E0' : `linear-gradient(135deg, ${BRAND}, ${BRAND}CC)`, color: '#fff', fontSize: 15, fontWeight: 900, cursor: busy ? 'default' : 'pointer', fontFamily: FONT }}>
            {busy ? 'Processing…' : isFree ? 'Get all — Free' : `Pay ${ngn(total)}`}
          </button>
        </div>
      </div>

      {toast && <Toast msg={toast.msg} color={toast.color} onDone={() => setToast(null)} />}
    </Shell>
  );
}

function Shell({ onBack, count, title = 'Checkout', children }) {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--ak-bg)', fontFamily: FONT, color: 'var(--ak-text)' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--ak-surface)', borderBottom: '1px solid var(--ak-border)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ak-text)', display: 'flex' }}><ArrowLeft size={20} /></button>
        <span style={{ fontSize: 15, fontWeight: 900 }}>{title}</span>
        {count > 0 && <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: BRAND, background: `${BRAND}14`, padding: '2px 10px', borderRadius: 20 }}>{count} item{count === 1 ? '' : 's'}</span>}
      </div>
      {children}
    </div>
  );
}
