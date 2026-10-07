-- =============================================================
-- 2026-instructor-templates-body.sql
-- Adds a human-viewable markdown/HTML body to instructor templates (the
-- fillable skeleton the AI completes) alongside the existing jsonb structure,
-- plus platform "sample" templates seeded for the frontend to display.
--
-- Run after 2026-instructor-templates.sql. Safe to re-run (idempotent).
-- =============================================================

ALTER TABLE edu.instructor_templates
  ADD COLUMN IF NOT EXISTS body_markdown text,
  ADD COLUMN IF NOT EXISTS is_sample     boolean NOT NULL DEFAULT false;

-- Sample templates are platform-owned (no instructor) — make the owner optional.
ALTER TABLE edu.instructor_templates ALTER COLUMN instructor_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_instructor_templates_sample ON edu.instructor_templates (is_sample);

-- ── Seed sample templates (idempotent by title+is_sample) ────────────────────
INSERT INTO edu.instructor_templates (instructor_id, tool_target, title, is_sample, structure, body_markdown)
SELECT NULL, v.tool_target, v.title, true, v.structure::jsonb, v.body
FROM (VALUES
  (
    'lesson_plan', 'Sample · Standard Lesson Plan',
    '{"sections":["Title & Class","Learning Objectives","Materials","Starter","Main Activity","Plenary","Differentiation","Assessment","Homework"],"style":"Concise, formal, bullet points","conventions":["Objectives begin with: Students will be able to...","Each phase shows a time in minutes"]}',
    E'# {{lesson_title}}\n**Subject:** {{subject}}  **Class:** {{year_group}}  **Duration:** {{duration}} mins\n\n## Learning Objectives\nStudents will be able to:\n- {{objective_1}}\n- {{objective_2}}\n- {{objective_3}}\n\n## Materials\n- {{materials}}\n\n## Starter ({{starter_mins}} mins)\n{{starter_activity}}\n\n## Main Activity ({{main_mins}} mins)\n{{main_activity}}\n\n## Plenary ({{plenary_mins}} mins)\n{{plenary_activity}}\n\n## Differentiation\n- **Support:** {{support}}\n- **Stretch:** {{stretch}}\n\n## Assessment\n{{assessment}}\n\n## Homework\n{{homework}}'
  ),
  (
    'worksheet', 'Sample · Practice Worksheet',
    '{"sections":["Header","Instructions","Section A — MCQ","Section B — Short Answer","Section C — Problem","Answer Key"],"style":"Clear, numbered questions","conventions":["Number questions sequentially","Leave answer lines for written work"]}',
    E'# {{worksheet_title}}\n**Name:** ____________________  **Date:** ____________\n\n_{{instructions}}_\n\n## Section A — Multiple Choice\n1. {{q1}}\n   - A. {{q1_a}}  B. {{q1_b}}  C. {{q1_c}}  D. {{q1_d}}\n2. {{q2}}\n\n## Section B — Short Answer\n3. {{q3}}\n4. {{q4}}\n\n## Section C — Problem Solving\n5. {{q5}}\n\n## Answer Key\n{{answer_key}}'
  ),
  (
    'report', 'Sample · End-of-Term Report',
    '{"sections":["Student","Attainment","Comment","Strengths","Targets","Signature"],"style":"Professional, balanced","conventions":["2-4 sentence comment","List 2-3 targets"]}',
    E'## End-of-Term Report\n**Student:** {{student_name}}  **Subject:** {{subject}}  **Grade:** {{grade}}\n\n### Teacher''s Comment\n{{comment}}\n\n### Strengths\n- {{strength_1}}\n- {{strength_2}}\n\n### Targets for Next Term\n- {{target_1}}\n- {{target_2}}\n\n_Teacher: _____________________'
  )
) AS v(tool_target, title, structure, body)
WHERE NOT EXISTS (
  SELECT 1 FROM edu.instructor_templates t WHERE t.title = v.title AND t.is_sample = true
);
