-- =============================================================
-- 2026-bulk-import-logs.sql
-- Persists a history of bulk-upload attempts (students CSV, photos, or
-- documents) so the dedicated bulk-upload pages can show a "Recent Import
-- History" table across sessions. Additive + idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS mgmt.bulk_import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('students','photos','documents')),
  file_name text,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','failed','partial')),
  total_rows integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bulk_import_logs_school_idx ON mgmt.bulk_import_logs (school_id, kind, created_at DESC);

GRANT ALL ON ALL TABLES    IN SCHEMA mgmt TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA mgmt TO service_role;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
