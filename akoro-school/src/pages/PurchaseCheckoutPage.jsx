/**
 * PurchaseCheckoutPage — one confirmation/checkout screen shown BEFORE Paystack
 * opens, for every payment in the app (wallet top-up, subscription, app/tool
 * unlock, marketplace). The caller navigates here with an order summary + the
 * init endpoint to hit on confirm:
 *   navigate('/purchase', { state: {
 *     title, subtitle, amountNaira, initPath, initBody, returnTo?
 *   }})
 * Paystack is only initiated when the user presses "Proceed to payment".
 */
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

import { apiPost } from '../services/api.js';
import { PageLayout } from '../components/Layout.jsx';
import { GREEN, RED } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const fmt = (n) => Number(n || 0).toLocaleString();

export default function PurchaseCheckoutPage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (!state?.initPath) navigate('/wallet', { replace: true }); }, [state, navigate]);
  if (!state?.initPath) return null;
  const { title, subtitle, amountNaira, coins } = state;
  const free = Number(amountNaira || 0) <= 0;

  const proceed = async () => {
    setBusy(true); setErr('');
    try {
      const res = await apiPost(state.initPath, state.initBody || {});
      const d = res?.data ?? res;
      const url = d?.authorization_url || d?.checkout_url;
      if (url) { window.location.href = url; return; }
      if (d?.free || d?.owned || d?.success) { navigate(state.returnTo || -1); return; }
      throw new Error(d?.error || d?.message || 'Could not start payment');
    } catch (e) { setErr(e.message || 'Something went wrong'); }
    finally { setBusy(false); }
  };

  return (
    <PageLayout title="Checkout" subtitle="Review your order before payment">
      <div style={{ maxWidth: 460, fontFamily: C.font }}>
        <div style={{ background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 16, padding: 18, marginBottom: 16 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: C.muted2, textTransform: 'uppercase', letterSpacing: 0.4 }}>Order summary</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginTop: 12 }}>
            <div>
              <div style={{ fontSize: 15.5, fontWeight: 900, color: C.ink }}>{title || 'Purchase'}</div>
              {subtitle && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>{subtitle}</div>}
              {coins != null && <div style={{ fontSize: 12.5, color: '#B45309', fontWeight: 700, marginTop: 4 }}><Ico ti="ti-coins" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />{fmt(coins)} coins</div>}
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: C.ink, whiteSpace: 'nowrap' }}>{free ? 'Free' : `₦${fmt(amountNaira)}`}</div>
          </div>
          <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 14, paddingTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 900, color: C.ink }}>
            <span>Total</span><span>{free ? 'Free' : `₦${fmt(amountNaira)}`}</span>
          </div>
        </div>

        {err && <div style={{ background: '#FEECEC', color: RED, borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{err}</div>}

        <button onClick={proceed} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: 14, borderRadius: 12, border: 'none', background: `linear-gradient(135deg,${C.brand},${C.brandDeep})`, color: '#fff', fontSize: 14.5, fontWeight: 900, cursor: 'pointer', fontFamily: C.font }}>
          {busy ? <Ico ti="ti-loader-2" size={15} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-lock" size={15} />} {busy ? 'Starting…' : free ? 'Confirm' : 'Proceed to secure payment'}
        </button>
        {!free && <div style={{ textAlign: 'center', fontSize: 11.5, color: C.muted2, marginTop: 10 }}>Payments are processed securely by Paystack.</div>}
        <button onClick={() => navigate(-1)} disabled={busy} style={{ width: '100%', marginTop: 10, padding: 12, borderRadius: 12, border: `1px solid ${C.border}`, background: 'transparent', color: C.ink, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}>Cancel</button>
      </div>
    </PageLayout>
  );
}
