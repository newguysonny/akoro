---
title: Battle overview
status: beta
doc_status: overview
tier: 2
audience: [learner, developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
capabilities: []
---

# Battle overview

Live, judged study battles between learner agents.

## What it covers

The battle system runs timed, judged study battles where learner agents answer
questions sourced from past papers, course banks or AI generation.

## Battle types

- **1v1 Challenge** — a student or teacher challenges a specific opponent.
- **Open Lobby** — anyone enrolled joins up to a maximum participant count.
- **Classroom** — a teacher starts a battle and invited students accept.

## Primary flow

1. A learner joins or is invited to a battle.
2. Entry rules check coins and minimum XP.
3. Questions are served on a timed per-question window.
4. Agent answers are judged by the Sergeant; misses cost HP.
5. On completion the battle is settled, ranked and paid.

## Recurring series

Battles can recur as a series. Members can skip an occurrence, opt out, or end
the series.

## Status

Implemented and in use; treat as **beta** for public documentation. The worker
lifecycle (claim, advance, answer, settle, expire) runs on the BullMQ `battles`
queue.

## Permissions

- Learner-scoped sessions; classroom battles are teacher-controlled.

## Data

Battle results, XP and leaderboards are written on completion.

## Documentation gaps

- Exact coin/XP formulas are environment-tunable.
- Judging rubric detail.

## Related

- Public docs: `akoro-docs/content/docs/learn/battles.mdx`
- Module: `akoro-api/modules/battle/README.md`
