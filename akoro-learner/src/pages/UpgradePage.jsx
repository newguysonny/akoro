import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PaywallScreen from '../components/paywall/PaywallScreen.jsx';
import { API } from '../services/api.js';

/**
 * UpgradePage — full-screen mount of the Premium paywall at /upgrade.
 *
 * The paywall is normally presented in-app at a gating moment (battles, voice,
 * credits exhausted — see reference/Paywallscreen.md). This route gives it a
 * stable URL so it can be linked from the app, emails, and experiments:
 *
 *   /upgrade                 default trigger
 *   /upgrade?trigger=battles | voice | credits
 *   /upgrade?payment=return  Paystack redirects here after checkout — the
 *                           webhook (POST /api/webhooks/paystack) creates the
 *                           subscription server-side, so we just confirm.
 *
 * Checkout (Phase 3): POST /api/subscriptions/checkout { cycle } initializes a
 * Paystack transaction for the learner Premium tier and we redirect to the
 * gateway's authorization URL.
 */

const TRIGGERS = new Set(['default', 'battles', 'voice', 'credits']);

export default function UpgradePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const triggerParam = params.get('trigger');
  const trigger = TRIGGERS.has(triggerParam) ? triggerParam : 'default';
  const returnedFromPayment = params.get('payment') === 'return';

  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');

  const startCheckout = async (plan) => {
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`${API}/api/subscriptions/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cycle: plan }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.data?.authorization_url) {
        window.location.href = j.data.authorization_url;
        return; // full-page redirect to Paystack
      }
      if (r.status === 401) {
        navigate('/app'); // not signed in — the dashboard will ask
        return;
      }
      setError(j?.message || 'Could not start checkout. Please try again.');
    } catch {
      setError('Network problem — please check your connection and try again.');
    }
    setBusy(false);
  };

  return (
    <div className="bg-akoro-bg min-h-screen flex items-center justify-center font-nunito py-6">
      <div className="w-full max-w-[430px]">
        {returnedFromPayment && (
          <div className="mx-6 mb-4 text-[0.85rem] font-bold text-akoro-green bg-akoro-greensoft border border-akoro-green/30 rounded-[12px] px-4 py-3">
            Payment received — Premium activates within a minute. ✅
          </div>
        )}
        <PaywallScreen
          trigger={trigger}
          busy={busy}
          note={error}
          onClose={() => navigate(-1)}
          onContinueFreemium={() => navigate('/app')}
          onUpgrade={startCheckout}
        />
      </div>
    </div>
  );
}
