-- =============================================================
-- 2026-agent-capabilities.sql — Admin → Agent capabilities
--
-- When each tool or feature first appeared (the first time the admin
-- catalogue saw it after a deploy), so the page can mark it "New".
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.agent_capability_seen (
  key           text PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE edu.agent_capability_seen ENABLE ROW LEVEL SECURITY;
