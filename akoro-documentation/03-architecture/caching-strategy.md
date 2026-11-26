---
title: Caching strategy
status: beta
doc_status: draft
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Caching strategy

## Purpose

Akoro has no general response-cache layer, and this page records that
honestly. Caching exists in four specific places, each chosen because the
uncached cost was measured: provider embeddings, the learner app's static
bundle, runtime registries refreshed on a timer, and HTTP compression.
Redis is present in the stack but is not used as an API response cache.

## Boundaries

| Cache | Key | Store | Invalidation |
| --- | --- | --- | --- |
| Embedding cache | SHA-256 of provider + model + text | Postgres, `edu.embedding_cache` | Self-invalidating: the key is the content hash, so edited text is a different key |
| Learner app bundle | URL | Browser service worker precache | New deploy's service worker; the app can auto-reload onto it |
| Data View registry | View name | In-process memory | Re-read from `edu.self_tool_views` every 60 s; fail-open (a failed refresh keeps the current registry) |
| Model runtime settings | Setting key | In-process, loaded at boot from `edu.ai_runtime_settings` | Restart / runtime reload path in `lib/modelRuntime.js` |

## Diagram

```text
embed(text) -> hash(provider, model, text) -> edu.embedding_cache?
                 hit:  return stored vector (last_used_at touched)
                 miss: call provider, store best-effort, return vector

admin approves a Data View -> row active in edu.self_tool_views
                 -> within 60 s the in-process registry merges it
                 -> disabling the row removes it on the next refresh
```

## Request/event flow

The embedding cache is the model for the others: reads and writes are
best-effort and never throw into the caller — a cache that can break an
embed is worse than none. Stable text (syllabus subtopics, knowledge
chunks, repeated searches) is embedded once instead of per use, and the
vectors survive restarts because the store is Postgres, not process
memory.

## Data and storage

Cached embeddings are derived data: the source text remains the truth,
and any row can be deleted and recomputed. `last_used_at` is maintained
to support future pruning; no pruning job is documented yet.

## Dependencies

Postgres (embedding cache, view registry source, runtime settings),
the browser service worker (bundle), Express compression middleware for
response encoding.

## Failure modes

- A stale service worker is the sharpest edge: after a deploy the
  precache can look current while a non-precached chunk is stale, so
  deploy verification walks the entry chunk's import graph instead of
  trusting the precache list.
- Registry refresh failure leaves the previous in-process state in place;
  built-in views are code and are never removed by a refresh.

## Security and permissions

The embedding cache key includes provider and model so vectors from
different models never mix. Cached content inherits the access rules of
its source: the cache is below the authorisation layer, never a way
around it — a cache hit is only ever returned inside a request that
already passed ownership checks.

## Invariants

- No cache sits in front of an authorisation decision.
- Every cache must fail open to the uncached path.
- Content-derived keys (hashes) are preferred over identity keys, so
  invalidation is structural rather than remembered.

## Observability

Embedding cache behaviour is observable through provider-call metering:
a working cache shows up as fewer embedding calls for repeated text.
There is no cache hit-rate dashboard yet.

## Related

- [Database architecture](database-architecture.md)
- [Model routing](model-routing.md)
- [Frontend architecture](frontend-architecture.md)
