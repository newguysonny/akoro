-- ================================================================
-- Migration Patch 6 — Renderer styles + voice config per agent
-- ================================================================

-- Add render_style to teacher_profiles
-- Stores visual config extracted during agent training
ALTER TABLE edu.teacher_profiles
  ADD COLUMN IF NOT EXISTS render_style jsonb DEFAULT '{}';

-- Add tts_voice to orchestration_configs for per-agent TTS
ALTER TABLE edu.agent_orchestration_configs
  ADD COLUMN IF NOT EXISTS tts_voice text DEFAULT 'alloy'
    CHECK (tts_voice IN ('alloy','echo','fable','onyx','nova','shimmer'));

-- Add teacher_agent_id + guide_name to user_agents
-- Links student's profile to their active guide agent
ALTER TABLE public.user_agents
  ADD COLUMN IF NOT EXISTS teacher_agent_id  text    DEFAULT 'nana-sargeant',
  ADD COLUMN IF NOT EXISTS guide_name        text    DEFAULT 'NaNa Esumai',
  ADD COLUMN IF NOT EXISTS guide_emoji       text    DEFAULT '🧠',
  ADD COLUMN IF NOT EXISTS guide_render_style jsonb  DEFAULT '{}';

-- Default NaNa render style for all existing agents
UPDATE public.user_agents
SET guide_render_style = '{
  "bubbleBg":    "rgba(124,58,237,0.10)",
  "bubbleBorder":"#7C3AED",
  "labelColor":  "#7C3AED",
  "ttsVoice":    "alloy",
  "assessStyle": "gentle"
}'::jsonb
WHERE guide_render_style = '{}'::jsonb OR guide_render_style IS NULL;
