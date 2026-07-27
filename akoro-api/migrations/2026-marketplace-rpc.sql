-- =============================================================
-- 2026-marketplace-rpc.sql
-- Atomic increment for a marketplace listing's student counter. The code calls
-- db.rpc("increment_listing_students", { p_listing_id }); this RPC was never
-- shipped, so the counter silently never moved (the JS logged the RPC error and
-- continued). Idempotent CREATE OR REPLACE.
-- =============================================================
CREATE OR REPLACE FUNCTION public.increment_listing_students(p_listing_id uuid)
RETURNS void LANGUAGE sql AS $$
  UPDATE edu.marketplace_listings
     SET total_students = COALESCE(total_students, 0) + 1
   WHERE id = p_listing_id;
$$;

NOTIFY pgrst, 'reload schema';
