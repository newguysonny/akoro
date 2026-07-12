-- =============================================================
-- 2026-section-types.sql
-- Section Types catalogue — the reusable arm labels (A, B, C, D, …) a school
-- uses across its classes, each active or inactive. Additive + idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS mgmt.section_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS section_types_school_idx ON mgmt.section_types (school_id, sort_order);

GRANT ALL ON ALL TABLES    IN SCHEMA mgmt TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA mgmt TO service_role;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
