-- =============================================================
-- 2026-billing-messaging.sql
-- Tiers, Credits & Subscription Admin — plan §4.6 Phase 4:
-- messaging delivery, billing settings, audit hardening.
--
--   public.messages            plan §4.1 — the outbound message log
--                              (parent- and school-directed); content is
--                              locked after insert, only delivery fields
--                              may change (trigger-enforced)
--   public.billing_settings    singleton — branding + notification
--                              toggles consulted by the delivery jobs
--
-- Audit hardening (plan §4.6 #4, "genuinely immutable"):
--   public.subscription_events  gains the same UPDATE/DELETE-blocking
--                               trigger admin_audit_log already has — the
--                               per-subscription timeline is history.
--
-- Idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  school_id        uuid REFERENCES public.pilot_schools(id) ON DELETE SET NULL,
  subscription_id  uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  audience         text CHECK (audience IS NULL OR audience IN ('admins','instructors','students','all')),
  channel          text NOT NULL CHECK (channel IN ('email','sms','inapp')),
  template         text,
  subject          text,
  body             text NOT NULL,
  sent_by          text NOT NULL,
  sent_at          timestamptz NOT NULL DEFAULT now(),
  delivery_status  text NOT NULL DEFAULT 'queued' CHECK (delivery_status IN ('queued','sent','failed','no_recipient')),
  recipient_count  integer,
  delivery_detail  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.messages IS 'Plan §4.1 — outbound parent/school messages; content immutable after insert, only delivery fields update';
COMMENT ON COLUMN public.messages.school_id IS 'pilot_schools.id — set for school-directed messages';
COMMENT ON COLUMN public.messages.audience IS 'School messages only: admins | instructors | students | all; NULL for customer messages';
COMMENT ON COLUMN public.messages.template IS 'payment | trial | general | pilot-end | cap — set when queued from a template (drives job dedup)';

CREATE INDEX IF NOT EXISTS messages_customer_idx ON public.messages (customer_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS messages_school_idx   ON public.messages (school_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS messages_sub_idx      ON public.messages (subscription_id);

-- ── Messages: content is locked after insert; only delivery fields move ────
-- (FK columns are deliberately outside the lock so an ON DELETE SET NULL from
--  a removed parent row doesn't trip it — referential housekeeping, not a
--  content change. subject/body/channel/audience/template never change.)
CREATE OR REPLACE FUNCTION public.messages_content_locked() RETURNS trigger AS $$
BEGIN
  IF (NEW.subject, NEW.body, NEW.channel, NEW.audience, NEW.template)
     IS DISTINCT FROM
     (OLD.subject, OLD.body, OLD.channel, OLD.audience, OLD.template) THEN
    RAISE EXCEPTION 'messages content is immutable — only delivery fields may change';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_content_locked ON public.messages;
CREATE TRIGGER messages_content_locked
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_content_locked();

-- Messages are a record of what was sent to whom — never deleted.
CREATE OR REPLACE FUNCTION public.messages_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'messages cannot be deleted';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_no_delete_trigger ON public.messages;
CREATE TRIGGER messages_no_delete_trigger
  BEFORE DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_no_delete();

-- ── Audit hardening: the subscription timeline is history ──────────────────
CREATE OR REPLACE FUNCTION public.subscription_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'subscription_events is append-only';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subscription_events_no_update ON public.subscription_events;
CREATE TRIGGER subscription_events_no_update
  BEFORE UPDATE OR DELETE ON public.subscription_events
  FOR EACH ROW EXECUTE FUNCTION public.subscription_events_immutable();

-- ── Billing settings singleton (branding + notification toggles) ───────────
CREATE TABLE IF NOT EXISTS public.billing_settings (
  id                    boolean PRIMARY KEY DEFAULT true CHECK (id),
  email_from_name       text NOT NULL DEFAULT 'Akoro',
  email_from_address    text NOT NULL DEFAULT 'noreply@akoro.app',
  support_email         text,
  notify_payment_failed boolean NOT NULL DEFAULT true,
  notify_trial_ending   boolean NOT NULL DEFAULT true,
  notify_pilot_ending   boolean NOT NULL DEFAULT true,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.billing_settings IS 'Plan §4.6 #4 — gateway/notification/branding settings; singleton row (id = true)';

INSERT INTO public.billing_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ── Grants (service_role only; the migration runner re-asserts these) ───────
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.messages TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.billing_settings TO service_role;
