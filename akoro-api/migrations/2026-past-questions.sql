-- =============================================================
-- 2026-past-questions.sql
-- Past questions & answers bank — WAEC, NECO, JAMB, NCEE, BECE, PSLC.
--
-- Shape follows how a real paper is actually built, because anything flatter
-- loses information the question can't be answered without:
--
--   exam body  →  paper (one sitting: exam + year + paper)
--                   →  section  (PART A · MATHEMATICS, SECTION A · COMPREHENSION)
--                        →  passage (a comprehension text shared by Q1-10)
--                             →  question (stem, options A-E, answer, explanation)
--
-- Two things the papers themselves forced:
--   • Options run A-E, not A-D. Storing them as jsonb rather than four columns
--     keeps that (and the odd 3-option question) honest.
--   • Aptitude questions ARE diagrams. Every level carries an image_url, so a
--     question whose stem is a figure is still usable rather than silently
--     stored as an empty string.
--
-- Retrieval mirrors edu.syllabus_chunks: pgvector 1536 + ivfflat cosine, and a
-- match_past_questions() RPC, so agents ground in past questions exactly the
-- way they already ground in the syllabus.
--
-- Idempotent; safe to re-run.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Exam bodies ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.exam_bodies (
  slug        text PRIMARY KEY,
  name        text NOT NULL,
  full_name   text,
  country     text NOT NULL DEFAULT 'Nigeria',
  level       text NOT NULL DEFAULT 'secondary'
                CHECK (level IN ('primary', 'junior', 'secondary', 'tertiary')),
  description text NOT NULL DEFAULT '',
  emoji       text NOT NULL DEFAULT '📝',
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true
);

INSERT INTO edu.exam_bodies (slug, name, full_name, level, description, emoji, sort_order) VALUES
  ('ncee', 'NCEE',  'National Common Entrance Examination',        'primary',   'Entrance examination into Federal Unity Colleges, taken in Primary 6.', '🎒', 1),
  ('pslc', 'PSLC',  'Primary School Leaving Certificate',          'primary',   'End-of-primary certificate examination.',                              '🏫', 2),
  ('bece', 'BECE',  'Basic Education Certificate Examination',     'junior',    'End-of-JSS3 certificate examination.',                                 '📗', 3),
  ('waec', 'WAEC',  'West African Senior School Certificate Exam', 'secondary', 'WASSCE — the senior secondary school certificate examination.',         '📘', 4),
  ('neco', 'NECO',  'National Examinations Council',               'secondary', 'SSCE run by the National Examinations Council.',                       '📕', 5),
  ('jamb', 'JAMB',  'Joint Admissions and Matriculation Board',    'tertiary',  'UTME — the university admissions examination.',                        '🎓', 6),
  ('gce',  'GCE',   'General Certificate of Education',            'secondary', 'The private-candidate sitting of the senior certificate exam.',         '📙', 7)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name, full_name = EXCLUDED.full_name, level = EXCLUDED.level,
      description = EXCLUDED.description, emoji = EXCLUDED.emoji, sort_order = EXCLUDED.sort_order;

-- ── Papers ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.past_papers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_slug    text NOT NULL REFERENCES edu.exam_bodies(slug) ON DELETE RESTRICT,
  year         integer NOT NULL,
  title        text NOT NULL,                       -- "Paper I — Achievement Test"
  subject      text,                                -- NULL when the paper spans subjects
  paper_code   text,                                -- "Paper I", "Paper II"
  variant      text,                                -- "Aptitude", "English and Maths"
  duration_min integer,
  source_url   text,                                -- the scanned original
  page_count   integer,
  status       text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'review', 'published')),
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- instructions, marks, notes
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_slug, year, title)
);
CREATE INDEX IF NOT EXISTS idx_past_papers_exam ON edu.past_papers (exam_slug, year DESC);
CREATE INDEX IF NOT EXISTS idx_past_papers_subject ON edu.past_papers (subject) WHERE subject IS NOT NULL;

-- ── Sections (PART A · MATHEMATICS) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.paper_sections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id     uuid NOT NULL REFERENCES edu.past_papers(id) ON DELETE CASCADE,
  part         text,                                -- "Part A"
  title        text NOT NULL,                       -- "Mathematics"
  subject      text,                                -- normalised subject for filtering
  instructions text,
  sort_order   integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_paper_sections_paper ON edu.paper_sections (paper_id, sort_order);

-- ── Passages (one comprehension text, many questions) ────────────────────────
CREATE TABLE IF NOT EXISTS edu.paper_passages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id   uuid NOT NULL REFERENCES edu.past_papers(id) ON DELETE CASCADE,
  section_id uuid REFERENCES edu.paper_sections(id) ON DELETE CASCADE,
  label      text,                                  -- "Passage 1"
  body       text,
  image_url  text,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_paper_passages_paper ON edu.paper_passages (paper_id, sort_order);

-- ── Questions ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.past_questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id    uuid NOT NULL REFERENCES edu.past_papers(id) ON DELETE CASCADE,
  section_id  uuid REFERENCES edu.paper_sections(id) ON DELETE SET NULL,
  passage_id  uuid REFERENCES edu.paper_passages(id) ON DELETE SET NULL,
  number      integer,                              -- as printed on the paper
  type        text NOT NULL DEFAULT 'mcq'
                CHECK (type IN ('mcq', 'theory', 'practical', 'essay')),
  stem        text NOT NULL DEFAULT '',
  image_url   text,                                 -- diagram questions
  -- [{"label":"A","text":"DLXXVI","image_url":null}, …] — A-E, sometimes fewer
  options     jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer      text,                                 -- "B" for mcq, model answer otherwise
  explanation text,
  marks       numeric,
  subject     text,
  topic       text,
  difficulty  text CHECK (difficulty IS NULL OR difficulty IN ('easy', 'medium', 'hard')),
  -- Only a human-checked question should be shown as fact. Vision-parsed ones
  -- land unverified and stay out of student-facing practice until reviewed.
  verified    boolean NOT NULL DEFAULT false,
  source_page integer,
  embedding   vector(1536),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (paper_id, section_id, number)
);
CREATE INDEX IF NOT EXISTS idx_past_questions_paper   ON edu.past_questions (paper_id, number);
CREATE INDEX IF NOT EXISTS idx_past_questions_subject ON edu.past_questions (subject) WHERE subject IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_past_questions_topic   ON edu.past_questions (topic) WHERE topic IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_past_questions_verified ON edu.past_questions (verified);
CREATE INDEX IF NOT EXISTS idx_past_questions_embedding
  ON edu.past_questions USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ── Ingestion log — one row per page batch pushed through vision parsing ─────
-- The source papers are SCANNED IMAGES with no text layer, so ingestion is a
-- pipeline with failures worth keeping: what was parsed, from which pages, and
-- what went wrong.
CREATE TABLE IF NOT EXISTS edu.paper_ingests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id   uuid NOT NULL REFERENCES edu.past_papers(id) ON DELETE CASCADE,
  page_from  integer,
  page_to    integer,
  image_url  text,
  raw_text   text,
  parsed     jsonb,
  found      integer NOT NULL DEFAULT 0,
  status     text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'parsed', 'imported', 'failed')),
  error      text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_paper_ingests_paper ON edu.paper_ingests (paper_id, created_at DESC);

-- ── Semantic search ──────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS match_past_questions(vector, text, text, integer);
CREATE OR REPLACE FUNCTION match_past_questions(
  p_query_embedding vector(1536),
  p_exam            text DEFAULT NULL,
  p_subject         text DEFAULT NULL,
  p_limit           integer DEFAULT 8
)
RETURNS TABLE (
  id uuid, paper_id uuid, exam_slug text, year integer, number integer,
  stem text, options jsonb, answer text, explanation text,
  subject text, topic text, image_url text, similarity float
)
LANGUAGE sql STABLE AS $$
  SELECT q.id, q.paper_id, p.exam_slug, p.year, q.number,
         q.stem, q.options, q.answer, q.explanation,
         COALESCE(q.subject, p.subject), q.topic, q.image_url,
         1 - (q.embedding <=> p_query_embedding) AS similarity
  FROM edu.past_questions q
  JOIN edu.past_papers p ON p.id = q.paper_id
  WHERE q.embedding IS NOT NULL
    AND p.status = 'published'
    AND (p_exam    IS NULL OR p.exam_slug = p_exam)
    AND (p_subject IS NULL OR COALESCE(q.subject, p.subject) ILIKE p_subject)
  ORDER BY q.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;

GRANT USAGE ON SCHEMA edu TO authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  edu.exam_bodies, edu.past_papers, edu.paper_sections,
  edu.paper_passages, edu.past_questions, edu.paper_ingests TO authenticator;

NOTIFY pgrst, 'reload schema';
