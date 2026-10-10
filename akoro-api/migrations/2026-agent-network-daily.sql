-- 2026-agent-network-daily.sql — the daily battle's subject, per learner.
-- The daily battle runs every day in one window for everyone (DAILY_BATTLE_HOUR,
-- 19:00 Lagos by default, until midnight); each learner picks its subject.
ALTER TABLE edu.agent_network_settings ADD COLUMN IF NOT EXISTS daily_subject TEXT;
