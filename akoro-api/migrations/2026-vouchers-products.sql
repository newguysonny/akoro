-- =============================================================
-- 2026-vouchers-products.sql
-- Fixed-denomination voucher products (gift-card style: "₦1,000 Voucher",
-- "₦5,000 Voucher"), each with its own price and minimum order quantity —
-- distinct from the startup's base credit_rate_usd + bulk discount tiers,
-- which remain for custom-amount purchases. An agent can buy either way.
-- =============================================================

CREATE TABLE IF NOT EXISTS vouchers.voucher_products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id    UUID NOT NULL REFERENCES vouchers.startups(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  credits       INTEGER NOT NULL CHECK (credits > 0),
  price_usd     NUMERIC(12,6) NOT NULL CHECK (price_usd > 0),
  min_order_qty INTEGER NOT NULL DEFAULT 1 CHECK (min_order_qty > 0),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vouchers_products_startup ON vouchers.voucher_products (startup_id, status);

-- Denormalised onto batches so purchase history / reporting can tell a
-- product-based order from a custom-amount one without a join.
ALTER TABLE vouchers.batches ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES vouchers.voucher_products(id) ON DELETE SET NULL;

GRANT ALL ON ALL TABLES    IN SCHEMA vouchers TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA vouchers TO service_role;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
