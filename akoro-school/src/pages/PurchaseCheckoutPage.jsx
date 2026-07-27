/**
 * PurchaseCheckoutPage — confirmation step shown BEFORE Paystack opens.
 * Reached via navigate('/purchase', { state: { type:'topup', coins, target,
 * title, subtitle, amountNaira } }). Paystack is only initiated on confirm.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, Lock } from 'lucide-react';
import { apiPost } from '../services/api.js';
import { PageLayout } from '../components/Layout.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, WHITE, RED, FONT } from '../constants.js';

const fmt = (n) => Number(n || 0).toLocaleString();

export default function PurchaseCheckoutPage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (!state?.type) navigate('/wallet', { replace: true }); }, [state, navigate]);
  if (!state?.type) return null;
  const { title, subtitle, amountNaira, coins, target } = state;

  const proceed = async () => {
    setBusy(true); setErr('');
    try {
      const r = await apiPost('/api/wallet/topup/init', { coins, target: target || 'user' });
      if (r.data?.authorization_url) { window.location.href = r.data.authorization_url; return; }
      throw new Error('Could not start payment');
    } catch (e) { setErr(e.message || 'Something went wrong'); }
    finally { setBusy(false); }
  };

  return (
    <PageLayout title="Checkout" subtitle="Review your order before payment">
      <div style={{ maxWidth: 460, fontFamily: FONT }}>
        <div style={{ background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 16, padding: 18, marginBottom: 16 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: MUTED2, textTransform: 'uppercase', letterSpacing: 0.4 }}>Order summary</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginTop: 12 }}>
            <div>
              <div style={{ fontSize: 15.5, fontWeight: 900, color: INK }}>{title || 'Wallet top-up'}</div>
              {subtitle && <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{subtitle}</div>}
              <div style={{ fontSize: 12.5, color: '#B45309', fontWeight: 700, marginTop: 4 }}>🪙 {fmt(coins)} coins</div>
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: INK, whiteSpace: 'nowrap' }}>₦{fmt(amountNaira)}</div>
          </div>
          <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 14, paddingTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 900, color: INK }}>
            <span>Total</span><span>₦{fmt(amountNaira)}</span>
          </div>
        </div>

        {err && <div style={{ background: '#FEECEC', color: RED, borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{err}</div>}

        <button onClick={proceed} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: 14, borderRadius: 12, border: 'none', background: `linear-gradient(135deg,${AMBER},#D4651E)`, color: WHITE, fontSize: 14.5, fontWeight: 900, cursor: 'pointer', fontFamily: FONT }}>
          {busy ? <Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> : <Lock size={15} />} {busy ? 'Starting secure payment…' : 'Proceed to secure payment'}
        </button>
        <div style={{ textAlign: 'center', fontSize: 11.5, color: MUTED2, marginTop: 10 }}>Payments are processed securely by Paystack.</div>
        <button onClick={() => navigate(-1)} disabled={busy} style={{ width: '100%', marginTop: 10, padding: 12, borderRadius: 12, border: `1px solid ${BORDER}`, background: 'transparent', color: INK, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
      </div>
    </PageLayout>
  );
}
