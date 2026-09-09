-- =============================================================
-- 2026-activity-types.sql
-- Activities — one brief, four kinds.
--
-- An instructor assigns more than self study: assignments, projects and
-- live courses are the same shape of act (write a brief, pick learners,
-- track who has done it), so rather than a parallel world per kind they
-- extend the table that already has targeting, progress and notifications:
-- edu.self_study_assignments gains `type` and a free-form `details` bag
-- (live-course schedule, project deliverables…).
--
-- 'self_study' stays the default, so every existing row and every existing
-- caller keeps its exact meaning. Learner surfaces read `type` through the
-- /mine payload and file cards under the right pill.
--
-- Idempotent: guarded column adds, and a DO block for the CHECK built from
-- the union of known and existing values so a rerun can never narrow it.
-- =============================================================

ALTER TABLE edu.self_study_assignments
  ADD COLUMN IF NOT EXISTS type    TEXT NOT NULL DEFAULT 'self_study';
ALTER TABLE edu.self_study_assignments
  ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_self_study_type
  ON edu.self_study_assignments(created_by, type, created_at DESC);

DO $$
DECLARE v_vals text[];
BEGIN
  SELECT array_agg(DISTINCT s ORDER BY s) INTO v_vals
  FROM (SELECT unnest(ARRAY['self_study','assignment','project','live_course','multi_stage']) AS s
        UNION SELECT DISTINCT type FROM edu.self_study_assignments WHERE type IS NOT NULL) t;

  ALTER TABLE edu.self_study_assignments DROP CONSTRAINT IF EXISTS self_study_assignments_type_check;
  EXECUTE format(
    'ALTER TABLE edu.self_study_assignments ADD CONSTRAINT self_study_assignments_type_check CHECK (type = ANY (%L))',
    v_vals);
END $$;
