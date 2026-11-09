-- =============================================================
-- 2026-embedding-cache.sql
-- Lever 2 of the token-cost plan: a content-hash cache of embedding vectors, so
-- stable text (syllabus subtopics, knowledge chunks, repeated searches) is
-- embedded once and served from here afterwards. Keyed on sha256(provider:model
-- \n text) — the key changes when the text does (self-invalidating, plan D7) and
-- the provider/model is part of it (vectors from different models don't compare).
-- Idempotent.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.embedding_cache (
  key          text PRIMARY KEY,             -- sha256("provider:model\ntext")
  model        text NOT NULL,                -- "openai:text-embedding-3-small" etc.
  dim          int  NOT NULL,
  embedding    jsonb NOT NULL,               -- the vector, as a JSON number array
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  hits         int  NOT NULL DEFAULT 0
);

-- Pruning (future) reads by last_used_at; a stale entry is only ever a miss, never wrong.
CREATE INDEX IF NOT EXISTS idx_embedding_cache_used ON edu.embedding_cache (last_used_at DESC);
