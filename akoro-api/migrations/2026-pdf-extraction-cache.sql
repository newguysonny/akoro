-- =============================================================
-- 2026-pdf-extraction-cache.sql
-- Lever 5 of the token-cost plan: compile once. A PDF's vision/long-context
-- extraction is a pure function of the document bytes (+ model + hint), so store
-- the extracted artifact by content hash and reuse it on re-ingest instead of
-- paying for vision again. Keyed on sha256(scope\nmodel\nhint\nbytes), so the key
-- changes when the document or the extraction settings do. Idempotent.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.pdf_extraction_cache (
  content_key  text PRIMARY KEY,          -- sha256(scope\nmodel\nhint\nbytes)
  model        text,                       -- the extraction model used
  doc          jsonb NOT NULL,             -- the compiled, normalized artifact
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pdf_extraction_cache_used ON edu.pdf_extraction_cache (last_used_at DESC);
