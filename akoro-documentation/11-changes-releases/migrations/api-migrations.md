---
title: API migrations
status: beta
doc_status: draft
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# API migrations

An API migration guide tells a client developer exactly what to change to
move from an old contract to a new one. This page states the current
versioning position and the rules every future migration must follow. There
are no completed API migrations to document yet — the register below is
empty because the API has never shipped a versioned break.

## Current position

- The live API is **unversioned**: base path `https://api.akoro.ng/api`
  (sandbox: `https://sandbox.akoro.ng/api`), contract in
  [OpenAPI](../../02-api/openapi.yaml), spec version `0.1.0-skeleton`.
- Canonical **`/api/v1` versioning is proposed, not implemented**.
  **Decision (2026-11-26, Matt): keep the API unversioned for now.** There
  are no external API consumers yet, and the deprecation rules below work
  without a version prefix; `/api/v1` stays a documented proposal to revisit
  if external consumers arrive. Clients integrate against `/api` and this
  documentation set describes that surface.
- Because there is no v1, there is nothing to migrate *to* yet. If the
  versioning decision is ever reversed, the first migration guide (from
  unversioned `/api` to `/api/v1`) will be written here before any client is
  asked to move.

## Rules for any future migration

1. **Guide before break.** No breaking change ships without a migration
   guide in this folder and an entry in
   [breaking changes](../breaking-changes.md).
2. **Deprecation window first.** The old behaviour is announced in
   [deprecations](../deprecations.md) with an earliest removal date before
   the new contract becomes mandatory.
3. **A guide is a diff, not a description.** Each guide lists, per affected
   operation: the old request/response, the new request/response, the field
   or behaviour mapping, and the exact client code changes. Prose-only
   guides do not pass review.
4. **Both sides run during the window.** Where the change is versioned, the
   old and new versions are served concurrently for the whole window;
   where it is not, the change must be backward-compatible until the
   window closes.
5. **Examples are re-validated.** Every example in
   [13-examples](../../13-examples/api-examples.md) that touches a migrated
   operation is updated and checked against the new schema in the same
   change.
6. **Agents follow the same guides.** An agent must not translate between
   contract versions from memory; it reads the guide for the pair of
   versions it is bridging.

## Non-contract moves that are not API migrations

- Host changes behind redirects (legacy host → `api.akoro.ng`) need no
  guide; clients should use the canonical host.
- Host *retirements* without a redirect (the old sandbox host) are
  announced in [deprecations](../deprecations.md) with the replacement
  host named.
- Internal routes (admin, agent-console, verification, scheduler ticks)
  are not public contract and change without migration guides.

## Register of migration guides

| From | To | Guide | Status |
| --- | --- | --- | --- |
| — | — | None yet | The `/api/v1` decision is open |

## Related

- [Changelog](../CHANGELOG.md)
- [Breaking changes](../breaking-changes.md)
- [Deprecations](../deprecations.md)
- [Database migrations](database-migrations.md)
- [Upgrade guides](../upgrade-guides/README.md)
