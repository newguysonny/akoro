-- =============================================================
-- 2026-activity-submissions.sql
-- Activity submissions — the learner's actual work on an assigned
-- activity, stored beside the grade on their self_study_targets row.
--
-- submission — what the learner turned in when they completed the
--              activity: { text, answers, files:[{id,name,size,mime}],
--              submittedAt }. Written once by POST /:id/complete; read
--              by /mine, the activity detail (teacher) and the grading
--              workspace. Answers are keyed by question index.
-- self_study_files — uploaded artifacts, base64 in Postgres, capped at
--              5MB each (enforced by the route, so rows stay small).
--              A file belongs to ONE target — one learner's copy of one
--              activity — and cascades away with it.
-- =============================================================

ALTER TABLE edu.self_study_targets
  ADD COLUMN IF NOT EXISTS submission JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS edu.self_study_files (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id  UUID NOT NULL REFERENCES edu.self_study_targets(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  mime       TEXT,
  size       INTEGER NOT NULL DEFAULT 0,
  data       TEXT NOT NULL,             -- base64 payload
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_self_study_files_target
  ON edu.self_study_files(target_id);
