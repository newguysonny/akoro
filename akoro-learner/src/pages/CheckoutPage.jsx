/**
 * CheckoutPage — one checkout UI for three sources:
 *   • cart   (default)  — the whole cart, via checkoutCart()
 *   • course (direct)   — a single course enrol, via /api/payments/initiate
 *   • topup             — buy coins, via /api/wallet/topup/init
 * Reached for course/topup with navigate('/checkout', { state: { mode, … } }).
 * Same order-summary / coupon / payment-method / pay-bar components throughout.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { ArrowLeft, Tag, CreditCard, Landmark, Smartphone, Check, ShieldCheck, CheckCircle2, XCircle, Clock, Ticket } from 'lucide-react';
import { useCart } from '../contexts/CartContext.jsx';
import { applyCoupon as applyCouponApi, checkoutCart, verifyCheckout } from '../services/cartApi.js';
import { apiPost, API } from '../services/api.js';
import Toast from '../components/common/Toast.jsx';

const FONT = "'Nunito', sans-serif";
const BRAND = '#6C3BFF', GREEN = '#10B981', RED = '#EF4444';
const ngn = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;

const METHODS = [
  { key: 'any',  label: 'Any method',    sub: 'Card, bank or USSD on the next screen', icon: ShieldCheck },
  { key: 'card', label: 'Card',          sub: 'Debit / credit card',                   icon: CreditCard },
  { key: 'bank', label: 'Bank transfer', sub: 'Pay from your bank app',                 icon: Landmark },
  { key: 'ussd', label: 'USSD',          sub: 'Dial a code on your phone',              icon: Smartphone },
  { key: 'voucher', label: 'Voucher code', sub: 'Redeem a code bought from an agent',   icon: Ticket },
];

export default function CheckoutPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const st = location.state || {};
  const mode = ['course', 'topup', 'agent'].includes(st.mode) ? st.mode : 'cart';
  const goBack = () => { (location.key && location.key !== 'default') ? navigate(-1) : navigate(mode === 'cart' ? '/cart' : '/app'); };
  const [params] = useSearchParams();
  const payStatus = params.get('payment');   // cart return only
  const { cart, count: cartCount, refresh } = useCart();

  // Normalize the order for whichever source we're checking out.
  let items, subtotalNgn, isFree, headerCount;
  if (mode === 'course') {
    const c = st.course || {};
    items = [{ key: c.id, title: c.title, badge: c.course_type === 'video' ? 'Video' : 'Live', price_ngn: c.price_ngn, is_free: false }];
    subtotalNgn = c.price_ngn || 0; isFree = false; headerCount = 0;
  } else if (mode === 'topup') {
    items = [{ key: 'topup', title: `${Number(st.coins || 0).toLocaleString()} coins`, badge: 'Top-up', price_ngn: st.amountNaira, is_free: false }];
    subtotalNgn = st.amountNaira || 0; isFree = false; headerCount = 0;
  } else if (mode === 'agent') {
    const g = st.listing || {};
    items = [{ key: g.id, title: g.title, badge: 'Guide', price_ngn: g.price_ngn, is_free: !!g.is_free }];
    subtotalNgn = g.is_free ? 0 : (g.price_ngn || 0); isFree = !!g.is_free; headerCount = 0;
  } else {
    items = (cart.items || []).map((i) => ({ key: i.cart_item_id, title: i.title, badge: i.item_type === 'agent' ? 'Guide' : i.course_type === 'video' ? 'Video' : 'Live', price_ngn: i.price_ngn, is_free: i.is_free }));
    subtotalNgn = cart.subtotal_ngn; isFree = (cart.subtotal_kobo || 0) === 0; headerCount = cartCount;
  }
  const canCoupon = mode === 'cart' || mode === 'course';   // top-ups & guides have no coupons

  const [method, setMethod]     = useState('any');
  const [voucherCode, setVoucherCode] = useState('');
  // pay() only implements the voucher path for a CART checkout. Offering it
  // for a single course / top-up / agent purchase let the user pick it, type
  // a code, and get silently sent to Paystack with the code ignored.
  const availableMethods = mode === 'cart' ? METHODS : METHODS.filter((m) => m.key !== 'voucher');
  const [code, setCode]         = useState('');
  const [coupon, setCoupon]     = useState(null);   // { coupon_code, savings_ngn?, final_ngn? }
  const [applying, setApplying] = useState(false);
  const [busy, setBusy]         = useState(false);
  const [toast, setToast]       = useState(null);
  const [verifyState, setVerifyState] = useState('checking');

  // Cart return from Paystack — reconcile then refresh.
  useEffect(() => {
    if (mode !== 'cart' || payStatus !== 'success') return;
    const reference = params.get('reference') || params.get('trxref');
    let alive = true;
    (async () => {
      if (reference) {
        try { const d = await verifyCheckout(reference); if (alive) setVerifyState(d?.fulfilled ? 'done' : 'pending'); }
        catch { if (alive) setVerifyState('pending'); }
      } else if (alive) setVerifyState('done');
      refresh();
    })();
    return () => { alive = false; };
  }, [mode, payStatus, params, refresh]);

  // ── Cart post-payment return screens ───────────────────────────────────────
  if (mode === 'cart' && payStatus === 'success') {
    const boughtCount = Number(params.get('items')) || null;
    const paidNgn = params.get('amount') ? Number(params.get('amount')) / 100 : null;
    return (
      <Shell onBack={goBack} count={headerCount} title="Order confirmed">
        <div style={{ maxWidth: 480, margin: '0 auto', padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, borderRadius: 20, margin: '0 auto 18px', background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CheckCircle2 size={38} color={GREEN} /></div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 8px' }}>Payment successful 🎉</h1>
          <p style={{ fontSize: 14.5, color: 'var(--ak-text-muted)', lineHeight: 1.6, margin: 0 }}>
            {verifyState === 'checking' ? 'Confirming your payment…'
              : verifyState === 'pending' ? 'We’ve received your payment — your access unlocks automatically once it finishes confirming (this can take a moment for bank/USSD).'
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
  if (mode === 'cart' && payStatus && payStatus !== 'success') {
    return (
      <Shell onBack={goBack} count={headerCount} title="Payment not completed">
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
      <Shell onBack={goBack} count={headerCount}>
        <div style={{ textAlign: 'center', padding: '64px 20px', color: 'var(--ak-text-muted)' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ak-text)' }}>Nothing to check out</div>
          <button onClick={() => navigate('/app')} style={{ marginTop: 16, padding: '11px 22px', borderRadius: 12, border: 'none', background: BRAND, color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Browse courses</button>
        </div>
      </Shell>
    );
  }

  const total = coupon && coupon.final_ngn != null ? coupon.final_ngn : subtotalNgn;

  const apply = async () => {
    if (!code.trim()) return;
    setApplying(true);
    try {
      if (mode === 'cart') {
        const res = await applyCouponApi(code.trim());
        const d = res?.data ?? res;
        if (d?.valid) { setCoupon(d); setToast({ msg: `Coupon applied — you save ${ngn(d.savings_ngn)}`, color: GREEN }); }
        else setToast({ msg: 'Coupon could not be applied', color: RED });
      } else {
        // Course: validated server-side at payment; store and apply then.
        setCoupon({ coupon_code: code.trim() });
        setToast({ msg: 'Code added — the discount is applied at payment', color: GREEN });
      }
    } catch (e) {
      setToast({ msg: e?.message || 'Invalid or expired coupon', color: RED });
    } finally { setApplying(false); }
  };
  const clearCoupon = () => { setCoupon(null); setCode(''); };

  const pay = async () => {
    setBusy(true);
    try {
      if (mode === 'course') {
        const r = await fetch(`${API}/api/payments/initiate`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'student' },
          body: JSON.stringify({ course_id: st.course.id, coupon_code: coupon?.coupon_code }),
        });
        if (r.status === 401) { localStorage.setItem('akoro_redirect', st.returnTo || '/app'); navigate('/signin'); return; }
        const d = await r.json().catch(() => ({}));
        const body = d.data || d;
        if (!r.ok) { setToast({ msg: d.message || body.message || 'Could not start payment', color: RED }); return; }
        if (body.free) { setToast({ msg: 'Enrolled! 🎉', color: GREEN }); setTimeout(() => navigate(st.returnTo || '/app'), 900); return; }
        if (body.checkout_url) { window.location.href = body.checkout_url; return; }
        setToast({ msg: 'Payment started', color: GREEN });
      } else if (mode === 'topup') {
        const res = await apiPost('/api/wallet/topup/init', { coins: st.coins, target: st.target || 'user' });
        const d = res?.data ?? res;
        if (d?.authorization_url) { window.location.href = d.authorization_url; return; }
        setToast({ msg: 'Could not start payment', color: RED });
      } else if (mode === 'agent') {
        const res = await apiPost('/api/adaptive/marketplace/checkout', { listingId: st.listing.id });
        const d = res?.data ?? res;
        if (d?.authorization_url) { window.location.href = d.authorization_url; return; }
        if (d?.free || d?.success) { setToast({ msg: `${st.listing.title} unlocked! 🎉`, color: GREEN }); setTimeout(() => navigate(st.returnTo || '/app'), 900); return; }
        setToast({ msg: 'Could not start payment', color: RED });
      } else {
        if (!isFree && method === 'voucher' && !voucherCode.trim()) {
          setToast({ msg: 'Enter your voucher code', color: RED });
          return;
        }
        const res = await checkoutCart({
          coupon_code: coupon?.coupon_code,
          method: isFree ? undefined : method,
          ...(!isFree && method === 'voucher' ? { voucher_code: voucherCode.trim() } : {}),
        });
        const d = res?.data ?? res;
        if (d?.checkout_url) { window.location.href = d.checkout_url; return; }
        if (d?.free) { setToast({ msg: d.message || 'Access granted! 🎉', color: GREEN }); await refresh(); setTimeout(() => navigate('/app'), 1200); return; }
        setToast({ msg: 'Checkout started', color: GREEN }); await refresh();
      }
    } catch (e) {
      setToast({ msg: e?.message || 'Checkout failed — please retry', color: RED });
    } finally { setBusy(false); }
  };

  const card = { background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 16, padding: 16, marginBottom: 14 };
  const h = { fontSize: 12.5, fontWeight: 900, color: 'var(--ak-text)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.4 };
  const title = mode === 'topup' ? 'Top up' : 'Checkout';

  return (
    <Shell onBack={goBack} count={headerCount} title={title}>
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '16px 18px 150px' }}>
        {/* Order summary */}
        <div style={card}>
          <div style={h}>Order summary</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {items.map((i) => (
              <div key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 9, fontWeight: 900, color: BRAND, background: `${BRAND}14`, padding: '2px 7px', borderRadius: 5, textTransform: 'uppercase', flexShrink: 0 }}>{i.badge}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: i.is_free ? GREEN : 'var(--ak-text)', flexShrink: 0 }}>{i.is_free ? 'Free' : ngn(i.price_ngn)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Coupon */}
        {canCoupon && !isFree && (
          <div style={card}>
            <div style={h}><Tag size={12} style={{ verticalAlign: -1 }} /> Discount code</div>
            {coupon ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 800, color: GREEN, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Check size={15} /> {coupon.coupon_code}{coupon.savings_ngn != null ? ` · −${ngn(coupon.savings_ngn)}` : ''}</span>
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
              {availableMethods.map((m) => {
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
            {method === 'voucher' && (
              <div style={{ marginTop: 10 }}>
                <input value={voucherCode} onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX-XXXX"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 11, border: '1px solid var(--ak-border)', background: 'var(--ak-bg)', color: 'var(--ak-text)', fontSize: 14, fontFamily: 'monospace', letterSpacing: 0.5, outline: 'none' }} />
                <div style={{ fontSize: 11.5, color: 'var(--ak-text-muted)', marginTop: 8, lineHeight: 1.5 }}>
                  Your code is redeemed into coins, then this order is paid from your coin balance. If the code doesn’t cover the full amount, the coins stay in your wallet and you can add another code or top up.
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sticky pay bar */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--ak-surface)', borderTop: '1px solid var(--ak-border)', padding: '14px 18px calc(14px + env(safe-area-inset-bottom,0px))' }}>
        <div style={{ maxWidth: 620, margin: '0 auto' }}>
          {coupon && coupon.final_ngn != null && !isFree && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--ak-text-muted)', marginBottom: 4 }}>
              <span>Subtotal</span><span>{ngn(subtotalNgn)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--ak-text-muted)', fontWeight: 700 }}>{isFree ? 'Total' : coupon?.final_ngn != null ? 'Total after discount' : 'Total'}</span>
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
