-- =============================================================
-- 2026-workflow-engine.sql
-- Grand Plan Phase 1 (§7.1, §14.1, D11): the generic workflow engine's
-- tables. One persisted run of a workflow is a workflow_instances row
-- (lifecycle `status` for the dashboard, domain `state` for its controller);
-- every step is a workflow_events row. Study Prep dual-writes here behind
-- WORKFLOW_ENGINE_ENABLED; its own tables stay the source of truth until
-- the later phases move reads over. Idempotent.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.workflow_instances (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workflow_type      text NOT NULL CHECK (workflow_type IN ('study_prep', 'teaching', 'decay_review', 'practice')),
  status             text NOT NULL DEFAULT 'created'
                     CHECK (status IN ('created', 'active', 'waiting_learner', 'waiting_child', 'paused', 'completed', 'abandoned', 'cancelled')),
  state              text NOT NULL,
  entry_mode         text,
  parent_workflow_id uuid REFERENCES edu.workflow_instances(id) ON DELETE SET NULL,
  source_workflow_id uuid,
  source_topic_id    uuid,
  source_reason      text,
  idempotency_key    text,
  policy_version     text,
  workflow_version   text,
  context_version    text,
  strategy_version   int,
  locked_until       timestamptz,
  model_selection    jsonb NOT NULL DEFAULT '{}'::jsonb,
  paused_reason      text,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  abandoned_at       timestamptz,
  cancelled_at       timestamptz
);
-- Creating the same workflow twice (same key) returns the first.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_instances_idempotency
  ON edu.workflow_instances (learner_id, workflow_type, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- One non-terminal child per (source workflow, topic, reason).
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_instances_open_child
  ON edu.workflow_instances (source_workflow_id, source_topic_id, source_reason)
  WHERE source_workflow_id IS NOT NULL AND status NOT IN ('completed', 'abandoned', 'cancelled');
CREATE INDEX IF NOT EXISTS idx_workflow_instances_learner
  ON edu.workflow_instances (learner_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS edu.workflow_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id    uuid NOT NULL REFERENCES edu.workflow_instances(id) ON DELETE CASCADE,
  sequence       int NOT NULL,
  event_type     text NOT NULL,
  category       text,
  operation      text,
  workflow_state text,
  sub_state      text,
  context_set    text,
  actor          text CHECK (actor IS NULL OR actor IN ('agent', 'system', 'learner')),
  visibility     text CHECK (visibility IS NULL OR visibility IN ('learner', 'developer', 'audit')),
  turn_id        text,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, sequence)
);

-- Study Prep sessions point at their workflow instance (dual-write).
ALTER TABLE edu.study_prep_sessions
  ADD COLUMN IF NOT EXISTS workflow_id uuid REFERENCES edu.workflow_instances(id) ON DELETE SET NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON edu.workflow_instances TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON edu.workflow_events TO service_role;
NOTIFY pgrst, 'reload schema';
