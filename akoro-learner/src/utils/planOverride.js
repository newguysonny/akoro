/**
 * planOverride.js — the DEVICE-LOCAL plan switch for testing the plans UI.
 *
 * The learner's plan is display-only today: SettingsPage builds
 * profile.plan as 'Free' because /api/profiles/me does not carry a plan
 * yet, and billing (public.tiers — learner platform: Trial / Freemium /
 * Premium, seeded by 2026-tiers-pilot-applications.sql) will become the
 * server authority later. Until then this override lets the team flip the
 * plan from Settings — exactly the way the study-level selector flips the
 * app tier — so plan-driven UI and features can be exercised end to end.
 *
 * 'Free' (the default) means NO override — the key is simply absent — so
 * the switch can always return the app to today's behaviour, and a stale
 * value that is no longer a known plan is ignored rather than trusted.
 *
 * When billing goes live: delete this module, drop the 'plan' case from
 * userTab's saveField and the selector from the Settings row, and read
 * the plan from the API instead. No other surface should write it.
 */

const LS_KEY = 'akoro_plan_override';

/** The seeded learner tiers plus the pre-billing default. */
export const PLAN_OPTIONS = Object.freeze(['Free', 'Trial', 'Freemium', 'Premium']);

/** The stored override, or null when none is set (→ the 'Free' default). */
export function getPlanOverride() {
  try {
    const value = localStorage.getItem(LS_KEY);
    return value && value !== 'Free' && PLAN_OPTIONS.includes(value) ? value : null;
  } catch {
    return null; // private mode / storage disabled — behave as unoverridden
  }
}

/** Store the override; 'Free' or null clears it (back to the default). */
export function setPlanOverride(plan) {
  try {
    if (!plan || plan === 'Free' || !PLAN_OPTIONS.includes(plan)) localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, plan);
  } catch {
    /* private mode — the in-session profile state still updates; the
       choice just won't survive a reload. */
  }
}

/**
 * The one value plan-driven UI should read: the override when set, else
 * whatever the server said, else 'Free'. Future gating code (paywall
 * triggers, tier-gated features) imports this instead of touching
 * localStorage directly.
 */
export function effectivePlan(serverPlan) {
  return getPlanOverride() || serverPlan || 'Free';
}

/* Gated features by plan — a mirror of the seeded learner tiers
 * (2026-tiers-pilot-applications.sql): Freemium gates Gradebook, Battles,
 * Rankings and Voice/audio; Trial and Premium gate nothing. The 'Free'
 * default (no override) gates nothing — that is today's behaviour.
 *
 * Enforcement today is at the navigation seams (goTab, the sidebar, the
 * settings quick links) for Battles, Rankings and Gradebook — each lands
 * on the paywall with a matching trigger. 'Voice/audio' is mapped but
 * not yet wired: the mic lives mid-session in the teach modal, so its
 * gate belongs to the voice-quota work with the existing 'voice'
 * paywall trigger. When billing goes live, this map moves server-side
 * with the rest. */
export const GATED_FEATURES = Object.freeze({
  Trial:   Object.freeze([]),
  Freemium: Object.freeze(['Gradebook', 'Battles', 'Rankings', 'Voice/audio']),
  Premium: Object.freeze([]),
});

/** True when the effective plan gates this feature (feature names as in the tiers seed). */
export function featureGated(feature) {
  const plan = effectivePlan();
  return (GATED_FEATURES[plan] || []).includes(feature);
}
