-- =============================================================
-- 2026-vouchers-webhooks.sql
-- Outbound webhook delivery for the voucher module.
--
-- startups.webhook_url / webhook_secret already exist (2026-vouchers-module.sql)
-- but nothing ever delivered to them. This adds the delivery queue + log so a
-- redemption can notify the startup's own backend, with signed payloads,
-- bounded retries and a visible audit trail.
--
-- Still self-contained in the `vouchers` schema (see the base migration for
-- the decoupling rationale).
-- =============================================================

CREATE TABLE IF NOT EXISTS vouchers.webhook_deliveries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id       UUID NOT NULL REFERENCES vouchers.startups(id) ON DELETE CASCADE,
  event            TEXT NOT NULL,                 -- e.g. 'voucher.redeemed'
  url              TEXT NOT NULL,                 -- snapshot: where we're sending it
  payload          JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','sending','delivered','failed')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 6,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_status_code INTEGER,
  last_error       TEXT,
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vouchers_webhooks_startup ON vouchers.webhook_deliveries (startup_id, created_at DESC);
-- The worker's hot path: find what's due.
CREATE INDEX IF NOT EXISTS idx_vouchers_webhooks_due     ON vouchers.webhook_deliveries (next_attempt_at)
  WHERE status = 'pending';

-- Atomically claim due deliveries. FOR UPDATE SKIP LOCKED means N app replicas
-- can run the worker concurrently and each row is handed to exactly one of
-- them — without it, every replica would deliver every webhook.
CREATE OR REPLACE FUNCTION vouchers.claim_webhook_deliveries(p_limit INTEGER DEFAULT 20)
RETURNS SETOF vouchers.webhook_deliveries LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  UPDATE vouchers.webhook_deliveries d
     SET status = 'sending', attempts = d.attempts + 1, updated_at = now()
   WHERE d.id IN (
     SELECT id FROM vouchers.webhook_deliveries
      WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY next_attempt_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING d.*;
END $$;

-- Reclaim rows stranded in 'sending' by a worker that crashed or was
-- redeployed mid-delivery. Without this they'd sit there forever: the
-- due-index only covers 'pending', so nothing would ever look at them again
-- and the webhook would be silently, permanently lost.
CREATE OR REPLACE FUNCTION vouchers.requeue_stuck_webhooks(p_stale_minutes INTEGER DEFAULT 10)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE vouchers.webhook_deliveries
     SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
         last_error = COALESCE(last_error, 'Worker stopped mid-delivery; requeued'),
         next_attempt_at = now(),
         updated_at = now()
   WHERE status = 'sending'
     AND updated_at < now() - make_interval(mins => p_stale_minutes);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT ALL ON ALL TABLES    IN SCHEMA vouchers TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA vouchers TO service_role;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
