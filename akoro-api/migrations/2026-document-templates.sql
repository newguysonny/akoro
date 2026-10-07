-- =============================================================
-- 2026-document-templates.sql
-- Document / form template engine. Templates are stored as HTML (tables,
-- section headers, dotted-line fields, {{variables}}) with page settings, so
-- they render — and print — exactly like the real paper document (A4/Letter).
-- A generated record captures the filled-in values + a serial number.
-- Additive + idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS mgmt.document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'form'
    CHECK (category IN ('form','certificate','report','letter','id_card','result','other')),
  page_size text NOT NULL DEFAULT 'A4' CHECK (page_size IN ('A4','Letter','A5','Legal')),
  orientation text NOT NULL DEFAULT 'portrait' CHECK (orientation IN ('portrait','landscape')),
  body text NOT NULL DEFAULT '',          -- HTML with {{variables}}
  css text,                               -- optional extra styles
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ key, label }] for the fill form
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);
CREATE INDEX IF NOT EXISTS idx_document_templates_school ON mgmt.document_templates (school_id, category);

CREATE TABLE IF NOT EXISTS mgmt.document_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  template_id uuid REFERENCES mgmt.document_templates(id) ON DELETE SET NULL,
  title text NOT NULL,
  serial_no text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb, -- filled variable values
  student_id uuid REFERENCES mgmt.students(id) ON DELETE SET NULL,
  staff_id uuid REFERENCES mgmt.staff(id) ON DELETE SET NULL,
  issued_on date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, serial_no)
);
CREATE INDEX IF NOT EXISTS idx_document_records_school ON mgmt.document_records (school_id, template_id);

GRANT ALL ON ALL TABLES    IN SCHEMA mgmt TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA mgmt TO service_role;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
