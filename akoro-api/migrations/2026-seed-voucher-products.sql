-- =============================================================
-- 2026-seed-voucher-products.sql
-- Sample voucher products for the "Akoro" demo startup so the agent
-- app's restaurant-menu-style marketplace has something to show without
-- manually creating a product first. Depends on 2026-seed-voucher-demo.sql.
-- Idempotent — guarded by (startup_id, name); safe to re-run.
-- =============================================================

DO $$
DECLARE
  v_startup uuid;
BEGIN
  SELECT id INTO v_startup FROM vouchers.startups WHERE slug = 'akoro';
  IF v_startup IS NULL THEN
    RAISE NOTICE 'Base voucher demo seed not found — run 2026-seed-voucher-demo.sql first. Skipping.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vouchers.voucher_products WHERE startup_id = v_startup) THEN
    INSERT INTO vouchers.voucher_products (startup_id, name, description, credits, price_usd, min_order_qty, billing_period, image_url) VALUES
      (v_startup, '₦1,000 Voucher', 'A ₦1,000 top-up code — the most popular denomination for quick resale.', 1000, 0.65, 1, 'one_time', null),
      (v_startup, '₦2,000 Voucher', 'A ₦2,000 top-up code for customers who want more credit up front.', 2000, 1.25, 1, 'one_time', null),
      (v_startup, '₦5,000 Voucher', 'A ₦5,000 top-up code — best value per credit, popular with resellers buying in bulk.', 5000, 3.00, 5, 'one_time', null),
      (v_startup, 'Monthly Plan', 'Recurring monthly access code — customer redeems once a month to keep their subscription active.', 3000, 2.00, 1, 'monthly', null),
      (v_startup, 'Quarterly Plan', 'A 3-month access code at a discount vs. buying monthly three times.', 9000, 5.40, 1, 'quarterly', null),
      (v_startup, 'Yearly Plan', 'A 12-month access code — the best per-month rate.', 36000, 19.20, 1, 'yearly', null);

    RAISE NOTICE 'Seeded 6 demo voucher products for startup "Akoro"';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
