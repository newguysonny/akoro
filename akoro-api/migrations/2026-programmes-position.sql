-- 2026-programmes-position.sql
-- Adds position column to programmes for drag-to-reorder.
-- Safe to re-run.

ALTER TABLE programmes ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0;
