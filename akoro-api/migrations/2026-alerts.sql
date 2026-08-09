-- =============================================================
-- 2026-alerts.sql
-- Alert state, so an alert is an EVENT rather than a repeated observation.
--
-- The dashboard already answers "what is happening"; it only answers it while
-- someone is looking. Alerting is the other half — but a check that fires a
-- message every time it runs is not alerting, it is a metronome, and the first
-- thing anyone does with a metronome is mute it.
--
-- So the rule's condition and its STATE are different things. A rule is
-- breaching or it is not; a transition between those is worth telling someone
-- about, and the fifty evaluations in between are not.
--
-- The rules themselves live in code (lib/alerts.js), not here: they are logic,
-- they want reviewing in a diff, and a threshold that can be edited in a table
-- with no record of who changed it is how alerting quietly stops working.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.alert_state (
  rule_key      TEXT PRIMARY KEY,          -- matches a rule id in lib/alerts.js
  firing        BOOLEAN NOT NULL DEFAULT false,
  since         TIMESTAMPTZ,               -- when it STARTED firing
  last_checked  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_notified TIMESTAMPTZ,               -- for the re-notify interval
  last_value    NUMERIC,                   -- what it was measured at
  last_detail   TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The history: one row per transition, not per check.
CREATE TABLE IF NOT EXISTS edu.alert_events (
  id         BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rule_key   TEXT NOT NULL,
  severity   TEXT NOT NULL,                -- warning | critical
  kind       TEXT NOT NULL,                -- fired | resolved | reminder
  value      NUMERIC,
  detail     TEXT,
  notified   BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_alert_events_time ON edu.alert_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_rule ON edu.alert_events (rule_key, created_at DESC);

COMMENT ON TABLE edu.alert_state  IS 'Current firing state per rule — one row per rule, updated in place.';
COMMENT ON TABLE edu.alert_events IS 'Transitions only (fired/resolved/reminder), never one row per evaluation.';

-- Verify:
--   SELECT rule_key, firing, since, last_value FROM edu.alert_state ORDER BY firing DESC;
--   SELECT * FROM edu.alert_events ORDER BY created_at DESC LIMIT 20;
