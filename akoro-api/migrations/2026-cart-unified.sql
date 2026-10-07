-- =============================================================
-- 2026-cart-unified.sql
-- Unified cart: cart_items can now hold either a course OR a marketplace agent
-- (teaching guide) listing, so a single checkout can pay for both together.
-- Additive + idempotent.
-- =============================================================

-- item_type discriminates the row; listing_id points at edu.marketplace_listings
-- for agent items (no hard cross-schema FK — kept as a plain uuid to avoid
-- migration-order coupling; the app resolves/validates it).
ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS item_type  text NOT NULL DEFAULT 'course';
ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS listing_id uuid;

-- course_id is only required for course rows now.
ALTER TABLE public.cart_items ALTER COLUMN course_id DROP NOT NULL;

ALTER TABLE public.cart_items DROP CONSTRAINT IF EXISTS cart_items_type_check;
ALTER TABLE public.cart_items ADD CONSTRAINT cart_items_type_check
  CHECK ((item_type = 'course' AND course_id IS NOT NULL)
      OR (item_type = 'agent'  AND listing_id IS NOT NULL));

-- One agent listing per user (the existing UNIQUE(user_id, course_id) already
-- de-dupes courses; NULL course_ids don't collide in Postgres).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cart_items_listing_uniq
  ON public.cart_items (user_id, listing_id) WHERE listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cart_items_listing ON public.cart_items (listing_id);

-- A cart payment covering only agent items has no course, so payments.course_id
-- must be optional now.
ALTER TABLE public.payments ALTER COLUMN course_id DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
