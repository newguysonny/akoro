-- =============================================================
-- 2026-seed-voucher-media.sql
-- Enrich the demo voucher data with photos/descriptions/categories so the
-- restaurant-menu-style marketplace has real content to render — both the
-- startup cards (cover photo, category, pitch) and the voucher products
-- (photo, description) seeded earlier.
--
-- Uses picsum.photos' seeded endpoint (https://picsum.photos/seed/<seed>/
-- <w>/<h>) for stable, deterministic demo images — same seed always
-- returns the same photo, no API key required. Swap for real photos via
-- the business app's Settings / Voucher Products pages any time.
--
-- Idempotent (plain UPDATEs); depends on 2026-seed-voucher-demo.sql,
-- 2026-seed-voucher-demo-2.sql and 2026-seed-voucher-products.sql having
-- already run.
-- =============================================================

DO $$
DECLARE
  v_akoro  uuid;
  v_edupay uuid;
BEGIN
  SELECT id INTO v_akoro  FROM vouchers.startups WHERE slug = 'akoro';
  SELECT id INTO v_edupay FROM vouchers.startups WHERE slug = 'edupay';

  IF v_akoro IS NULL THEN
    RAISE NOTICE 'Base voucher demo seed not found — run 2026-seed-voucher-demo.sql first. Skipping.';
    RETURN;
  END IF;

  -- ── Startup cards ────────────────────────────────────────────────────
  UPDATE vouchers.startups SET
    cover_image_url = 'https://picsum.photos/seed/akoro-voucher/800/500',
    description = 'Akoro credits, resold through agents — top up learning, unlock premium tutoring, or gift a subscription.',
    category = 'education'
  WHERE id = v_akoro;

  IF v_edupay IS NOT NULL THEN
    UPDATE vouchers.startups SET
      cover_image_url = 'https://picsum.photos/seed/edupay-voucher/800/500',
      description = 'EduPay school-fee credit vouchers — parents redeem to top up a student''s fee balance instantly.',
      category = 'fintech'
    WHERE id = v_edupay;
  END IF;

  -- ── Voucher products (matched by startup + name, set earlier with a
  --    null image_url) ────────────────────────────────────────────────
  UPDATE vouchers.voucher_products SET image_url = 'https://picsum.photos/seed/akoro-1k/300/300'
    WHERE startup_id = v_akoro AND name = '₦1,000 Voucher';
  UPDATE vouchers.voucher_products SET image_url = 'https://picsum.photos/seed/akoro-2k/300/300'
    WHERE startup_id = v_akoro AND name = '₦2,000 Voucher';
  UPDATE vouchers.voucher_products SET image_url = 'https://picsum.photos/seed/akoro-5k/300/300'
    WHERE startup_id = v_akoro AND name = '₦5,000 Voucher';
  UPDATE vouchers.voucher_products SET image_url = 'https://picsum.photos/seed/akoro-monthly/300/300'
    WHERE startup_id = v_akoro AND name = 'Monthly Plan';
  UPDATE vouchers.voucher_products SET image_url = 'https://picsum.photos/seed/akoro-quarterly/300/300'
    WHERE startup_id = v_akoro AND name = 'Quarterly Plan';
  UPDATE vouchers.voucher_products SET image_url = 'https://picsum.photos/seed/akoro-yearly/300/300'
    WHERE startup_id = v_akoro AND name = 'Yearly Plan';

  RAISE NOTICE 'Enriched voucher demo data with photos/descriptions/categories';
END $$;

NOTIFY pgrst, 'reload schema';
