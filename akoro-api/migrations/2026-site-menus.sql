-- =============================================================
-- 2026-site-menus.sql
-- WordPress-style menus: named menus assigned to a location (primary / footer
-- / social), each holding ordered menu items. Extends the existing
-- site_menu_items with a menu_id. Additive + idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS mgmt.site_menus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  location text CHECK (location IN ('primary','footer','social')),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- One menu per location per school (a location can hold only one menu).
CREATE UNIQUE INDEX IF NOT EXISTS uq_site_menus_location
  ON mgmt.site_menus (school_id, location) WHERE location IS NOT NULL;

-- Menu items belong to a menu.
ALTER TABLE mgmt.site_menu_items ADD COLUMN IF NOT EXISTS menu_id uuid
  REFERENCES mgmt.site_menus(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_site_menu_items_menu ON mgmt.site_menu_items (menu_id, sort_order);

GRANT ALL ON ALL TABLES    IN SCHEMA mgmt TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA mgmt TO service_role;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
