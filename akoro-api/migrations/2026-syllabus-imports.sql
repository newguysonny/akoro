-- =============================================================
-- 2026-syllabus-imports.sql — a syllabus PDF import as a DRAFT for review.
-- The importer (modules/adaptive-learning/syllabus-import/) reads a digital
-- PDF with its layout, structures it in page chunks and stores the result
-- here; nothing reaches edu.syllabus_* (what learners and agents read) until
-- an admin publishes it. Idempotent.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.syllabus_imports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam          text NOT NULL,
  name          text,
  source_file   text,
  status        text NOT NULL DEFAULT 'extracting'
                CHECK (status IN ('extracting', 'draft', 'failed', 'published', 'discarded')),
  progress      jsonb NOT NULL DEFAULT '{}'::jsonb,
  doc           jsonb,
  stats         jsonb,
  warnings      jsonb NOT NULL DEFAULT '[]'::jsonb,
  error         text,
  subject_id    uuid,
  created_by    uuid,
  published_by  uuid,
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_syllabus_imports_status ON edu.syllabus_imports (status, created_at DESC);
ALTER TABLE edu.syllabus_imports ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON edu.syllabus_imports TO service_role;
NOTIFY pgrst, 'reload schema';
