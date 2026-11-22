-- Chunk provenance + versioning (2026-11-22).
--
-- H1/H2/H3 of the retrieval plan: chunks now carry the section they came from,
-- their character span, a normalised text hash (dedupe + embedding reuse) and
-- the chunker/index version that produced them. Existing rows keep
-- index_version = 0 and are repaired by a bounded reindex, not a blocking
-- migration.
alter table edu.record_chunks add column if not exists section_path text;
alter table edu.record_chunks add column if not exists char_start integer;
alter table edu.record_chunks add column if not exists char_end integer;
alter table edu.record_chunks add column if not exists content_hash text;
alter table edu.record_chunks add column if not exists index_version integer not null default 0;
alter table edu.record_chunks add column if not exists source_type text;
alter table edu.record_chunks add column if not exists doc_at timestamptz;
alter table edu.record_chunks add column if not exists extract_version text;
alter table edu.record_chunks add column if not exists embed_model text;

create index if not exists idx_record_chunks_hash
  on edu.record_chunks (user_id, content_hash) where content_hash is not null;
create index if not exists idx_record_chunks_version
  on edu.record_chunks (index_version);

comment on column edu.record_chunks.section_path is
  'Markdown heading path (H1 > H2 > H3) the chunk came from, when the source had one.';
comment on column edu.record_chunks.content_hash is
  'SHA-256 of normalised chunk text: exact-duplicate suppression and embedding reuse.';
comment on column edu.record_chunks.index_version is
  'Chunker/index bundle that wrote the row; stale rows are re-chunked in bounded sweeps.';
