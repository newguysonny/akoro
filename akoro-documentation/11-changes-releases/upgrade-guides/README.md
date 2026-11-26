---
title: Upgrade guides
status: planned
doc_status: draft
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Upgrade guides

Upgrade guides are the step-by-step instructions for moving a client,
integration or deployment from one Akoro version to another. They differ
from [migration guides](../migrations/api-migrations.md): a migration guide
is the contract diff, while an upgrade guide is the ordered checklist —
versions to bump, configuration to change, data to migrate, and checks to
run — that gets a real system from A to B.

## Current state

**No upgrade guides exist yet, because there is nothing to upgrade
between.** The API is unversioned (`/api`), the frontends deploy
continuously from their branches, and database changes self-apply through
the [migration manifest](../migrations/database-migrations.md). Writing
guides for versions that do not exist would be fiction, so this index is
deliberately empty.

A guide will be added here when the first of these happens:

- the proposed `/api/v1` versioning is adopted (guide: unversioned →
  v1 for API clients);
- a breaking change recorded in [breaking changes](../breaking-changes.md)
  requires client action beyond the contract diff;
- a deployment-affecting change (new required environment variable,
  retired host, changed webhook path) needs an operator checklist.

## What a guide must contain

1. Who must upgrade, and who can ignore the guide.
2. Preconditions: current version/state, backups or snapshots where data
   is involved.
3. Ordered steps, each independently verifiable.
4. Configuration changes, named exactly (variable names, header names,
   paths).
5. Data steps, referencing the relevant
   [database migration](../migrations/database-migrations.md) files.
6. Verification: the requests or checks that prove the upgrade worked.
7. Rollback: how to return to the previous state, or an explicit statement
   that rollback is not supported and why.

## Index

| Guide | From → To | Status |
| --- | --- | --- |
| — | — | None published |

## Related

- [Changes and releases](../README.md)
- [Changelog](../CHANGELOG.md)
- [API migrations](../migrations/api-migrations.md)
- [Database migrations](../migrations/database-migrations.md)
