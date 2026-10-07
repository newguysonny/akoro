-- =============================================================
-- 2026-tiers-pilot-applications.sql
-- Tiers, Credits & Subscription Admin — plan §4.6 Phase 1.
--
--   public.tiers                            platform tier catalog
--                                           (learner: Trial/Freemium/Premium,
--                                            school: Pilot/Freemium/Premium)
--   public.pilot_applications               public pilot-school applications
--   public.subscription_lifecycle_settings  singleton (retries/grace/proration)
--   public.admin_audit_log                  append-only admin change history
--
-- Pricing lives in the database, not env (plan §1). Gateway price
-- changes create a NEW plan object — here that maps to a PATCH on
-- tiers with an explicit effective_scope (new_only | all) so the
-- API enforces the decision; the catalog row keeps the current
-- price and the scope is recorded in admin_audit_log.
--
-- Idempotent.
-- =============================================================

-- ── Tier catalog ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tiers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform        text NOT NULL CHECK (platform IN ('learner','school')),
  name            text NOT NULL,
  access          text NOT NULL DEFAULT 'free' CHECK (access IN ('free','paid')),
  price_monthly   integer NOT NULL DEFAULT 0,
  price_annual    integer NOT NULL DEFAULT 0,
  cap             integer,          -- learner: credit cap / mo
  student_cap     integer,          -- school: student cap / mo
  instructor_cap  integer,          -- school: instructor cap / mo
  duration_days   integer,          -- NULL = standing tier
  gated_features  text[] NOT NULL DEFAULT '{}',
  sort_order      integer NOT NULL DEFAULT 0,
  is_system       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, name)
);

COMMENT ON TABLE  public.tiers IS 'Plan §4.1 — platform tier catalog; pricing governance: price changes are PATCHed with effective_scope (new_only|all)';
COMMENT ON COLUMN public.tiers.cap IS 'Learner platform: monthly credit cap';
COMMENT ON COLUMN public.tiers.duration_days IS 'Time-boxed duration in days (e.g. Trial 14, Pilot 30); NULL = standing tier';

CREATE INDEX IF NOT EXISTS tiers_platform_order_idx ON public.tiers (platform, sort_order, name);

-- Seed the six default tiers (values from the Admin Tiers & Credits prototype).
INSERT INTO public.tiers (platform, name, access, price_monthly, price_annual, cap, student_cap, instructor_cap, duration_days, gated_features, sort_order, is_system)
VALUES
  ('learner','Trial',   'free',    0,     0,     500, NULL, NULL,   14, '{}', 1, true),
  ('learner','Freemium','free',    0,     0,      50, NULL, NULL, NULL, ARRAY['Gradebook','Battles','Rankings','Voice/audio'], 2, true),
  ('learner','Premium', 'paid',  1500, 14400,   1000, NULL, NULL, NULL, '{}', 3, true),
  ('school', 'Pilot',   'free',    0,     0,   NULL,  200,  400,   30, '{}', 1, true),
  ('school', 'Freemium','free',    0,     0,   NULL,   50,  100, NULL, ARRAY['Teacher seats (limited)','Student/classroom limits','Course creation & live classes','Analytics','Integrations'], 2, true),
  ('school', 'Premium', 'paid',    0,     0,   NULL, 1000, 2000, NULL, '{}', 3, true)
ON CONFLICT (platform, name) DO NOTHING;

-- ── Public pilot-school applications ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pilot_applications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_name   text NOT NULL,
  state_city    text NOT NULL,
  est_students  integer NOT NULL CHECK (est_students >= 1),
  contact_name  text NOT NULL,
  contact_email text NOT NULL,
  contact_phone text NOT NULL,
  message       text,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  review_notes  text,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pilot_applications IS 'Plan §4.1 — submissions from the public /apply form (POST /api/public/pilot-applications); reviewed in the Admin Pilot Schools queue';

CREATE INDEX IF NOT EXISTS pilot_applications_status_idx ON public.pilot_applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS pilot_applications_email_idx  ON public.pilot_applications (contact_email);

-- ── Subscription lifecycle settings (singleton) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscription_lifecycle_settings (
  id                      boolean PRIMARY KEY DEFAULT true CHECK (id),
  payment_retry_attempts  integer NOT NULL DEFAULT 3 CHECK (payment_retry_attempts >= 0),
  grace_period_days       integer NOT NULL DEFAULT 5 CHECK (grace_period_days >= 0),
  proration_policy        text    NOT NULL DEFAULT 'prorate' CHECK (proration_policy IN ('immediate','prorate','next-cycle')),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.subscription_lifecycle_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ── Admin audit log — append-only ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor       uuid,
  actor_label text,
  action      text NOT NULL,          -- e.g. tier.updated, application.approved
  entity_type text NOT NULL,          -- tier | pilot_application | lifecycle_settings
  entity_id   text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_audit_log IS 'Plan §4.1 — insert-only admin change history; UPDATE/DELETE blocked by trigger';

CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON public.admin_audit_log (created_at DESC);

-- Insert-only is enforced in the database, not just in code:
CREATE OR REPLACE FUNCTION public.admin_audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_audit_log_no_update ON public.admin_audit_log;
CREATE TRIGGER admin_audit_log_no_update
  BEFORE UPDATE OR DELETE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.admin_audit_log_immutable();

-- ── Grants (service_role only; the migration runner re-asserts these) ───────
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tiers, public.pilot_applications, public.subscription_lifecycle_settings TO service_role;
GRANT SELECT, INSERT ON public.admin_audit_log TO service_role;
