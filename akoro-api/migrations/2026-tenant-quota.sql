-- =============================================================
-- 2026-tenant-quota.sql
-- Per-school API quota (api-security-hardening plan §3.2).
--
-- plan_tier drives the DEFAULT requests/minute a school's traffic
-- gets (pilot | freemium | premium — matching the Admin Tier plan;
-- custom tier names fall back to the pilot-level default). Defaults
-- live in code and are env-tunable (QUOTA_<TIER>_PER_MIN), generous
-- by design: a full classroom bursting at once lands around ~300
-- req/min, and the lowest tier starts at 2x that headroom.
--
-- api_quota_per_min is the per-school override: set it when a school
-- negotiates a higher ceiling (or needs a temporary lower one during
-- an incident) without waiting for a deploy.
--
-- Traffic is attributed by the school site's Origin header, so the
-- quota protects every route a school's users hit — not just the
-- school portal's own. Idempotent.
-- =============================================================

ALTER TABLE public.school_profiles ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'pilot';
ALTER TABLE public.school_profiles ADD COLUMN IF NOT EXISTS api_quota_per_min integer;

COMMENT ON COLUMN public.school_profiles.plan_tier IS 'School tier: pilot | freemium | premium (extensible) — selects the default per-minute API quota';
COMMENT ON COLUMN public.school_profiles.api_quota_per_min IS 'Per-school requests/minute override; NULL = tier default from code/env';
