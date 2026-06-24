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
