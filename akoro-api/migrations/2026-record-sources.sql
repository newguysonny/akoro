-- =============================================================
-- 2026-record-sources.sql — gathered content provenance (2026-11-16)
-- A record the agent wrote by gathering several Discover free notes into
-- one text (a "gathered content") remembers where each part came from:
-- sources = [{ marker, recordId, name, ownerName, contentKey, kind }] —
-- the citation map the reader uses to open the ORIGINAL source from a
-- citation and come back. Null on every ordinary record.
-- =============================================================

ALTER TABLE edu.records ADD COLUMN IF NOT EXISTS sources jsonb;
