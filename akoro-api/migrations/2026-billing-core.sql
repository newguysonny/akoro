-- =============================================================
-- 2026-billing-core.sql
-- Tiers, Credits & Subscription Admin — plan §4.6 Phase 2:
-- the core billing entities (manual/offline payments).
--
--   public.customers             plan §4.1 — the billing identity
--                                (parent/guardian) behind subscriptions
--   public.subscriptions         one record per trialing or subscribed
--                                learner; pilot users have NO record
--   public.subscription_events   the per-subscription timeline
--   public.invoices              billing records; draft → open → paid | void
--   public.invoice_line_items    invoice lines (sum = invoice amount)
--
-- No gateway yet (Phase 3): invoices are finalized / marked paid / voided
-- manually from the admin. Coupons (discount_coupon_id) arrive with the
-- Phase 3 coupons tables. Rows are created by checkout in Phase 3 —
-- Phase 2 ships the entities, endpoints, and admin UI.
--
-- Idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.customers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  email      text NOT NULL UNIQUE,
  phone      text,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.customers IS 'Plan §4.1 — the billing identity (parent/guardian) behind one or more learner subscriptions';

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  learner_user_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  tier_id            uuid NOT NULL REFERENCES public.tiers(id),
  status             text NOT NULL DEFAULT 'trial' CHECK (status IN ('active','trial','past_due','canceled','paused')),
  cycle              text NOT NULL DEFAULT 'monthly' CHECK (cycle IN ('monthly','annual')),
  price              integer NOT NULL DEFAULT 0 CHECK (price >= 0),
  next_date          date,
  payment_method_ref text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.subscriptions IS 'Plan §4.1 — one record per trialing/subscribed learner, billed to a customer; pilot users have no record';
COMMENT ON COLUMN public.subscriptions.price IS 'Effective price per cycle in naira (0 for free tiers)';
COMMENT ON COLUMN public.subscriptions.next_date IS 'Next renewal / trial end / payment-due date; NULL when nothing is scheduled (freemium, paused, canceled)';

CREATE INDEX IF NOT EXISTS subscriptions_customer_idx ON public.subscriptions (customer_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx  ON public.subscriptions (status, next_date);
CREATE INDEX IF NOT EXISTS subscriptions_learner_idx ON public.subscriptions (learner_user_id);

CREATE TABLE IF NOT EXISTS public.subscription_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  at              timestamptz NOT NULL DEFAULT now(),
  text            text NOT NULL
);

CREATE INDEX IF NOT EXISTS subscription_events_sub_idx ON public.subscription_events (subscription_id, at DESC);

CREATE TABLE IF NOT EXISTS public.invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','paid','void')),
  issued_at       date,
  due_at          date,
  paid_at         date,
  voided_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.invoices IS 'Plan §4.1 — billing records per subscription; draft → open (finalize) → paid (mark-paid) | void';

CREATE INDEX IF NOT EXISTS invoices_customer_idx ON public.invoices (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_status_idx   ON public.invoices (status, due_at);
CREATE INDEX IF NOT EXISTS invoices_sub_idx      ON public.invoices (subscription_id);

CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id  uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount      integer NOT NULL CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_idx ON public.invoice_line_items (invoice_id);

-- ── Grants (service_role only; the migration runner re-asserts these) ───────
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.customers, public.subscriptions, public.subscription_events,
  public.invoices, public.invoice_line_items
TO service_role;
