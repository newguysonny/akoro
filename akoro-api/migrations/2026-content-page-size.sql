-- =============================================================
-- 2026-content-page-size.sql
--
-- The real size of each extracted page. The parse model's boxes are
-- normalized 0-1000; with the page's width and height they map back
-- to page coordinates (PDF points for PDFs — 1/72 inch — or pixels
-- for images), e.g. to cite a region in print or line boxes up with
-- another tool's output. NULL for pages extracted before this.
-- =============================================================

ALTER TABLE edu.content_parses ADD COLUMN IF NOT EXISTS width  NUMERIC CHECK (width IS NULL OR width > 0);
ALTER TABLE edu.content_parses ADD COLUMN IF NOT EXISTS height NUMERIC CHECK (height IS NULL OR height > 0);
ALTER TABLE edu.content_parses ADD COLUMN IF NOT EXISTS unit   TEXT CHECK (unit IS NULL OR unit IN ('pt', 'px'));
