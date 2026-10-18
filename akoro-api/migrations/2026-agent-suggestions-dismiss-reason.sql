-- =============================================================
-- 2026-agent-suggestions-dismiss-reason.sql
-- Why a learner dismissed a chat suggestion — the same taste reasons the
-- planner's proposals already keep (agent_proposals.decision_note), so one
-- inbox learns from both: not_useful | wrong_time | too_much |
-- already_doing | other. Grand Plan §7.16.8 step 1.
-- =============================================================

ALTER TABLE agent_suggestions ADD COLUMN IF NOT EXISTS dismiss_reason TEXT;
ALTER TABLE agent_suggestions ADD COLUMN IF NOT EXISTS goal_id UUID;   -- the goal created on accept (kind goal)

NOTIFY pgrst, 'reload schema';
