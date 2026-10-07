import { useState } from 'react';

/**
 * PaywallScreen — the learner Premium paywall.
 *
 * React + Tailwind conversion of reference/Paywallscreen.md (phone-width
 * card, max 430px). Trigger variants change the icon/headline/subhead and
 * highlight the matching feature row:
 *
 *   default  ✨  Upgrade to Premium
 *   battles  ⚔️  Unlock Battles & Challenges
 *   voice    🎙️  Unlock Voice Tutoring — "Talk through problems with Amara's Agent, hands-free"
 *   credits  ⚡  You've used all your free credits
 *
 * Plans (exact): Annual ₦14,400/yr (₦1,200/mo, "Save 20%" badge) and Monthly
 * ₦1,500/mo; the CTA label follows the selected plan. The prototype's
 * "Preview trigger" devbar is a demo affordance and is intentionally NOT part
 * of this component — pass `trigger` as a prop instead.
 *
 * Props:
 *   trigger  'default' | 'battles' | 'voice' | 'credits'   (default: 'default')
 *   onClose           called when ✕ is tapped
 *   onUpgrade(plan)   called with 'annual' | 'monthly' when the CTA is tapped
 *   onContinueFreemium()  called for the secondary action
 */

const COPY = {
  default: { icon: '✨', headline: 'Upgrade to Premium', sub: <>Join over <b className="text-akoro-green">50,000</b> Nigerian students learning smarter with Akoro</>, feature: null },
  battles: { icon: '⚔️', headline: 'Unlock Battles & Challenges', sub: 'Go Premium to compete with classmates and climb the leaderboard', feature: 'battles' },
  voice:   { icon: '🎙️', headline: 'Unlock Voice Tutoring', sub: "Talk through problems with Amara's Agent, hands-free", feature: 'voice' },
  credits: { icon: '⚡', headline: "You've used all your free credits", sub: 'Upgrade for 1,000 AI credits every month — no more waiting', feature: 'credits' },
  rankings: { icon: '🏆', headline: 'Unlock Rankings', sub: 'Go Premium to climb the leaderboard and see how you stack up against classmates', feature: 'rankings' },
  gradebook: { icon: '📗', headline: 'Unlock Your Gradebook', sub: 'Go Premium for the full gradebook — every score, topic and progress trail', feature: 'gradebook' },
};

const FEATURES = [
  { key: 'credits', text: 'Full AI credit allowance — 1,000 credits/month' },
  { key: 'battles', text: 'Battles & Challenges with classmates' },
  { key: 'rankings', text: 'Full leaderboards & rankings' },
  { key: 'voice',   text: 'Voice & push-to-talk tutoring' },
  { key: 'gradebook', text: 'Full gradebook & progress tracking' },
];

export default function PaywallScreen({ trigger = 'default', busy = false, note = '', onClose, onUpgrade, onContinueFreemium }) {
  const [plan, setPlan] = useState('annual'); // Annual pre-selected, as in the prototype
  const c = COPY[trigger] ?? COPY.default;

  const ctaLabel = plan === 'annual'
    ? 'Upgrade to Premium — ₦14,400/yr'
    : 'Upgrade to Premium — ₦1,500/mo';

  return (
    <div className="w-full max-w-[430px] min-h-full bg-akoro-surface relative flex flex-col px-6 pt-5 pb-7 font-nunito text-akoro-ink [&_*]:box-border">
      {/* ✕ close */}
      <button
        aria-label="Close"
        onClick={onClose}
        className="w-[34px] h-[34px] rounded-full border border-akoro-line bg-akoro-bg text-akoro-dim text-base font-bold cursor-pointer mb-[18px] shrink-0"
      >✕</button>

      {/* icon + headline + social proof */}
      <div className="w-14 h-14 rounded-[18px] bg-akoro-purplesoft flex items-center justify-center text-[1.6rem] mb-4">{c.icon}</div>
      <h1 className="text-[1.55rem] font-black leading-[1.2] m-0 mb-2">{c.headline}</h1>
      <p className="text-[0.9rem] text-akoro-dim m-0 mb-[22px]">{c.sub}</p>

      {/* features — the trigger's feature row is highlighted */}
      <ul className="list-none m-0 mb-[26px] p-0 flex flex-col gap-[13px]">
        {FEATURES.map((f, i) => {
          const highlighted = c.feature && f.key === c.feature;
          return (
            <li
              key={i}
              className={`flex items-start gap-2.5 text-[0.94rem] font-semibold ${highlighted ? 'text-akoro-purple' : ''}`}
            >
              <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[0.75rem] font-black mt-px ${highlighted ? 'bg-akoro-purplesoft text-akoro-purple' : 'bg-akoro-greensoft text-akoro-green'}`}>✓</span>
              {f.text}
            </li>
          );
        })}
      </ul>

      {/* plans */}
      <div className="flex flex-col gap-2.5 mb-[18px]">
        <button
          type="button"
          onClick={() => setPlan('annual')}
          className={`w-full text-left py-[15px] px-[18px] rounded-[18px] border-2 cursor-pointer flex justify-between items-center font-nunito ${plan === 'annual' ? 'border-akoro-purple bg-akoro-purplesoft' : 'border-akoro-line bg-akoro-surface'}`}
        >
          <span className="font-extrabold text-[0.98rem] text-akoro-ink flex items-center gap-2">
            Annual
            <span className="bg-akoro-green text-white text-[0.68rem] font-extrabold py-[3px] px-2 rounded-full">Save 20%</span>
          </span>
          <span className="text-right font-extrabold text-[0.98rem]">
            ₦14,400/yr
            <small className="block font-semibold text-akoro-dim text-[0.76rem]">₦1,200/mo</small>
          </span>
        </button>

        <button
          type="button"
          onClick={() => setPlan('monthly')}
          className={`w-full text-left py-[15px] px-[18px] rounded-[18px] border-2 cursor-pointer flex justify-between items-center font-nunito ${plan === 'monthly' ? 'border-akoro-purple bg-akoro-purplesoft' : 'border-akoro-line bg-akoro-surface'}`}
        >
          <span className="font-extrabold text-[0.98rem] text-akoro-ink">Monthly</span>
          <span className="text-right font-extrabold text-[0.98rem]">₦1,500/mo</span>
        </button>
      </div>

      {/* CTAs */}
      {note && (
        <p className="text-[0.82rem] font-bold text-akoro-coral text-center leading-[1.4] mt-0 mb-3">{note}</p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => onUpgrade?.(plan)}
        className={`w-full py-4 rounded-full border-none text-white font-extrabold text-[1.02rem] mb-[14px] ${busy ? 'bg-akoro-purpledark cursor-wait opacity-80' : 'bg-akoro-purple hover:bg-akoro-purpledark cursor-pointer'}`}
      >
        {busy ? 'Starting checkout…' : ctaLabel}
      </button>
      <button
        type="button"
        onClick={onContinueFreemium}
        className="w-full bg-transparent border-none text-center text-akoro-dim font-bold text-[0.9rem] cursor-pointer mb-4"
      >
        Continue with Freemium
      </button>

      <p className="text-[0.74rem] text-akoro-dim text-center leading-[1.4] m-0">
        Cancel anytime. By upgrading, you agree to Akoro&rsquo;s{' '}
        <a href="/terms" className="text-akoro-dim underline">Terms</a> &amp;{' '}
        <a href="/privacy" className="text-akoro-dim underline">Privacy Policy</a>.
      </p>
    </div>
  );
}
