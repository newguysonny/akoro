-- =============================================================
-- 2026-contact-messages.sql
-- Stores submissions from the public Contact and Partners forms so the admin
-- app can collect and triage them (previously the forms showed a success
-- screen but dropped the input). Idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL DEFAULT 'contact' CHECK (kind IN ('contact', 'partner')),
  name         text NOT NULL,
  email        text NOT NULL,
  organisation text,
  subject      text,                         -- contact topic OR partner type
  message      text NOT NULL,
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_status
  ON public.contact_messages(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_kind
  ON public.contact_messages(kind, created_at DESC);
