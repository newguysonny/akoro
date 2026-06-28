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
