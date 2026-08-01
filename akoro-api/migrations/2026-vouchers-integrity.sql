-- =============================================================
-- 2026-vouchers-integrity.sql
-- Integrity gaps found in the pre-release audit.
-- Idempotent; safe to re-run (every migration re-runs on each deploy).
-- =============================================================

-- A startup must never be paid twice for the same settlement period.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vouchers_settlement_period
  ON vouchers.settlements (startup_id, period_start, period_end);

-- Money columns that could go negative. Batches/settlements had no CHECK,
-- unlike the wallet balances (which were already guarded).
ALTER TABLE vouchers.batches      DROP CONSTRAINT IF EXISTS chk_vouchers_batches_prices;
ALTER TABLE vouchers.batches      ADD  CONSTRAINT chk_vouchers_batches_prices
  CHECK (unit_price_usd >= 0 AND total_cost_usd >= 0);

ALTER TABLE vouchers.settlements  DROP CONSTRAINT IF EXISTS chk_vouchers_settlements_amounts;
ALTER TABLE vouchers.settlements  ADD  CONSTRAINT chk_vouchers_settlements_amounts
  CHECK (amount_due_usd >= 0 AND total_credits_redeemed >= 0);

-- FKs that were never indexed — both are joined on regularly.
CREATE INDEX IF NOT EXISTS idx_vouchers_redemptions_code ON vouchers.redemptions (code_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_batches_product  ON vouchers.batches (product_id);

GRANT ALL ON ALL TABLES    IN SCHEMA vouchers TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA vouchers TO service_role;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
