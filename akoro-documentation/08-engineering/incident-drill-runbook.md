---
title: Incident drill runbook
status: beta
doc_status: draft
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Incident drill runbook

## Purpose

The public-docs plan requires the status system to be proven, not just wired:
monitors watching the real surfaces, and one full incident drill executed
against the status page before the system counts as live. This runbook is the
executable procedure for that drill. Running it needs access to the status
provider account (Instatus, behind the `/status` redirect on the public docs
site); the account holder runs the provider-side steps.

## What exists today

- `docs.akoro.ng/status` redirects to the managed status page.
- API health endpoints report build identity: `GET /health` on the sandbox
  and production APIs returns the deployed git SHA.
- The sandbox verify gate can run the regression suite on demand and returns
  per-scenario verdicts (PASS / FAIL / ERROR are distinct outcomes).

What does not exist yet: provider-side monitors (nothing pages anyone when a
surface goes down) and a completed drill. Both are closed by this runbook.

## Monitor setup (one-time, provider account)

Create one monitor per surface, checking every 5 minutes from at least two
regions:

| Surface | Check | Healthy |
| --- | --- | --- |
| Learner app | `https://app.akoro.ng` | HTTP 200 |
| Production API | `https://api.akoro.ng/health` | HTTP 200, body reports a git SHA |
| Sandbox API | `https://sandbox.akoro.ng/health` | HTTP 200, body reports a git SHA |
| Public docs | `https://docs.akoro.ng/docs` | HTTP 200 |
| Admin app | `https://admin.akoro.ng` | HTTP 200 |

Wire each monitor to a status-page component of the same name, so a failing
monitor degrades the component automatically.

## The drill (target: under 30 minutes)

1. **Announce.** Note the drill start time (WAT) in the team channel. A drill
   is labelled as a drill on the status page from the first update — never
   present a drill as a real outage.
2. **Open.** On the status page, create an incident titled
   `[DRILL] Simulated API degradation`, set the Production API component to
   "Degraded performance", and post the first update.
3. **Verify publication.** From a private browsing window, open
   `docs.akoro.ng/status` and confirm the incident and component state are
   visible. Record the elapsed time from creation to public visibility.
4. **Update.** Post a second update ("investigating") after ~5 minutes and
   confirm it appears publicly.
5. **Cross-check reality.** While the drill incident is open, confirm the
   real surfaces are healthy: `GET https://api.akoro.ng/health` returns 200
   and the sandbox verify smoke (health scenario) passes. A drill must never
   mask a real failure — if a real check fails, stop the drill and treat it
   as a real incident.
6. **Resolve.** Mark the incident resolved, return the component to
   "Operational", and confirm the public page shows the resolution and the
   full timeline.
7. **Record.** File the drill report (template below) under
   `docs/audits/` in the monorepo, and note the completion in
   `11-changes-releases/CHANGELOG.md` under Unreleased.

## Drill report template

```text
Date / window (WAT):
Run by:
Time to publish first update:
Time to publish resolution:
Public visibility confirmed from: (device/network)
Real-surface cross-checks during drill: PASS / FAIL (detail)
Issues found:
Follow-ups opened:
```

## Pass criteria

- Incident and both updates visible publicly within 2 minutes each.
- Component state changes reflected on the public page.
- Real-surface cross-checks all healthy for the whole drill.
- Report filed. Any missed criterion is a follow-up, not a silent pass.

## Related

- [Observability](observability.md)
- [Deployment guide](deployment-guide.md)
- [Changes and releases](../11-changes-releases/README.md)
