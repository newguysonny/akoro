-- =============================================================
-- 2026-instructor-templates.sql
-- Instructor-created templates: an instructor uploads an image of their
-- existing material (lesson notes, worksheet, report) and we extract a
-- reusable TEMPLATE (structure/sections/style) that the agent tools can
-- mirror when generating new artifacts.
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.instructor_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id uuid        NOT NULL,
  tool_target   text        NOT NULL DEFAULT 'generic',  -- lesson_plan | worksheet | report | exam_prep | generic
  title         text        NOT NULL,
  source_text   text,                                    -- raw OCR-extracted text
  source_url    text,                                    -- uploaded image/doc URL (optional)
  structure     jsonb       NOT NULL DEFAULT '{}',       -- extracted reusable template spec
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instructor_templates_owner  ON edu.instructor_templates (instructor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_instructor_templates_target ON edu.instructor_templates (tool_target);
