/**
 * OrderHistoryPage — every payment the learner has made: course & cart orders
 * plus direct teaching-guide purchases, newest first.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Receipt, BookOpen, ShoppingCart, Bot } from 'lucide-react';
import { getOrderHistory, requestRefund } from '../services/ordersApi.js';
import { verifyCheckout } from '../services/cartApi.js';
import Toast from '../components/common/Toast.jsx';
import { APP_HOME } from '../config/target.js';

const FONT = "'Nunito', sans-serif";
const BRAND = '#6C3BFF', GREEN = '#10B981', RED = '#EF4444', GOLD = '#F59E0B';
const REFUND_WINDOW_DAYS = 30;
const ngn = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const daysSince = (d) => d ? (Date.now() - new Date(d).getTime()) / 86_400_000 : Infinity;
// Only course/cart payments are refundable (payment-based), while still 'success'
// and inside the money-back window.
const isRefundable = (o) => (o.kind === 'course' || o.kind === 'order') && o.status === 'success' && !!o.payment_id && daysSince(o.date) <= REFUND_WINDOW_DAYS;

const STATUS = {
  success:   { label: 'Paid',       bg: '#DCFCE7', color: GREEN },
  processing:{ label: 'Processing', bg: '#DBEAFE', color: '#2563EB' },
  pending:   { label: 'Pending',    bg: '#FEF3C7', color: '#B45309' },
  refunded:  { label: 'Refunded',   bg: '#F1F0F4', color: '#6B6B80' },
  failed:    { label: 'Failed',     bg: '#FEE2E2', color: RED },
  abandoned: { label: 'Abandoned',  bg: '#FEE2E2', color: RED },
};
const KIND_ICON = { order: ShoppingCart, course: BookOpen, agent: Bot };
// Pending + an async method (bank/USSD) is legitimately still settling → show
// it as "Processing" rather than the more ambiguous "Pending".
const effectiveStatus = (o) =>
  (o.status === 'pending' && (o.method === 'bank' || o.method === 'ussd')) ? 'processing' : o.status;

export default function OrderHistoryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = () => { (location.key && location.key !== 'default') ? navigate(-1) : navigate(APP_HOME); };
  const [orders, setOrders] = useState(null);   // null = loading
  const [refundOrder, setRefundOrder] = useState(null);   // order being refunded
  const [reason, setReason] = useState('');
  const [busy, setBusy]   = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let alive = true;
    getOrderHistory().then((o) => {
      if (!alive) return;
      setOrders(o);
      // Self-heal: a paid cart order may be stuck 'pending' if its Paystack
      // webhook was missed/delayed. Re-verify each with Paystack on open; a
      // genuinely unpaid order just stays pending.
      (o || []).filter((x) => x.status === 'pending' && x.kind === 'order' && x.reference).forEach(async (x) => {
        try {
          const d = await verifyCheckout(x.reference);
          if (alive && d?.fulfilled) setOrders((list) => (list || []).map((y) => y.id === x.id ? { ...y, status: 'success' } : y));
        } catch { /* leave pending */ }
      });
    }).catch(() => { if (alive) setOrders([]); });
    return () => { alive = false; };
  }, []);

  const submitRefund = async () => {
    if (!refundOrder) return;
    setBusy(true);
    try {
      await requestRefund(refundOrder.payment_id, reason.trim() || undefined);
      setOrders((list) => (list || []).map((o) => o.id === refundOrder.id ? { ...o, status: 'refunded' } : o));
      setToast({ msg: 'Refund processed', color: GREEN });
      setRefundOrder(null); setReason('');
    } catch (e) {
      setToast({ msg: e?.message || 'Could not process refund', color: RED });
    } finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--ak-bg)', fontFamily: FONT, color: 'var(--ak-text)' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--ak-surface)', borderBottom: '1px solid var(--ak-border)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={goBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ak-text)', display: 'flex' }}><ArrowLeft size={20} /></button>
        <span style={{ fontSize: 15, fontWeight: 900 }}>Order history</span>
      </div>

      <div style={{ maxWidth: 620, margin: '0 auto', padding: '16px 18px 40px' }}>
        {orders === null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3, 4].map((i) => <div key={i} style={{ height: 68, borderRadius: 14, background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', opacity: 0.6 }} />)}
          </div>
        ) : orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '64px 20px', color: 'var(--ak-text-muted)' }}>
            <Receipt size={40} style={{ marginBottom: 12, opacity: 0.5 }} />
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ak-text)' }}>No orders yet</div>
            <div style={{ fontSize: 13.5, marginTop: 4 }}>Your course, class and teaching-guide payments will show up here.</div>
            <button onClick={() => navigate(APP_HOME)} style={{ marginTop: 18, padding: '11px 22px', borderRadius: 12, border: 'none', background: BRAND, color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Browse courses</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {orders.map((o) => {
              const s = STATUS[effectiveStatus(o)] || STATUS.pending;
              const Icon = KIND_ICON[o.kind] || Receipt;
              return (
                <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 14, padding: '13px 14px' }}>
                  <span style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, background: `${BRAND}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: BRAND }}>
                    <Icon size={20} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--ak-text-muted)' }}>{o.subtitle} · {fmtDate(o.date)}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--ak-text)' }}>{o.amount_ngn === 0 ? 'Free' : ngn(o.amount_ngn)}</div>
                    <span style={{ display: 'inline-block', marginTop: 4, fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: s.bg, color: s.color }}>{s.label}</span>
                    {isRefundable(o) && (
                      <div><button onClick={() => { setRefundOrder(o); setReason(''); }}
                        style={{ marginTop: 6, background: 'none', border: 'none', color: BRAND, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, padding: 0 }}>Request refund</button></div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Refund confirmation */}
      {refundOrder && (
        <div onClick={() => !busy && setRefundOrder(null)} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: 'var(--ak-surface)', borderRadius: '18px 18px 0 0', padding: '20px 18px calc(20px + env(safe-area-inset-bottom,0px))' }}>
            <div style={{ fontSize: 17, fontWeight: 900, color: 'var(--ak-text)', marginBottom: 6 }}>Request a refund?</div>
            <p style={{ fontSize: 13.5, color: 'var(--ak-text-muted)', lineHeight: 1.6, margin: '0 0 14px' }}>
              You’ll lose access to <strong style={{ color: 'var(--ak-text)' }}>{refundOrder.title}</strong>{refundOrder.kind === 'order' ? ' (all items in this order)' : ''}, and {ngn(refundOrder.amount_ngn)} will be refunded to your payment method.
            </p>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" rows={2}
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 11, border: '1px solid var(--ak-border2)', background: 'var(--ak-bg)', fontSize: 13, fontWeight: 600, color: 'var(--ak-text)', fontFamily: FONT, outline: 'none', resize: 'none' }} />
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button onClick={() => setRefundOrder(null)} disabled={busy} style={{ flex: 1, padding: '12px', borderRadius: 12, border: '1px solid var(--ak-border2)', background: 'transparent', color: 'var(--ak-text)', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Keep it</button>
              <button onClick={submitRefund} disabled={busy} style={{ flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: busy ? '#F1B0B0' : RED, color: '#fff', fontSize: 14, fontWeight: 900, cursor: busy ? 'default' : 'pointer', fontFamily: FONT }}>{busy ? 'Processing…' : 'Refund'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast.msg} color={toast.color} onDone={() => setToast(null)} />}
    </div>
  );
}
