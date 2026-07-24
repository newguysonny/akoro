-- =============================================================
-- 2026-platform-website-templates.sql
-- Admin-managed catalogue of website templates every school can use. Previously
-- the shared gallery lived only in code (defaultTemplates/*.json); this table
-- lets platform admins add/edit/delete templates and set a default at runtime.
-- The code defaults remain as built-ins; the school gallery merges both.
-- Additive + idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.platform_website_templates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  html           TEXT NOT NULL DEFAULT '',
  import_payload JSONB,                         -- optional { pages, menu } for multi-page import
  thumbnail_url  TEXT,
  is_default     BOOLEAN NOT NULL DEFAULT false,-- the recommended/pre-selected template
  is_published   BOOLEAN NOT NULL DEFAULT true, -- visible in the school gallery
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name)
);
CREATE INDEX IF NOT EXISTS idx_platform_templates_pub ON edu.platform_website_templates (is_published, sort_order);

GRANT ALL ON edu.platform_website_templates TO service_role;
NOTIFY pgrst, 'reload schema';
