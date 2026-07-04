-- =============================================================
-- 2026-instructor-doc-templates.sql
-- Instructor-owned document/form templates (their own, plus the shared default
-- gallery). Mirrors mgmt.document_templates but keyed by the instructor user.
-- Additive + idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.instructor_document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'form',
  page_size text NOT NULL DEFAULT 'A4',
  orientation text NOT NULL DEFAULT 'portrait',
  body text NOT NULL DEFAULT '',
  css text,
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_instr_doc_templates_user ON public.instructor_document_templates (user_id);

CREATE TABLE IF NOT EXISTS public.instructor_document_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.instructor_document_templates(id) ON DELETE SET NULL,
  title text NOT NULL,
  serial_no text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  issued_on date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);

NOTIFY pgrst, 'reload schema';
