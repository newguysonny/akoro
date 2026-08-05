-- =============================================================
-- 2026-curriculum.sql
-- Curriculum bank — NERDC, and whatever bodies follow.
--
-- Its own tables rather than an extension of edu.syllabus_*, because the two
-- describe different things and forcing either into the other's shape distorts
-- it. A syllabus is what an EXAM will test, keyed by exam and subject. A
-- curriculum is what a CLASS is taught across a year, keyed by body, class and
-- theme, and it carries teaching apparatus — performance objectives, teacher
-- and student activities, materials, evaluation — that a syllabus has no column
-- for.
--
-- The shape follows how NERDC actually prints a curriculum:
--
--   body → curriculum (subject + edition)
--            → theme        ("Basic Science")
--                → sub-theme ("Learning About Our Environment", Primary 4)
--                    → topic ("Changes in Nature")
--
-- and each topic carries the five columns of the printed page as arrays:
-- performance objectives, content, teacher activities, student activities,
-- teaching materials and the evaluation guide.
--
-- Retrieval mirrors syllabus and past questions: pgvector 1536 + ivfflat and a
-- match_curriculum() RPC, so agents ground in all three the same way.
--
-- Idempotent; safe to re-run.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Curriculum bodies ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.curriculum_bodies (
  slug        text PRIMARY KEY,
  name        text NOT NULL,
  full_name   text,
  country     text NOT NULL DEFAULT 'Nigeria',
  description text NOT NULL DEFAULT '',
  emoji       text NOT NULL DEFAULT '📗',
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true
);

INSERT INTO edu.curriculum_bodies (slug, name, full_name, description, emoji, sort_order) VALUES
  ('nerdc',     'NERDC',     'Nigerian Educational Research and Development Council',
   'The national curriculum for Basic and Senior Secondary Education in Nigeria.', '🇳🇬', 1),
  ('waec',      'WAEC',      'West African Examinations Council',
   'Regional curriculum and teaching syllabuses for the senior certificate.', '📘', 2),
  ('neco',      'NECO',      'National Examinations Council',
   'Curriculum guides published alongside the NECO senior certificate.', '📕', 3),
  ('ub',        'UBE',       'Universal Basic Education Commission',
   'Basic education curriculum guidance for Primary and Junior Secondary.', '🏫', 4),
  ('cambridge', 'Cambridge', 'Cambridge Assessment International Education',
   'Cambridge Primary, Lower Secondary and IGCSE curriculum frameworks.', '🌍', 5)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name, full_name = EXCLUDED.full_name,
      description = EXCLUDED.description, emoji = EXCLUDED.emoji, sort_order = EXCLUDED.sort_order;

-- ── A curriculum document ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.curricula (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body_slug    text NOT NULL REFERENCES edu.curriculum_bodies(slug) ON DELETE RESTRICT,
  title        text NOT NULL,                       -- "Basic Science and Technology Curriculum"
  subject      text,                                -- normalised subject for filtering
  edition_year integer,                             -- 2012 (revised)
  stage        text,                                -- 'primary' | 'junior' | 'senior'
  classes      text[] NOT NULL DEFAULT '{}',        -- {'Primary 4','Primary 5','Primary 6'}
  -- The formal front matter, kept verbatim where we have it: foreword, preface,
  -- introduction, objectives, structure. A curriculum's authority lives in
  -- these, so they are stored rather than summarised.
  foreword     text,
  preface      text,
  introduction text,
  objectives   text,
  source_url   text,
  page_count   integer,
  status       text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'review', 'published')),
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (body_slug, title, edition_year)
);
CREATE INDEX IF NOT EXISTS idx_curricula_body    ON edu.curricula (body_slug, edition_year DESC);
CREATE INDEX IF NOT EXISTS idx_curricula_subject ON edu.curricula (subject) WHERE subject IS NOT NULL;

-- ── Themes ("Basic Science", "Information Technology") ───────────────────────
CREATE TABLE IF NOT EXISTS edu.curriculum_themes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id uuid NOT NULL REFERENCES edu.curricula(id) ON DELETE CASCADE,
  title         text NOT NULL,
  description   text,
  sort_order    integer NOT NULL DEFAULT 0,
  UNIQUE (curriculum_id, title)
);
CREATE INDEX IF NOT EXISTS idx_curriculum_themes_curriculum ON edu.curriculum_themes (curriculum_id, sort_order);

-- ── Sub-themes, which is where the class band lives ──────────────────────────
CREATE TABLE IF NOT EXISTS edu.curriculum_subthemes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id    uuid NOT NULL REFERENCES edu.curriculum_themes(id) ON DELETE CASCADE,
  title       text NOT NULL,
  class_label text,                                 -- "Primary 4"
  page_from   integer,
  page_to     integer,
  sort_order  integer NOT NULL DEFAULT 0,
  UNIQUE (theme_id, title, class_label)
);
CREATE INDEX IF NOT EXISTS idx_curriculum_subthemes_theme ON edu.curriculum_subthemes (theme_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_curriculum_subthemes_class ON edu.curriculum_subthemes (class_label);

-- ── Topics — one row per printed topic, carrying the five columns ────────────
CREATE TABLE IF NOT EXISTS edu.curriculum_topics (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id uuid NOT NULL REFERENCES edu.curricula(id) ON DELETE CASCADE,
  subtheme_id   uuid REFERENCES edu.curriculum_subthemes(id) ON DELETE CASCADE,
  title         text NOT NULL,
  class_label   text,
  -- The printed page's columns. Arrays because each cell is a bulleted list,
  -- and a teacher reads them side by side rather than as prose.
  performance_objectives text[] NOT NULL DEFAULT '{}',
  content                text[] NOT NULL DEFAULT '{}',
  teacher_activities     text[] NOT NULL DEFAULT '{}',
  student_activities     text[] NOT NULL DEFAULT '{}',
  materials              text[] NOT NULL DEFAULT '{}',
  evaluation             text[] NOT NULL DEFAULT '{}',
  periods       integer,                            -- suggested periods/weeks
  source_page   integer,
  -- Detail arrives with the scanned pages; the table of contents gives the
  -- skeleton first. This says plainly which a row is.
  detailed      boolean NOT NULL DEFAULT false,
  embedding     vector(1536),
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subtheme_id, title)
);
CREATE INDEX IF NOT EXISTS idx_curriculum_topics_curriculum ON edu.curriculum_topics (curriculum_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_curriculum_topics_class      ON edu.curriculum_topics (class_label);
CREATE INDEX IF NOT EXISTS idx_curriculum_topics_detailed   ON edu.curriculum_topics (detailed);
CREATE INDEX IF NOT EXISTS idx_curriculum_topics_embedding
  ON edu.curriculum_topics USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ── Ingestion log, same pattern as the past-paper scans ──────────────────────
CREATE TABLE IF NOT EXISTS edu.curriculum_ingests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id uuid NOT NULL REFERENCES edu.curricula(id) ON DELETE CASCADE,
  page_from     integer,
  page_to       integer,
  raw_text      text,
  parsed        jsonb,
  found         integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'parsed', 'imported', 'failed')),
  error         text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_curriculum_ingests_curriculum ON edu.curriculum_ingests (curriculum_id, created_at DESC);

-- ── Semantic search ──────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS match_curriculum(vector, text, text, text, integer);
CREATE OR REPLACE FUNCTION match_curriculum(
  p_query_embedding vector(1536),
  p_body            text DEFAULT NULL,
  p_subject         text DEFAULT NULL,
  p_class           text DEFAULT NULL,
  p_limit           integer DEFAULT 6
)
RETURNS TABLE (
  id uuid, curriculum_id uuid, body_slug text, curriculum_title text, subject text,
  theme text, subtheme text, topic text, class_label text,
  performance_objectives text[], content text[], teacher_activities text[],
  student_activities text[], materials text[], evaluation text[],
  detailed boolean, similarity float
)
LANGUAGE sql STABLE AS $$
  SELECT t.id, c.id, c.body_slug, c.title, COALESCE(c.subject, th.title),
         th.title, st.title, t.title, t.class_label,
         t.performance_objectives, t.content, t.teacher_activities,
         t.student_activities, t.materials, t.evaluation,
         t.detailed,
         1 - (t.embedding <=> p_query_embedding) AS similarity
  FROM edu.curriculum_topics t
  JOIN edu.curricula c            ON c.id = t.curriculum_id
  LEFT JOIN edu.curriculum_subthemes st ON st.id = t.subtheme_id
  LEFT JOIN edu.curriculum_themes th    ON th.id = st.theme_id
  WHERE t.embedding IS NOT NULL
    AND c.status = 'published'
    AND (p_body    IS NULL OR c.body_slug = p_body)
    AND (p_subject IS NULL OR COALESCE(c.subject, th.title) ILIKE p_subject)
    AND (p_class   IS NULL OR t.class_label ILIKE p_class)
  ORDER BY t.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;

GRANT USAGE ON SCHEMA edu TO authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  edu.curriculum_bodies, edu.curricula, edu.curriculum_themes,
  edu.curriculum_subthemes, edu.curriculum_topics, edu.curriculum_ingests TO authenticator;

NOTIFY pgrst, 'reload schema';
