/**
 * CartPage — the unified cart: courses + agent teaching-guides in one list,
 * paid for together (or granted directly when everything's free).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, ShoppingCart, BookOpen, Bot, ArrowRight } from 'lucide-react';
import { useCart } from '../contexts/CartContext.jsx';
import Toast from '../components/common/Toast.jsx';

const FONT = "'Nunito', sans-serif";
const BRAND = '#6C3BFF', GREEN = '#10B981', RED = '#EF4444';
const ngn = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;

export default function CartPage() {
  const navigate = useNavigate();
  const { cart, count, removeCourse, removeAgent, refresh } = useCart();
  const [removing, setRemoving] = useState(null);
  const [toast, setToast] = useState(null);

  const items = cart.items || [];

  const remove = async (item) => {
    setRemoving(item.cart_item_id);
    try { item.item_type === 'agent' ? await removeAgent(item.listing_id) : await removeCourse(item.course_id); }
    catch { setToast({ msg: 'Could not remove item', color: RED }); }
    finally { setRemoving(null); }
  };

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--ak-bg)', fontFamily: FONT, color: 'var(--ak-text)' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--ak-surface)', borderBottom: '1px solid var(--ak-border)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ak-text)', display: 'flex' }}><ArrowLeft size={20} /></button>
        <span style={{ fontSize: 15, fontWeight: 900 }}>Your Cart</span>
        {count > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: BRAND, background: `${BRAND}14`, padding: '2px 10px', borderRadius: 20 }}>{count} item{count === 1 ? '' : 's'}</span>}
      </div>

      <div style={{ maxWidth: 620, margin: '0 auto', padding: '16px 18px 140px' }}>
        {items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '64px 20px', color: 'var(--ak-text-muted)' }}>
            <ShoppingCart size={40} style={{ marginBottom: 12, opacity: 0.5 }} />
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ak-text)' }}>Your cart is empty</div>
            <div style={{ fontSize: 13.5, marginTop: 4 }}>Add courses, live classes or teaching guides and check out together.</div>
            <button onClick={() => navigate('/app')} style={{ marginTop: 18, padding: '11px 22px', borderRadius: 12, border: 'none', background: BRAND, color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Browse courses</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {items.map((item) => (
                <div key={item.cart_item_id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ width: 48, height: 48, borderRadius: 11, flexShrink: 0, background: item.cover_image_url ? `url(${item.cover_image_url}) center/cover` : `${BRAND}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: BRAND }}>
                    {!item.cover_image_url && (item.item_type === 'agent' ? <Bot size={22} /> : <BookOpen size={22} />)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 900, color: BRAND, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                      {item.item_type === 'agent' ? 'Teaching guide' : item.course_type === 'video' ? 'Video course' : 'Live class'}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--ak-text-muted)' }}>{item.instructor?.full_name || ''}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: item.is_free ? GREEN : 'var(--ak-text)' }}>{item.is_free ? 'Free' : ngn(item.price_ngn)}</div>
                    <button onClick={() => remove(item)} disabled={removing === item.cart_item_id} style={{ marginTop: 6, background: 'none', border: 'none', cursor: 'pointer', color: RED, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 700, fontFamily: FONT }}>
                      <Trash2 size={13} /> Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {items.length > 0 && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--ak-surface)', borderTop: '1px solid var(--ak-border)', padding: '14px 18px calc(14px + env(safe-area-inset-bottom,0px))' }}>
          <div style={{ maxWidth: 620, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--ak-text-muted)', fontWeight: 700 }}>Subtotal</span>
              <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--ak-text)' }}>{cart.subtotal_kobo === 0 ? 'Free' : ngn(cart.subtotal_ngn)}</span>
            </div>
            <button onClick={() => navigate('/checkout')} style={{ width: '100%', padding: '14px', borderRadius: 14, border: 'none', background: `linear-gradient(135deg, ${BRAND}, ${BRAND}CC)`, color: '#fff', fontSize: 15, fontWeight: 900, cursor: 'pointer', fontFamily: FONT, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              Proceed to checkout <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast.msg} color={toast.color} onDone={() => setToast(null)} />}
    </div>
  );
}
