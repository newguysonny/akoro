---
title: Breaking changes
status: beta
doc_status: draft
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Breaking changes

A breaking change is any change after which previously working client
behaviour is no longer supported: a removed or renamed endpoint or field, a
narrowed enum, a changed error contract, a new required parameter, or a
tightened permission. This page is the register of such changes for the
Akoro API, plus the policy that governs them.

## Register

**The register is empty as of 2026-11-26.** No breaking change to the
public/core API documented in [02-api](../02-api/README.md) has been
recorded. That is a statement about the record, not a promise that internal
routes never changed — internal, admin, school-ERP, agent-console and
verification routes are outside the public contract and may change without
an entry here.

Two things that are **not** API breaking changes, recorded so they are not
mis-filed here later:

- Legacy API hostnames redirect to the canonical host
  (`api.akoro.name.ng` → `api.akoro.ng`). Redirects are infrastructure;
  clients that follow redirects and use the canonical host are unaffected.
- The public docs and apps have moved between hosts and URL schemes over
  time (for example clean paths replacing hash-based paths on marketing
  pages). Those are website changes, not API contract changes.

## Policy

1. **Avoid breaking the documented surface.** Prefer additive changes: new
   optional fields, new endpoints, wider enums handled defensively by
   clients.
2. **A breaking change requires three artefacts before it ships:** an entry
   in this register, a migration guide under
   [migrations](migrations/api-migrations.md), and a deprecation window in
   the [deprecations register](deprecations.md) — unless the change is a
   security fix, in which case the entry and guide follow immediately
   after.
3. **Announce in the [changelog](CHANGELOG.md)** under a `Changed` or
   `Removed` heading that links the register entry.
4. **Versioning:** the API is currently unversioned. The proposed
   `/api/v1` scheme (see [API migrations](migrations/api-migrations.md))
   exists precisely so a future breaking change can ship as a new version
   instead of breaking existing clients in place. Until versioning is
   adopted, in-place breaking changes need explicit owner approval recorded
   in the register entry.
5. **Register entry format:** date, affected operations, what breaks, who
   is affected, the replacement, the migration guide link, and the
   deprecation window's start and end dates.

## What counts, with examples

| Change | Breaking? |
| --- | --- |
| Add an optional response field | No |
| Add a new endpoint | No |
| Remove a response field clients may read | Yes |
| Rename a field (even keeping the old one briefly) | Yes, when the old name goes |
| Make an optional request field required | Yes |
| Change an error body shape for a documented status | Yes |
| Tighten an ownership/role check so previously allowed calls fail | Yes |
| Raise a rate limit | No |
| Lower a rate limit materially | Not a contract break, but record it in the [changelog](CHANGELOG.md) |

## Related

- [Changelog](CHANGELOG.md)
- [Deprecations](deprecations.md)
- [API migrations](migrations/api-migrations.md)
- [Upgrade guides](upgrade-guides/README.md)
