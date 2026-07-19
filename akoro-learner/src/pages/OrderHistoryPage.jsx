/**
 * OrderHistoryPage — every payment the learner has made: course & cart orders
 * plus direct teaching-guide purchases, newest first.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Receipt, BookOpen, ShoppingCart, Bot } from 'lucide-react';
import { getOrderHistory } from '../services/ordersApi.js';

const FONT = "'Nunito', sans-serif";
const BRAND = '#6C3BFF', GREEN = '#10B981', RED = '#EF4444', GOLD = '#F59E0B';
const ngn = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const STATUS = {
  success:  { label: 'Paid',     bg: '#DCFCE7', color: GREEN },
  pending:  { label: 'Pending',  bg: '#FEF3C7', color: '#B45309' },
  refunded: { label: 'Refunded', bg: '#F1F0F4', color: '#6B6B80' },
  failed:   { label: 'Failed',   bg: '#FEE2E2', color: RED },
  abandoned:{ label: 'Abandoned',bg: '#FEE2E2', color: RED },
};
const KIND_ICON = { order: ShoppingCart, course: BookOpen, agent: Bot };

export default function OrderHistoryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = () => { (location.key && location.key !== 'default') ? navigate(-1) : navigate('/settings'); };
  const [orders, setOrders] = useState(null);   // null = loading

  useEffect(() => {
    let alive = true;
    getOrderHistory().then((o) => { if (alive) setOrders(o); }).catch(() => { if (alive) setOrders([]); });
    return () => { alive = false; };
  }, []);

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
            <button onClick={() => navigate('/app')} style={{ marginTop: 18, padding: '11px 22px', borderRadius: 12, border: 'none', background: BRAND, color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Browse courses</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {orders.map((o) => {
              const s = STATUS[o.status] || STATUS.pending;
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
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
