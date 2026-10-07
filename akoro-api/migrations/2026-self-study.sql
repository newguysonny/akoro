-- =============================================================
-- 2026-self-study.sql
-- AI Self Study — a teacher (or school) assigns a topic for learners to work
-- through with their own AI agent, individually or as a whole class.
--
-- The assignment is only the BRIEF: subject, topic, subtopics and objectives,
-- exactly the shape POST /api/adaptive/teaching/configure already produces. The
-- actual learning still happens in edu.adaptive_sessions — one session per
-- learner, created the moment they start — so every existing surface (the
-- Sessions list, knowledge confidence, decay/revision) picks it up for free.
-- self_study_targets is the join that remembers who was assigned what, and
-- which session came out of it.
--
-- Idempotent: guarded creates, and a DO block for the status CHECK so a rerun
-- can never narrow an existing constraint.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.self_study_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  school_id     UUID REFERENCES public.school_profiles(id) ON DELETE SET NULL,
  course_id     UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  classroom_id  UUID REFERENCES public.classrooms(id) ON DELETE SET NULL,

  title         TEXT NOT NULL,
  subject       TEXT NOT NULL,
  topic         TEXT NOT NULL,
  subtopics     JSONB NOT NULL DEFAULT '[]',   -- ["Cell structure", …]
  objectives    JSONB NOT NULL DEFAULT '{}',   -- { "Cell structure": ["…", "…"] }
  instructions  TEXT,                          -- teacher's note to the learner
  difficulty    TEXT NOT NULL DEFAULT 'intermediate',

  due_at        TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edu.self_study_targets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id  UUID NOT NULL REFERENCES edu.self_study_assignments(id) ON DELETE CASCADE,
  student_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- The learner's adaptive session, once they start. ON DELETE SET NULL so
  -- clearing session history never destroys the assignment record.
  session_id     UUID REFERENCES edu.adaptive_sessions(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'assigned',
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_self_study_creator ON edu.self_study_assignments(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_self_study_school  ON edu.self_study_assignments(school_id);
CREATE INDEX IF NOT EXISTS idx_self_study_target_student
  ON edu.self_study_targets(student_id, status);
CREATE INDEX IF NOT EXISTS idx_self_study_target_assignment
  ON edu.self_study_targets(assignment_id);

-- ── CHECK constraints, built from the UNION of known and existing values ─────
-- Every migration re-runs on every deploy. Rebuilding a CHECK from a hardcoded
-- list would reject rows written by a newer version of the app, so the allowed
-- set is always (what this file knows) ∪ (what the table already contains).
DO $$
DECLARE v_vals text[];
BEGIN
  SELECT array_agg(DISTINCT s ORDER BY s) INTO v_vals
  FROM (SELECT unnest(ARRAY['draft','active','archived']) AS s
        UNION SELECT DISTINCT status FROM edu.self_study_assignments WHERE status IS NOT NULL) t;

  ALTER TABLE edu.self_study_assignments DROP CONSTRAINT IF EXISTS self_study_assignments_status_check;
  EXECUTE format(
    'ALTER TABLE edu.self_study_assignments ADD CONSTRAINT self_study_assignments_status_check CHECK (status = ANY (%L))',
    v_vals);

  SELECT array_agg(DISTINCT s ORDER BY s) INTO v_vals
  FROM (SELECT unnest(ARRAY['assigned','started','complete']) AS s
        UNION SELECT DISTINCT status FROM edu.self_study_targets WHERE status IS NOT NULL) t;

  ALTER TABLE edu.self_study_targets DROP CONSTRAINT IF EXISTS self_study_targets_status_check;
  EXECUTE format(
    'ALTER TABLE edu.self_study_targets ADD CONSTRAINT self_study_targets_status_check CHECK (status = ANY (%L))',
    v_vals);
END $$;

-- PostgREST needs the edu schema exposed; 2026-expose-edu-schema.sql does that
-- globally, so nothing extra is required here.
GRANT USAGE ON SCHEMA edu TO anon, authenticated, service_role;
GRANT ALL ON edu.self_study_assignments TO anon, authenticated, service_role;
GRANT ALL ON edu.self_study_targets     TO anon, authenticated, service_role;
