---
title: Deprecations
status: beta
doc_status: draft
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Deprecations

A deprecation is the announced phase-out of something that still works: an
endpoint, field, behaviour or host. This page holds the policy and the
register. Deprecation is a promise about the future; the
[breaking-changes register](breaking-changes.md) records the moment the old
behaviour actually stops.

## Register

**No API deprecations are in force as of 2026-11-26.** No documented
endpoint, field or behaviour has an announced removal date.

Known phase-outs outside the API contract, recorded for completeness:

| Item | State | Replacement |
| --- | --- | --- |
| Legacy API host `api.akoro.name.ng` | Redirects (301) to the canonical host; not announced for removal | `api.akoro.ng` |
| Sandbox API on the old `akoro-sandbox.onrender.com` host | Retired 2026-11-17; the old host no longer serves the sandbox | `sandbox.akoro.ng` |
| Hash-based paths (`#/…`) on the public marketing/landing pages | Superseded by clean paths; legacy hash URLs auto-upgrade | Clean paths |

These are infrastructure and website items. They are listed here so nobody
has to guess whether they were deliberate; they do not create API
obligations.

## Policy

1. **Announce before removing.** A deprecation entry is added here when the
   decision is made, not when the removal ships. The entry states: what is
   deprecated, why, the replacement, the earliest removal date, and who is
   affected.
2. **Window.** For the documented public/core API, the minimum window
   between announcement and removal is one full release cycle of the
   affected client apps, and never less than 30 days, except for security
   fixes (which are announced in the [changelog](CHANGELOG.md) as they
   ship).
3. **Signal in the product.** Where practical, deprecated behaviour is
   visible before it breaks: documentation marks the item deprecated, and
   capability statuses in the registry move to `deprecated` with the
   replacement named.
4. **Removal closes the loop.** When the window ends and the behaviour is
   removed, the removal is recorded in
   [breaking changes](breaking-changes.md) and the deprecation entry is
   marked completed with the removal date — it is not silently deleted.
5. **Agents:** a capability marked `deprecated` in the registry is still
   usable until its removal date, but new work must use the replacement.
   A capability marked `disabled` or `planned` must not be used at all.

## Entry format

```text
### <Item> — deprecated <YYYY-MM-DD>
- Status: announced | in window | completed <YYYY-MM-DD>
- Affects: <operations / clients>
- Replacement: <what to use instead>
- Earliest removal: <YYYY-MM-DD>
- Notes: <migration guide link, exceptions>
```

## Related

- [Changelog](CHANGELOG.md)
- [Breaking changes](breaking-changes.md)
- [API migrations](migrations/api-migrations.md)
- [Upgrade guides](upgrade-guides/README.md)
