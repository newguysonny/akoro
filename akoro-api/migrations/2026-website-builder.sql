-- =============================================================
-- 2026-website-builder.sql
-- Website Builder: media library, site pages and navigation menus for the
-- school's public website. Lives in the mgmt schema alongside the other
-- school-scoped CRUD resources. Additive + idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS mgmt.site_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  media_type text NOT NULL DEFAULT 'image' CHECK (media_type IN ('image','video','document','other')),
  url text NOT NULL,
  alt_text text,
  deleted_at timestamptz,                       -- set = in Trash
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mgmt.site_media ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_site_media_school ON mgmt.site_media (school_id, media_type);

CREATE TABLE IF NOT EXISTS mgmt.site_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  slug text,
  content text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  sort_order int NOT NULL DEFAULT 0,
  deleted_at timestamptz,                       -- set = in Trash (WordPress-style)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, slug)
);
-- For installs where the table already existed before soft-delete:
ALTER TABLE mgmt.site_pages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_site_pages_school ON mgmt.site_pages (school_id, status);

CREATE TABLE IF NOT EXISTS mgmt.site_menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  label text NOT NULL,
  url text,
  page_id uuid REFERENCES mgmt.site_pages(id) ON DELETE SET NULL,
  parent_label text,
  target text NOT NULL DEFAULT '_self' CHECK (target IN ('_self','_blank')),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_site_menu_school ON mgmt.site_menu_items (school_id);

GRANT ALL ON ALL TABLES    IN SCHEMA mgmt TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA mgmt TO service_role;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
