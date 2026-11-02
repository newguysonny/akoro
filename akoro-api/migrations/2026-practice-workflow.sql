-- =============================================================
-- 2026-practice-workflow.sql — Grand Plan Phase 9: each proctored assessment
-- is a `practice` workflow run (edu.workflow_instances). The session row
-- points at its run; the richer states (preparing, in_progress, paused,
-- scoring, evaluated, terminated) live on the run, and
-- assessment_sessions.status stays as it is. Idempotent.
-- =============================================================
ALTER TABLE edu.assessment_sessions
  ADD COLUMN IF NOT EXISTS workflow_id uuid REFERENCES edu.workflow_instances(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_assessment_sessions_workflow ON edu.assessment_sessions (workflow_id) WHERE workflow_id IS NOT NULL;
