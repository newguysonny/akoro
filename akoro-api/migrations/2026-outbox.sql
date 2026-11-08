-- =============================================================
-- 2026-outbox.sql — Grand Plan Phase 18 item 5: store first, send after.
--
-- Every outgoing message (web push, email, SMS, WhatsApp, an agent's notice
-- in chat) and every outside action a workflow takes (a check battle made, a
-- teaching session row created) is written here BEFORE it is attempted, then
-- sent with growing backoff (5 s doubling to 300 s), in order per order_key
-- (one recipient + channel, or one conversation), and kept with its outcome:
-- sent · failed after N tries · dropped and why. idem_key makes a second
-- write of the same work a no-op, so nothing is ever sent twice.
--
-- lib/outbox.js drains it on its own Postgres-only clock (like the
-- deferred-jobs release clock — no Redis). lib/outboxCore.js holds the rules.
-- Idempotent; safe to re-run.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idem_key     text NOT NULL,
  channel      text NOT NULL,                  -- push | email | in_app | session_email | sms | whatsapp | session_push | action:<kind>
  order_key    text NOT NULL,                  -- sent in created order within one key
  user_id      uuid,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dropped')),
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  due_at       timestamptz NOT NULL DEFAULT now(),
  claimed_at   timestamptz,
  progress     jsonb,                          -- what a partly done attempt already did (e.g. the devices reached)
  result       jsonb,                          -- an outside action's result (the battle made)
  last_error   text,
  drop_reason  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  CONSTRAINT uq_outbox_idem UNIQUE (idem_key)
);

CREATE INDEX IF NOT EXISTS idx_outbox_open ON edu.outbox(due_at) WHERE status IN ('pending', 'sending');
CREATE INDEX IF NOT EXISTS idx_outbox_order ON edu.outbox(order_key, created_at) WHERE status IN ('pending', 'sending');
CREATE INDEX IF NOT EXISTS idx_outbox_finished ON edu.outbox(finished_at) WHERE finished_at IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON edu.outbox TO service_role;

NOTIFY pgrst, 'reload schema';
