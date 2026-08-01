-- =============================================================
-- 2026-vouchers-products-menu.sql
-- Restaurant-menu-style enrichment for voucher products: a photo, a
-- description, and a billing period so subscription-style products
-- (monthly/quarterly/yearly) can sit alongside one-off denominations.
-- =============================================================

ALTER TABLE vouchers.voucher_products ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE vouchers.voucher_products ADD COLUMN IF NOT EXISTS image_url   TEXT;
ALTER TABLE vouchers.voucher_products ADD COLUMN IF NOT EXISTS billing_period TEXT NOT NULL DEFAULT 'one_time'
  CHECK (billing_period IN ('one_time', 'monthly', 'quarterly', 'yearly'));

GRANT ALL ON ALL TABLES    IN SCHEMA vouchers TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA vouchers TO service_role;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
