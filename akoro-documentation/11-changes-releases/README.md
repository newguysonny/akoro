# Changes and releases

Changelog, release notes, breaking changes, deprecations, database migrations, API migrations and upgrade guides.

Status: Phase 2 in progress. The registers and guides below are live
documents: the changelog is maintained as work lands, and the breaking-change
and deprecation registers are currently empty by record (see the pages
themselves for what that does and does not claim). There are no versioned API
releases yet — the API is unversioned — so there are no per-version release
notes or upgrade guides; the upgrade-guides index explains when the first one
will be written.

## Files

| File | Purpose |
| --- | --- |
| [CHANGELOG.md](CHANGELOG.md) | What changed, by date and area; how the public changelog stream works |
| [breaking-changes.md](breaking-changes.md) | Register of contract breaks (empty as of 2026-11-26) and the policy governing them |
| [deprecations.md](deprecations.md) | Deprecation policy and register |
| [migrations/database-migrations.md](migrations/database-migrations.md) | The manifest-driven, idempotent database migration discipline |
| [migrations/api-migrations.md](migrations/api-migrations.md) | API versioning position and migration-guide rules |
| [upgrade-guides/README.md](upgrade-guides/README.md) | Upgrade guide index (none published yet) |

## Rules

- Changelog answers what changed; release notes explain impact; migration guides explain required changes.
- Use the templates in `_templates/`.
- Declare status and ownership.
- Link capabilities, API operations, data models and workflows where relevant.
- A breaking change needs a register entry, a deprecation window and a migration guide before it ships — see [breaking-changes.md](breaking-changes.md).
