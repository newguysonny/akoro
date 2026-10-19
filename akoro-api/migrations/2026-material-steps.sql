-- =============================================================
-- 2026-material-steps.sql — the upload's steps in the chat (2026-10-19)
--
-- · steps: what the protégé did with an upload, step by step, as the chat
--   shows it under the upload's message — a tool row (what it did, what it
--   found, how long) and a short message per step. Code-written from what
--   each step really returned; bounded (the newest 40).
-- =============================================================

ALTER TABLE edu.material_ingests ADD COLUMN IF NOT EXISTS steps jsonb NOT NULL DEFAULT '[]'::jsonb;
