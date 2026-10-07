-- =============================================================
-- 2026-web-push.sql
-- Web Push (PWA) subscriptions. Each row is one browser/device push
-- subscription (endpoint + keys) belonging to a user. A user may have several
-- (phone, laptop, …). Additive + idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,           -- push service URL (unique per device)
  p256dh      TEXT NOT NULL,           -- client public key
  auth        TEXT NOT NULL,           -- client auth secret
  user_agent  TEXT,                    -- for the user to identify the device
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  UNIQUE (endpoint)
);
CREATE INDEX IF NOT EXISTS idx_web_push_user ON web_push_subscriptions(user_id);

GRANT ALL ON web_push_subscriptions TO service_role;
NOTIFY pgrst, 'reload schema';
