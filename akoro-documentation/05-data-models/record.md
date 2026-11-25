---
title: Record model
status: implemented
doc_status: draft
tier: 1
audience: [developer, learner, agent]
last_reviewed: 2026-11-25
owners: [TBD]
---

# Record model

## What it represents

A Library record: an uploaded file, a pasted note or a saved link. Records are
owned by a learner; shared Discover records are read-only to other learners.

## Identifier

- `edu.records.id` — UUID.

## Important fields

`edu.records` includes `id`, `user_id`, `kind` (`upload|link|paste`), `name`,
`mime`, `size`, `duration`, `file_key`, `url`, `content`, `progress`,
`last_opened_at`, `preview_key`, `private`, `deleted_at`, `created_at` and
`updated_at`.

Related tables:

- `edu.record_artifacts` — generated study material and artifacts.
- `edu.record_chunks` — searchable passages and embeddings.
- `edu.record_chat_messages` — private ask/guide history.
- `edu.pdf_extraction_cache` / extraction pages — per-content extracted text.
- `edu.library_folders` / `edu.library_folder_items` — folders.
- `edu.material_ingests` — material ingestion jobs.

## Relationships

```text
learner -> edu.records -> record_chunks
                       -> record_artifacts
                       -> record_chat_messages
                       -> extraction pages
                       -> library folders
```

## Ownership and access

- Owner: `edu.records.user_id`.
- Readers: the owner; other learners only for Discover-visible, non-private
  records.
- Writers: the owner for record metadata; server jobs for previews, chunks,
  extraction and transcripts.
- Storage: `file_key` must be under the owner's prefix or an allowed shared key.

## Lifecycle

- Created (upload/link/paste) -> preview/extraction/index jobs -> searchable.
- A record without a stored file is `fileMissing`.
- Deleted records are soft-deleted; files are removed separately.

## Agent guidance

- Never use another learner's `file_key`.
- Do not ask about a record that is not searchable yet; poll extraction first.
- Do not fabricate citations; use stored pages/chunks.
- Treat learner records and ask history as private.

## Related

- [Library overview](../01-features/records/overview.md)
- [Learner model](learner.md)
- [Ask endpoint](../02-api/endpoints/records-ask.md)
