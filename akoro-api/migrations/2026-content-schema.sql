-- 2026-content-schema.sql
-- Marketing / public-site content (Blog + Careers).
--
-- Lives in its OWN schema (`content`) so it never mixes with the core app
-- (`public`) tables. Safe to re-run.
--
-- ⚠️  PostgREST / supabase-js access:
--     For the API (supabase-js) to read/write this schema, `content` must be
--     added to the project's "Exposed schemas" list:
--       Supabase Dashboard → Settings → API → Exposed schemas → add `content`
--     (or set PGRST_DB_SCHEMAS / db-schemas to include it). The service-role
--     key the API uses then has full access.

CREATE SCHEMA IF NOT EXISTS content;

-- ─── Blog ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content.blog_posts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug         TEXT NOT NULL UNIQUE,
    title        TEXT NOT NULL,
    excerpt      TEXT,
    category     TEXT NOT NULL,
    image        TEXT,                                   -- cover image URL
    author       TEXT NOT NULL,
    author_role  TEXT,
    read_min     INT  NOT NULL DEFAULT 5,
    body         JSONB NOT NULL DEFAULT '[]'::jsonb,     -- ordered block array
    featured     BOOLEAN NOT NULL DEFAULT FALSE,
    status       TEXT NOT NULL DEFAULT 'draft'           -- draft | published | archived
                 CHECK (status IN ('draft','published','archived')),
    published_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_status    ON content.blog_posts (status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_category  ON content.blog_posts (category);
CREATE INDEX IF NOT EXISTS idx_blog_posts_featured  ON content.blog_posts (featured) WHERE featured;

CREATE TABLE IF NOT EXISTS content.blog_subscribers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT NOT NULL UNIQUE,
    source      TEXT DEFAULT 'blog',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Careers ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content.job_departments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    color       TEXT,
    sort        INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content.jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID REFERENCES content.job_departments(id) ON DELETE SET NULL,
    title         TEXT NOT NULL,
    location      TEXT,
    type          TEXT DEFAULT 'Full-time',              -- Full-time | Part-time | Contract | Internship
    summary       TEXT,
    description   TEXT,                                   -- long markdown/plain description
    status        TEXT NOT NULL DEFAULT 'open'            -- open | closed
                  CHECK (status IN ('open','closed')),
    posted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON content.jobs (status, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_dept   ON content.jobs (department_id);

CREATE TABLE IF NOT EXISTS content.job_applications (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id       UUID REFERENCES content.jobs(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    email        TEXT NOT NULL,
    phone        TEXT,
    linkedin     TEXT,
    portfolio    TEXT,
    message      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_apps_job ON content.job_applications (job_id, created_at DESC);

-- ─── updated_at trigger ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION content.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_blog_posts_touch ON content.blog_posts;
CREATE TRIGGER trg_blog_posts_touch BEFORE UPDATE ON content.blog_posts
    FOR EACH ROW EXECUTE FUNCTION content.touch_updated_at();

DROP TRIGGER IF EXISTS trg_jobs_touch ON content.jobs;
CREATE TRIGGER trg_jobs_touch BEFORE UPDATE ON content.jobs
    FOR EACH ROW EXECUTE FUNCTION content.touch_updated_at();
