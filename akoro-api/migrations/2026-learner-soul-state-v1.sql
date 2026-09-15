-- ============================================================================
-- 2026-learner-soul-state-v1.sql
-- Learner-selected interaction preferences and short-lived check-ins for the
-- additive Python agent. This is not psychological profiling: values are
-- supplied/changed/cleared by the learner, contain no free text, and cannot
-- become task, notification, grading, or mastery inputs.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS edu;

CREATE TABLE IF NOT EXISTS edu.learner_soul_preferences (
  learner_id          UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  interaction_style   TEXT NOT NULL DEFAULT 'balanced' CHECK (interaction_style IN (
                        'balanced', 'collaborative', 'independent', 'socratic')),
  response_tone       TEXT NOT NULL DEFAULT 'calm' CHECK (response_tone IN (
                        'calm', 'curious', 'direct', 'celebratory')),
  challenge_level     TEXT NOT NULL DEFAULT 'adaptive' CHECK (challenge_level IN (
                        'gentle', 'adaptive', 'stretch')),
  encouragement_level TEXT NOT NULL DEFAULT 'balanced' CHECK (encouragement_level IN (
                        'minimal', 'balanced', 'frequent')),
  policy_version      TEXT NOT NULL DEFAULT 'learner-soul-v1' CHECK (char_length(policy_version) BETWEEN 1 AND 80),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A check-in is self-reported and session-bound. It expires rapidly and is
-- deliberately categorical, avoiding raw diary text, inferred mood, or an
-- enduring emotional/identity profile.
CREATE TABLE IF NOT EXISTS edu.learner_soul_checkins (
  learner_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_session_id TEXT NOT NULL CHECK (char_length(source_session_id) BETWEEN 1 AND 180),
  feeling           TEXT NOT NULL CHECK (feeling IN ('steady', 'energised', 'tired', 'stuck', 'celebrating')),
  study_context     TEXT NOT NULL DEFAULT 'unknown' CHECK (study_context IN ('unknown', 'quiet', 'distracted', 'rushed')),
  study_intent      TEXT NOT NULL DEFAULT 'practise' CHECK (study_intent IN ('explore', 'practise', 'prepare', 'recover')),
  requested_support TEXT NOT NULL DEFAULT 'none' CHECK (requested_support IN ('none', 'slower_steps', 'more_examples', 'challenge_me', 'celebrate_progress')),
  policy_version    TEXT NOT NULL DEFAULT 'learner-soul-v1' CHECK (char_length(policy_version) BETWEEN 1 AND 80),
  checked_in_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '8 hours'),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (learner_id, source_session_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_soul_checkins_active
  ON edu.learner_soul_checkins (learner_id, expires_at DESC);

-- Retain a tiny audit window for the learner's own active/recent session
-- choices. This prevents a client from turning check-ins into an unbounded
-- behavioural timeline.
CREATE OR REPLACE FUNCTION edu.trim_learner_soul_checkins()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = edu, public
AS $function$
BEGIN
  DELETE FROM edu.learner_soul_checkins
  WHERE learner_id = NEW.learner_id
    AND source_session_id IN (
      SELECT source_session_id FROM edu.learner_soul_checkins
      WHERE learner_id = NEW.learner_id
      ORDER BY checked_in_at DESC, updated_at DESC
      OFFSET 16
    );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trim_learner_soul_checkins_after_write ON edu.learner_soul_checkins;
CREATE TRIGGER trim_learner_soul_checkins_after_write
AFTER INSERT OR UPDATE ON edu.learner_soul_checkins
FOR EACH ROW EXECUTE FUNCTION edu.trim_learner_soul_checkins();

GRANT USAGE ON SCHEMA edu TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON edu.learner_soul_preferences TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON edu.learner_soul_checkins TO service_role;

NOTIFY pgrst, 'reload schema';
