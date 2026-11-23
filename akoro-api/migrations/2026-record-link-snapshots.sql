-- Links are readable, not just bookmarks: a saved URL gets a safe snapshot of
-- its main text (and metadata) so the shared reader, Generate tools, Ask and
-- search work on the page exactly as they do on a pasted document.
ALTER TABLE edu.records ADD COLUMN IF NOT EXISTS link_status TEXT
  CHECK (link_status IS NULL OR link_status IN ('fetching', 'ready', 'failed'));
ALTER TABLE edu.records ADD COLUMN IF NOT EXISTS link_title TEXT;
ALTER TABLE edu.records ADD COLUMN IF NOT EXISTS link_description TEXT;
ALTER TABLE edu.records ADD COLUMN IF NOT EXISTS link_image TEXT;
ALTER TABLE edu.records ADD COLUMN IF NOT EXISTS link_error TEXT;
ALTER TABLE edu.records ADD COLUMN IF NOT EXISTS link_fetched_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS records_link_status_idx
  ON edu.records(link_status) WHERE link_status = 'fetching';
