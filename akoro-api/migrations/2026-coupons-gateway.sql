-- =============================================================
-- 2026-coupons-gateway.sql
-- Tiers, Credits & Subscription Admin — plan §4.6 Phase 3:
-- coupons + the gateway/dunning columns on subscriptions.
--
--   public.coupons             discount codes for paid plans; applied from
--                              a subscription's page (admin), not at checkout
--   public.coupon_redemptions  one row per coupon-on-subscription application
--   subscriptions (alter)      discount_coupon_id, gateway_authorization,
--                              retry_count, past_due_since
--
-- Coupon semantics (reference prototype):
--   type percent|fixed · duration once|repeating|forever (months when
--   repeating) · max_redemptions NULL = unlimited · expires_at NULL = never
--   · first_time_only = only customers with no paid invoices
--   status: paused > expired (expires_at past) > exhausted (redeemed >= max)
--
-- Gateway: the initial charge.success stores the card authorization
-- (gateway_authorization) so renewals can be charged by the
-- invoice-generation / payment-retry jobs (plan §4.3). Prices are naira;
-- Paystack is charged in kobe (×100) at the call sites.
--
-- Idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.coupons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  description     text,
  type            text NOT NULL CHECK (type IN ('percent','fixed')),
  value           integer NOT NULL CHECK (value > 0),
  duration        text NOT NULL DEFAULT 'once' CHECK (duration IN ('once','repeating','forever')),
  months          integer CHECK (months IS NULL OR months >= 1),
  max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions >= 1),
  expires_at      date,
  first_time_only boolean NOT NULL DEFAULT false,
  paused          boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (type <> 'percent' OR value <= 100),
  CHECK (duration <> 'repeating' OR months IS NOT NULL)
);

COMMENT ON TABLE public.coupons IS 'Plan §4.1 — discount codes for paid plans; applied from a subscription page by an admin';

CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  coupon_id       uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  redeemed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_idx ON public.coupon_redemptions (coupon_id, redeemed_at DESC);

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS discount_coupon_id uuid REFERENCES public.coupons(id) ON DELETE SET NULL;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS gateway_authorization text;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS past_due_since date;

COMMENT ON COLUMN public.subscriptions.discount_coupon_id IS 'Applied coupon (one per subscription); applied/removed by admins';
COMMENT ON COLUMN public.subscriptions.gateway_authorization IS 'Paystack authorization_code from the initial charge — used to charge renewals';
COMMENT ON COLUMN public.subscriptions.retry_count IS 'Failed renewal charge attempts since the last success (payment-retry job)';
COMMENT ON COLUMN public.subscriptions.past_due_since IS 'When the subscription went past due; drives the grace-period downgrade';

-- ── Grants (service_role only; the migration runner re-asserts these) ───────
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupons, public.coupon_redemptions TO service_role;
