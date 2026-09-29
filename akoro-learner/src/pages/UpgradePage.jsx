import { useNavigate, useSearchParams } from 'react-router-dom';
import PaywallScreen from '../components/paywall/PaywallScreen.jsx';

/**
 * UpgradePage — full-screen mount of the Premium paywall at /upgrade.
 *
 * The paywall is normally presented in-app at a gating moment (battles, voice,
 * credits exhausted — see reference/Paywallscreen.md). This route gives it a
 * stable URL so it can be linked from the app, emails, and experiments:
 *
 *   /upgrade                 default trigger
 *   /upgrade?trigger=battles | voice | credits
 *
 * Checkout wiring (Paystack) lands with plan Phase 2 — onUpgrade is the hook.
 */

const TRIGGERS = new Set(['default', 'battles', 'voice', 'credits']);

export default function UpgradePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const triggerParam = params.get('trigger');
  const trigger = TRIGGERS.has(triggerParam) ? triggerParam : 'default';

  return (
    <div className="bg-akoro-bg min-h-screen flex items-center justify-center font-nunito">
      <PaywallScreen
        trigger={trigger}
        onClose={() => navigate(-1)}
        onContinueFreemium={() => navigate('/app')}
        // Phase 2: send the selected plan to checkout.
        onUpgrade={(plan) => navigate(`/checkout?plan=premium-${plan}`)}
      />
    </div>
  );
}
