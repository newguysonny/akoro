/**
 * PurchaseCheckoutPage — a confirmation step shown BEFORE Paystack opens.
 * Reached via navigate('/purchase', { state }) for:
 *   • coin top-up   → { type:'topup', coins, target, amountNaira }
 *   • course buy     → { type:'course', payload:{course_id}, amountNaira, returnTo }
 * Shows an order summary; only on "Proceed to payment" do we init + redirect.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiPost, API } from '../services/api.js';
import { BRAND, GREEN, RED } from '../constants.js';
const FONT = "'Nunito',sans-serif";

const fmt = (n) => Number(n || 0).toLocaleString();

export default function PurchaseCheckoutPage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (!state?.type) navigate('/app', { replace: true }); }, [state, navigate]);
  if (!state?.type) return null;

  const { type, title, subtitle, amountNaira, coins } = state;

  const proceed = async () => {
    setBusy(true); setErr('');
    try {
      if (type === 'topup') {
        const r = await apiPost('/api/wallet/topup/init', { coins, target: state.target || 'user' });
        if (r.data?.authorization_url) { window.location.href = r.data.authorization_url; return; }
        throw new Error('Could not start payment');
      }
      if (type === 'course') {
        const r = await fetch(`${API}/api/payments/initiate`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'student' },
          body: JSON.stringify(state.payload || {}),
        });
        if (r.status === 401) { localStorage.setItem('akoro_redirect', state.returnTo || '/app'); navigate('/signin'); return; }
        const d = await r.json().catch(() => ({}));
        const body = d.data || d;
        if (!r.ok) throw new Error(d.message || body.message || 'Could not start payment');
        if (body.free) { navigate(state.returnTo || '/app'); return; }
        if (body.checkout_url) { window.location.href = body.checkout_url; return; }
        throw new Error('Could not start payment');
      }
    } catch (e) { setErr(e.message || 'Something went wrong'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ak-bg)', fontFamily: FONT, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 480, padding: 18 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--ak-text)', lineHeight: 1, marginBottom: 8 }}>‹</button>
        <h1 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 14px' }}>Checkout</h1>

        <div style={{ background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 16, padding: 18, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Order summary</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginTop: 12 }}>
            <div>
              <div style={{ fontSize: 15.5, fontWeight: 900, color: 'var(--ak-text)' }}>{title || (type === 'topup' ? 'Wallet top-up' : 'Course')}</div>
              {subtitle && <div style={{ fontSize: 12.5, color: 'var(--ak-text-muted)', marginTop: 2 }}>{subtitle}</div>}
              {type === 'topup' && <div style={{ fontSize: 12.5, color: BRAND, fontWeight: 700, marginTop: 4 }}>🪙 {fmt(coins)} coins</div>}
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--ak-text)', whiteSpace: 'nowrap' }}>₦{fmt(amountNaira)}</div>
          </div>
          <div style={{ borderTop: '1px solid var(--ak-border)', marginTop: 14, paddingTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 900, color: 'var(--ak-text)' }}>
            <span>Total</span><span>₦{fmt(amountNaira)}</span>
          </div>
        </div>

        {err && <div style={{ background: '#FEECEC', color: RED, borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{err}</div>}

        <button onClick={proceed} disabled={busy} style={{ width: '100%', padding: 14, borderRadius: 13, border: 'none', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: '#fff', fontSize: 15, fontWeight: 900, cursor: 'pointer', fontFamily: FONT }}>
          {busy ? 'Starting secure payment…' : 'Proceed to secure payment'}
        </button>
        <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--ak-text-muted)', marginTop: 10 }}>Payments are processed securely by Paystack.</div>
        <button onClick={() => navigate(-1)} disabled={busy} style={{ width: '100%', marginTop: 10, padding: 12, borderRadius: 12, border: '1px solid var(--ak-border)', background: 'transparent', color: 'var(--ak-text)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
      </div>
    </div>
  );
}
