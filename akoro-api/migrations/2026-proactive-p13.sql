-- =============================================================
-- 2026-proactive-p13.sql — Grand Plan §7.16.8 steps 4–8 (D46–D49)
--
-- · Consents, one per part (§7.16.7): proactive (suggestions & ideas; NULL =
--   follow the old level, 2 = on), checkins (due-task check-ins), with
--   learn_from_chats already there. Quiet hours and the time zone are the
--   learner's own (Lagos 20:00–07:30 by default).
-- · autonomy_runs.cost_usd: what a run cost, for the weekly USD budget.
-- · agent_proposals: the new kinds (ready proposals, goal work, instructor),
--   the prepared preview, and the message that reported the result.
-- · agent_ideas: the Ideas list (§7.16.4) — buildable briefs, ≤ 6 live, 7 days.
-- =============================================================

ALTER TABLE edu.learner_agent_autonomy ADD COLUMN IF NOT EXISTS proactive   boolean;
ALTER TABLE edu.learner_agent_autonomy ADD COLUMN IF NOT EXISTS checkins    boolean NOT NULL DEFAULT true;
ALTER TABLE edu.learner_agent_autonomy ADD COLUMN IF NOT EXISTS quiet_start text NOT NULL DEFAULT '20:00';
ALTER TABLE edu.learner_agent_autonomy ADD COLUMN IF NOT EXISTS quiet_end   text NOT NULL DEFAULT '07:30';
ALTER TABLE edu.learner_agent_autonomy ADD COLUMN IF NOT EXISTS time_zone   text;
ALTER TABLE edu.learner_agent_autonomy ADD COLUMN IF NOT EXISTS budget_alerted_at timestamptz;

ALTER TABLE edu.autonomy_runs ADD COLUMN IF NOT EXISTS cost_usd numeric(12, 8);
CREATE INDEX IF NOT EXISTS idx_ai_call_log_ref ON edu.ai_call_log(ref, created_at) WHERE ref IS NOT NULL;

DO $kinds$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'edu.agent_proposals'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE edu.agent_proposals DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $kinds$;
ALTER TABLE edu.agent_proposals ADD CONSTRAINT agent_proposals_kind_check CHECK (kind IN (
  'task','session','goal','practice','battle','plan_digest',
  'quiz_from_records','teach_weak_topic','study_plan','revision_battle','follow_up_question','fix_it',
  'goal_nudge','revise_low_scores','chase_missing','next_activity'));
ALTER TABLE edu.agent_proposals ADD COLUMN IF NOT EXISTS preview jsonb;
ALTER TABLE edu.agent_proposals ADD COLUMN IF NOT EXISTS report_message_id uuid;

CREATE TABLE IF NOT EXISTS edu.agent_ideas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  why         text,
  context     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { kind: record|goal|weak_topic|chat, label, ref }
  brief       text NOT NULL,                       -- what "Do it" sends as the learner's message
  icon        text,
  status      text NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'used', 'dismissed', 'expired')),
  run_id      uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  decided_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_agent_ideas_user ON edu.agent_ideas(user_id, status, created_at DESC);

NOTIFY pgrst, 'reload schema';
