---
title: Changelog
status: beta
doc_status: draft
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Changelog

This file is the internal, human-readable change history for the Akoro
platform and its documentation system. It answers "what changed?" — for
impact, read the release notes and guides linked from the entries; for
required action, read [Migrations](migrations/database-migrations.md).

## How the changelog is maintained

- Entries are added under **Unreleased** as work lands, grouped as
  Added / Changed / Deprecated / Removed / Fixed / Security.
- A change that affects users or developers is not done until its changelog
  entry exists (see the documentation-change rules in the repository
  `AGENTS.md`).
- The **public** changelog is a separate stream: it is published from the
  public docs site with RSS and JSON feeds, and release entries there are
  drafted from pull requests using a PR-label workflow. That mechanism is
  specified in docs/PUBLIC-DOCS-CHANGELOG-STATUS-PLAN.md (in the repository
  `docs/` folder, outside this documentation tree). Do not copy public
  entries from this file verbatim — public entries are written for external
  readers and exclude internal routes and infrastructure detail.
- There are no numbered public API releases yet: the API is unversioned
  (`/api`, spec version `0.1.0-skeleton`), so this changelog is organised by
  date and area rather than by semantic version. When the proposed
  `/api/v1` versioning is adopted, versioned release notes will be added
  under this category.

## Unreleased

### Added

- Documentation system expansion following
  docs/PLATFORM-DOCUMENTATION-SYSTEM-PLAN.md:
  - `02-api`: [Authorization](../02-api/authorization.md),
    [Request and response schemas](../02-api/request-response-schemas.md),
    [Pagination](../02-api/pagination.md),
    [Rate limits](../02-api/rate-limits.md) and
    [Webhooks and realtime](../02-api/webhooks.md) pages, documenting the
    conventions already implemented in the API.
  - `11-changes-releases`: this changelog, the
    [breaking-changes register](breaking-changes.md), the
    [deprecations register](deprecations.md), and migration guides for
    [database](migrations/database-migrations.md) and
    [API](migrations/api-migrations.md) changes.
  - `13-examples`: worked [API examples](../13-examples/api-examples.md),
    [agent examples](../13-examples/agent-examples.md) and a
    [complete-workflows index](../13-examples/complete-workflows.md).

### Changed

- Nothing yet.

### Deprecated

- Nothing yet. See the [deprecations register](deprecations.md).

### Removed

- Nothing yet.

### Fixed

- Nothing yet.

### Security

- Nothing yet.

## Related

- [Breaking changes](breaking-changes.md)
- [Deprecations](deprecations.md)
- [Database migrations](migrations/database-migrations.md)
- [API migrations](migrations/api-migrations.md)
- [Upgrade guides](upgrade-guides/README.md)
