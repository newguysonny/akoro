-- First-page previews for documents (Library and Discover cards).
--
-- The card grid shows a real page instead of a file-type icon. The client
-- renders page 1 once (pdf.js already ships for the reader) and uploads the
-- JPEG here; the key is what the card fetches. Nullable: older rows fall back
-- to the icon until a document is opened once.
ALTER TABLE records ADD COLUMN IF NOT EXISTS preview_key TEXT;
