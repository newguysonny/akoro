-- =============================================================
-- 2026-run-all.sql
-- Bundled, ordered migration — paste this whole file once into the
-- Supabase SQL Editor. Every statement is idempotent (IF NOT EXISTS /
-- ON CONFLICT), so it is safe to re-run.
--
-- Order:
--   1. 2026-missing-columns.sql
--   2. 2026-platform-tools.sql
--   3. 2026-platform-tools-agent.sql
--   4. 2026-tool-outputs.sql
--   5. 2026-instructor-templates.sql
--   6. 2026-instructor-templates-body.sql
--   7. 2026-template-defaults.sql
-- =============================================================


-- ▼▼▼ ───────────────────────────────────────────────────────────────── ▼▼▼
-- FILE: 2026-missing-columns.sql
-- ▲▲▲ ───────────────────────────────────────────────────────────────── ▲▲▲

-- =============================================================
-- 2026-missing-columns.sql
-- Run once on your Supabase DB (SQL Editor or psql).
-- Adds columns that are referenced by the API but not yet
-- present on the production schema.
-- All statements use IF NOT EXISTS / IF EXISTS so they are
-- safe to re-run without error.
-- =============================================================

-- ── 1. public.user_agents — guide profile columns ─────────────────────────────
-- Referenced by: modules/adaptive-learning/websocket.js,
--                modules/profiles/routes.js, modules/courses/agents.js
ALTER TABLE public.user_agents
  ADD COLUMN IF NOT EXISTS teacher_agent_id   text    DEFAULT 'nana-sargeant',
  ADD COLUMN IF NOT EXISTS guide_name         text    DEFAULT 'NaNa Esumai',
  ADD COLUMN IF NOT EXISTS guide_emoji        text    DEFAULT '🧠',
  ADD COLUMN IF NOT EXISTS guide_render_style jsonb   DEFAULT '{
    "bubbleBg":     "rgba(124,58,237,0.10)",
    "bubbleBorder": "#7C3AED",
    "labelColor":   "#7C3AED",
    "ttsVoice":     "alloy",
    "assessStyle":  "gentle"
  }';

-- Back-fill existing rows that have NULL for these new columns
UPDATE public.user_agents
SET
  teacher_agent_id   = COALESCE(teacher_agent_id,   'nana-sargeant'),
  guide_name         = COALESCE(guide_name,          'NaNa Esumai'),
  guide_emoji        = COALESCE(guide_emoji,         '🧠'),
  guide_render_style = COALESCE(guide_render_style,  '{
    "bubbleBg":     "rgba(124,58,237,0.10)",
    "bubbleBorder": "#7C3AED",
    "labelColor":   "#7C3AED",
    "ttsVoice":     "alloy",
    "assessStyle":  "gentle"
  }'::jsonb)
WHERE teacher_agent_id IS NULL
   OR guide_name       IS NULL
   OR guide_emoji      IS NULL
   OR guide_render_style IS NULL;

-- ── 2. edu.adaptive_sessions — block_history column ──────────────────────────
-- Referenced by: modules/adaptive-learning/websocket.js (transcript persistence)
ALTER TABLE edu.adaptive_sessions
  ADD COLUMN IF NOT EXISTS block_history jsonb DEFAULT '[]';

-- Back-fill any existing rows
UPDATE edu.adaptive_sessions
SET block_history = '[]'
WHERE block_history IS NULL;

-- ── 3. edu.adaptive_sessions — other optional columns referenced in code ──────
-- These are added defensively in case patch5 was partially applied.
ALTER TABLE edu.adaptive_sessions
  ADD COLUMN IF NOT EXISTS current_subtopic_idx  integer  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_phase         text     DEFAULT '1',
  ADD COLUMN IF NOT EXISTS session_history       jsonb    DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS objectives_covered    jsonb    DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS confidence_by_subtopic jsonb   DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS completed_at          timestamptz;

-- ── 4. edu.student_states — ensure table exists with correct shape ────────────
-- The adaptive engine reads/writes here; if it was never migrated the whole
-- session will fall back to a blank default state on every turn.
CREATE TABLE IF NOT EXISTS edu.student_states (
  id         bigserial PRIMARY KEY,
  agent_id   text        NOT NULL UNIQUE,
  state      jsonb       NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_states_agent_id ON edu.student_states (agent_id);

-- ── 5. Confirm edu schema is exposed to PostgREST ────────────────────────────
-- Run this if you see "Invalid schema: edu" — it tells PostgREST to allow
-- direct queries to the edu schema via the JS client (.schema("edu")).
-- (Must also be added in Supabase Dashboard → Settings → API → Exposed schemas)
DO $$
BEGIN
  -- This is a no-op if pgrst config is managed via dashboard; safe to run.
  NULL;
END $$;

-- Verify (run these SELECTs to confirm columns exist after migration):
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'user_agents'
--   AND column_name IN ('guide_emoji','guide_name','teacher_agent_id','guide_render_style');
--
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'edu' AND table_name = 'adaptive_sessions'
--   AND column_name IN ('block_history','current_phase','completed_at');


-- ▼▼▼ ───────────────────────────────────────────────────────────────── ▼▼▼
-- FILE: 2026-platform-tools.sql
-- ▲▲▲ ───────────────────────────────────────────────────────────────── ▲▲▲

-- =============================================================
-- 2026-platform-tools.sql
-- Platform-owned Tools & Assets that instructors purchase to unlock
-- for their teaching agent. Prices live HERE (DB), not on the teacher end.
--
-- Run once in Supabase SQL Editor. Safe to re-run (idempotent).
-- =============================================================

-- ── Catalog: the platform's tools & assets (prices set by us) ────────────────
CREATE TABLE IF NOT EXISTS edu.platform_tools (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text        NOT NULL UNIQUE,             -- stable slug, e.g. 'lesson-plan'
  kind        text        NOT NULL CHECK (kind IN ('tool','asset')),
  name        text        NOT NULL,
  description text        NOT NULL DEFAULT '',
  emoji       text        NOT NULL DEFAULT '🛠️',
  tag         text,                                    -- optional pill label e.g. 'Voice agent'
  price_kobo  integer     NOT NULL DEFAULT 0,          -- ₦ price × 100 (0 = free)
  currency    text        NOT NULL DEFAULT 'NGN',
  is_active   boolean     NOT NULL DEFAULT true,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Ownership: which instructor has unlocked which tool/asset ────────────────
CREATE TABLE IF NOT EXISTS edu.instructor_tool_access (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id   uuid        NOT NULL,
  tool_id         uuid        NOT NULL REFERENCES edu.platform_tools(id) ON DELETE CASCADE,
  amount_kobo     integer     NOT NULL DEFAULT 0,
  currency        text        NOT NULL DEFAULT 'NGN',
  paystack_ref    text,
  paystack_status text        NOT NULL DEFAULT 'pending',  -- pending | success | failed | refunded
  access_granted  boolean     NOT NULL DEFAULT false,
  purchased_at    timestamptz NOT NULL DEFAULT now(),
  verified_at     timestamptz,
  UNIQUE (instructor_id, tool_id)
);

CREATE INDEX IF NOT EXISTS idx_instructor_tool_access_instructor
  ON edu.instructor_tool_access (instructor_id);
CREATE INDEX IF NOT EXISTS idx_instructor_tool_access_ref
  ON edu.instructor_tool_access (paystack_ref);

-- ── Seed the catalog (prices in kobo) ────────────────────────────────────────
INSERT INTO edu.platform_tools (key, kind, name, description, emoji, tag, price_kobo, sort_order) VALUES
  -- Tools
  ('lesson-plan',    'tool', 'Lesson Plan Template Fill',    'Auto-fill a structured lesson plan from your topic, objectives and year group.', '📝', NULL,         150000, 1),
  ('worksheets',     'tool', 'Worksheets Template Fill',     'Generate ready-to-print worksheets with questions tailored to your class level.', '📄', NULL,         120000, 2),
  ('report-writing', 'tool', 'Report Writing Template Fill', 'Draft end-of-term student reports and comments from performance notes.',          '🗒️', NULL,         150000, 3),
  ('grading',        'tool', 'Grading',                      'Mark submissions against a rubric and return scores with feedback in seconds.',  '✅', NULL,         200000, 4),
  ('attendance',     'tool', 'Attendance / Roll Call',       'Voice agent takes the register hands-free and logs attendance automatically.',   '🎙️', 'Voice agent', 100000, 5),
  ('interactive',    'tool', 'Interactive Material',         'Turn any lesson into interactive slides and activities (powered by Gamma.app).', '🎬', 'Gamma.app',   250000, 6),
  ('exam-prep',      'tool', 'Exam Prep Assessment',         'Build a proctored exam-prep assessment and track each student''s readiness.',    '🎯', NULL,         250000, 7),
  -- Assets
  ('jamb-pq',        'asset', 'JAMB Past Questions & Answers',  'Complete JAMB past questions with worked answers across all subjects.',  '📚', NULL, 200000, 8),
  ('neco-pq',        'asset', 'NECO Past Questions & Answers',  'NECO past questions and answers, organised by subject and year.',        '📚', NULL, 200000, 9),
  ('waec-pq',        'asset', 'WAEC Past Questions & Answers',  'WAEC past questions and answers, organised by subject and year.',        '📚', NULL, 200000, 10),
  ('bece-pq',        'asset', 'BECE Past Questions & Answers',  'Basic Education Certificate Exam past questions with answers.',          '📒', NULL, 150000, 11),
  ('gce-pq',         'asset', 'GCE Past Questions & Answers',   'GCE past questions and answers across core subjects.',                   '📒', NULL, 180000, 12),
  ('putme-pq',       'asset', 'Post-UTME Past Questions',       'Post-UTME screening past questions and answers by institution.',         '📒', NULL, 180000, 13),
  ('nabteb-pq',      'asset', 'NABTEB Past Questions & Answers','NABTEB past questions and answers for technical & business subjects.',   '📒', NULL, 150000, 14),
  ('waec-syl',       'asset', 'WAEC Syllabus',                  'Full WAEC syllabus and scheme of work for all subjects.',                '📑', NULL, 100000, 15),
  ('jamb-syl',       'asset', 'JAMB Syllabus',                  'Official JAMB syllabus and recommended texts by subject.',               '📑', NULL, 100000, 16),
  ('neco-syl',       'asset', 'NECO Syllabus',                  'Full NECO syllabus and scheme of work for all subjects.',                '📑', NULL, 100000, 17),
  ('bece-syl',       'asset', 'BECE Syllabus',                  'Basic Education Certificate Exam syllabus and topic breakdown.',         '📑', NULL,  80000, 18)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      kind = EXCLUDED.kind,
      description = EXCLUDED.description,
      emoji = EXCLUDED.emoji,
      tag = EXCLUDED.tag,
      sort_order = EXCLUDED.sort_order,
      updated_at = now();
-- NOTE: price_kobo is intentionally NOT overwritten on re-run, so manual price
-- edits you make in the DB are preserved. New rows use the seed price above.


-- ▼▼▼ ───────────────────────────────────────────────────────────────── ▼▼▼
-- FILE: 2026-platform-tools-agent.sql
-- ▲▲▲ ───────────────────────────────────────────────────────────────── ▲▲▲

-- =============================================================
-- 2026-platform-tools-agent.sql
-- Adds the EXISTING agent/chat tools to the platform_tools catalog so they
-- are also purchase-gated. After this, a brand-new instructor agent has NO
-- tool commands — each becomes available only once the instructor unlocks it.
--
-- Run after 2026-platform-tools.sql. Safe to re-run (idempotent).
-- =============================================================

INSERT INTO edu.platform_tools (key, kind, name, description, emoji, tag, price_kobo, sort_order) VALUES
  ('quiz-generator',  'tool', 'Quiz Generator',        'Agent generates quizzes for any topic, difficulty and question count.',        '📝', NULL, 150000, 19),
  ('student-data',    'tool', 'Student Progress',      'Agent fetches student performance, attendance and progress data on request.',  '📊', NULL, 100000, 20),
  ('send-reminder',   'tool', 'Send Reminder',         'Agent sends reminders and nudges to students (notification + message).',        '🔔', NULL,  80000, 21),
  ('schedule-session','tool', 'Schedule Session',      'Agent schedules live classes / sessions and notifies enrolled students.',       '📅', NULL,  80000, 22),
  ('export-report',   'tool', 'Reports & Battle Report','Agent compiles progress reports and battle/ranking reports on demand.',         '📈', NULL, 150000, 23),
  ('create-battle',   'tool', 'Create Battle',         'Agent creates 1v1 / class battles and challenges between students.',            '⚔️', NULL, 100000, 24)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      kind = EXCLUDED.kind,
      description = EXCLUDED.description,
      emoji = EXCLUDED.emoji,
      tag = EXCLUDED.tag,
      sort_order = EXCLUDED.sort_order,
      updated_at = now();
-- price_kobo not overwritten on re-run (preserves manual price edits).


-- ▼▼▼ ───────────────────────────────────────────────────────────────── ▼▼▼
-- FILE: 2026-tool-outputs.sql
-- ▲▲▲ ───────────────────────────────────────────────────────────────── ▲▲▲

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


-- ▼▼▼ ───────────────────────────────────────────────────────────────── ▼▼▼
-- FILE: 2026-instructor-templates.sql
-- ▲▲▲ ───────────────────────────────────────────────────────────────── ▲▲▲

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


-- ▼▼▼ ───────────────────────────────────────────────────────────────── ▼▼▼
-- FILE: 2026-instructor-templates-body.sql
-- ▲▲▲ ───────────────────────────────────────────────────────────────── ▲▲▲

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


-- ▼▼▼ ───────────────────────────────────────────────────────────────── ▼▼▼
-- FILE: 2026-template-defaults.sql
-- ▲▲▲ ───────────────────────────────────────────────────────────────── ▲▲▲

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

