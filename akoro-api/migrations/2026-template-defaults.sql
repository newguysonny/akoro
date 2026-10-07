-- =============================================================
-- 2026-template-defaults.sql
-- Per-instructor default template choice for each template-driven tool type.
-- If a default is set, the tool fills that template; if not, the agent
-- generates directly from the LLM (no template).
--
-- Run after 2026-instructor-templates-body.sql. Safe to re-run.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.instructor_template_defaults (
  instructor_id uuid        NOT NULL,
  tool_target   text        NOT NULL,   -- lesson_plan | worksheet | report | exam_prep
  template_id   uuid        REFERENCES edu.instructor_templates(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instructor_id, tool_target)
);

CREATE INDEX IF NOT EXISTS idx_template_defaults_instructor ON edu.instructor_template_defaults (instructor_id);
