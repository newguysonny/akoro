-- 2026-agent-reminder-email.sql
-- Optional email channel for the study agent's scheduled reminders and
-- follow-ups (learner-approved request: "Email delivery for scheduled
-- reminders"). In-app delivery is unchanged; this only lets the learner also
-- receive an email. Defaults on (like the other notification event toggles) and
-- stays off entirely when email_enabled is false. Safe to re-run.

ALTER TABLE user_notification_preferences
  ADD COLUMN IF NOT EXISTS notify_agent_reminders BOOLEAN NOT NULL DEFAULT true;
