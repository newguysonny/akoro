-- =============================================================
-- 2026-tool-outputs.sql
-- Dedicated, queryable store for artifacts produced by instructor agent
-- tools (lesson plans, worksheets, reports, assessments, attendance,
-- interactive decks). Separate from the ephemeral task_outputs delivery
-- queue so instructors can browse/reuse what their agent generated.
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.tool_outputs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id uuid,                         -- task creator (owner)
  task_id       uuid,                         -- originating task (nullable)
  run_id        uuid,                         -- originating run (nullable)
  tool          text        NOT NULL,         -- agent tool name, e.g. 'lesson_plan_fill'
  kind          text        NOT NULL,         -- artifact kind: lesson_plan | worksheet | report | assessment | attendance | interactive
  title         text,
  subject       text,
  content       jsonb       NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tool_outputs_instructor ON edu.tool_outputs (instructor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_outputs_kind       ON edu.tool_outputs (kind);
CREATE INDEX IF NOT EXISTS idx_tool_outputs_task       ON edu.tool_outputs (task_id);
