-- =============================================================
-- 2026-payment-audit.sql
-- Payment forensics: durable audit trail + normalized order line items.
--   1. payment_events  — append-only log of every Paystack webhook received
--      and every payment status transition (survives Railway restarts, unlike
--      console logs). This is the "what actually happened to this order" record.
--   2. payment_items   — one row per purchased item so a cart order's contents
--      are queryable instead of buried in payments.provider_response JSON.
--   3. payments.updated_at — a maintained last-changed timestamp.
-- Additive + idempotent — safe to re-run on every deploy.
-- =============================================================

-- ── 1. Append-only webhook / status-transition log ────────────────────────────
CREATE TABLE IF NOT EXISTS payment_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         UUID REFERENCES payments(id) ON DELETE SET NULL,  -- NULL if unmatched
  reference          TEXT,                 -- Paystack reference / transfer_code
  event_type         TEXT NOT NULL,        -- charge.success, transfer.failed, status_change, …
  source             TEXT NOT NULL DEFAULT 'paystack_webhook',  -- paystack_webhook | verify | refund | system
  signature_valid    BOOLEAN,              -- webhook HMAC check result (NULL for non-webhook)
  matched            BOOLEAN,              -- did it resolve to a known payment/purchase?
  outcome            TEXT,                 -- fulfilled | already_processed | no_match | ignored | error
  detail             JSONB,                -- raw payload / transition context
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_events_payment   ON payment_events(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_reference ON payment_events(reference);
CREATE INDEX IF NOT EXISTS idx_payment_events_created   ON payment_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_events_type      ON payment_events(event_type);

-- ── 2. Normalized order line items ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id       UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  item_type        TEXT NOT NULL CHECK (item_type IN ('course', 'agent')),
  course_id        UUID REFERENCES courses(id) ON DELETE SET NULL,
  listing_id       UUID,                    -- edu.marketplace_listings (no cross-schema FK)
  title            TEXT,                    -- snapshot at purchase time
  unit_price_kobo  INTEGER NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'NGN',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((item_type = 'course' AND course_id  IS NOT NULL)
      OR (item_type = 'agent'  AND listing_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_payment_items_payment ON payment_items(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_items_course  ON payment_items(course_id);
CREATE INDEX IF NOT EXISTS idx_payment_items_listing ON payment_items(listing_id);

-- ── 3. payments.updated_at (maintained by trigger) ────────────────────────────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION set_payments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;
CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_payments_updated_at();

-- Expose to PostgREST / service role.
GRANT ALL ON payment_events TO service_role;
GRANT ALL ON payment_items  TO service_role;
NOTIFY pgrst, 'reload schema';
