-- =============================================================
-- 2026-payment-items-check-fix.sql
-- Fix a latent bug: payment_items.course_id / listing_id are ON DELETE SET NULL,
-- but the original CHECK required the id to be NOT NULL for its item_type. So
-- deleting a purchased course (or listing) set the id to NULL and then violated
-- the CHECK — breaking course deletion (and the demo-course dedup seed) whenever
-- purchases existed.
--
-- payment_items snapshots `title` and `unit_price_kobo` at purchase time, so the
-- audit row is still meaningful without the id. Relax the CHECK to require an id
-- OR a title snapshot at insert, while allowing the id to become NULL on delete.
-- Idempotent.
-- =============================================================
ALTER TABLE public.payment_items DROP CONSTRAINT IF EXISTS payment_items_check;
ALTER TABLE public.payment_items DROP CONSTRAINT IF EXISTS payment_items_item_ref;

ALTER TABLE public.payment_items ADD CONSTRAINT payment_items_item_ref CHECK (
      (item_type = 'course' AND (course_id  IS NOT NULL OR title IS NOT NULL))
   OR (item_type = 'agent'  AND (listing_id IS NOT NULL OR title IS NOT NULL))
);

NOTIFY pgrst, 'reload schema';
