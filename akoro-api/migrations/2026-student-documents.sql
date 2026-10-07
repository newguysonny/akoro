-- =============================================================
-- 2026-student-documents.sql
-- Per-student uploaded documents (bulk doc upload from the Student List page).
-- Additive + idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS mgmt.student_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES mgmt.students(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_student_documents_student ON mgmt.student_documents (school_id, student_id);

GRANT ALL ON ALL TABLES    IN SCHEMA mgmt TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA mgmt TO service_role;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
