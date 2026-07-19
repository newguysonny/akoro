/**
 * CheckoutPage — cart → checkout. Review the order, apply a coupon, pick a
 * payment method, then pay (one Paystack transaction for the whole cart, or a
 * direct grant when everything is free).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Tag, CreditCard, Landmark, Smartphone, Check, ShieldCheck } from 'lucide-react';
import { useCart } from '../contexts/CartContext.jsx';
import { applyCoupon as applyCouponApi, checkoutCart } from '../services/cartApi.js';
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
  const { cart, count, refresh } = useCart();
  const items = cart.items || [];
  const isFree = (cart.subtotal_kobo || 0) === 0;

  const [method, setMethod]     = useState('any');
  const [code, setCode]         = useState('');
  const [coupon, setCoupon]     = useState(null);   // { coupon_code, discount_ngn, final_ngn }
  const [applying, setApplying] = useState(false);
  const [busy, setBusy]         = useState(false);
  const [toast, setToast]       = useState(null);

  if (!items.length) {
    return (
      <Shell navigate={navigate} count={count}>
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
    <Shell navigate={navigate} count={count}>
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

function Shell({ navigate, count, children }) {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--ak-bg)', fontFamily: FONT, color: 'var(--ak-text)' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--ak-surface)', borderBottom: '1px solid var(--ak-border)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate('/cart')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ak-text)', display: 'flex' }}><ArrowLeft size={20} /></button>
        <span style={{ fontSize: 15, fontWeight: 900 }}>Checkout</span>
        {count > 0 && <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: BRAND, background: `${BRAND}14`, padding: '2px 10px', borderRadius: 20 }}>{count} item{count === 1 ? '' : 's'}</span>}
      </div>
      {children}
    </div>
  );
}
