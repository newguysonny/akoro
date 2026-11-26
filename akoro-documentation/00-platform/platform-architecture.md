---
title: Platform architecture
doc_status: draft
audience: [developer, product, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Platform architecture

High-level architecture of Akoro: how the applications, the API, the learning
workflows and the agent runtime connect. This is a summary; detail lives in
[Architecture](../03-architecture/README.md).

## Shape

Akoro is a monorepo with four web applications backed by one API
(`akoro-api`, Node/Express) and one PostgreSQL database organised into three
schemas: `public` (identity, courses, schools), `edu` (learning, agent and
library data) and `mgmt` (the school ERP). See
[Data architecture](../05-data-models/data-architecture.md).

```text
Learner app ─┐
Instructor app ─┤
School app ─────┼──> akoro-api (modules by domain)
Admin app ───┘         │
                       ├── PostgreSQL (public / edu / mgmt)
                       ├── Object storage (record files, previews, media)
                       ├── Extraction worker (document/OCR pipeline)
                       └── AI providers (model routing, per-role settings)
```

## Backend modules

The API is organised as domain modules under `akoro-api/modules/`, including
`adaptive-learning`, `teaching`, `battle`, `self-study`, `communities`,
`agent-network`, `self-tooling`, `materials`, `records`, `courses`,
`school`, `billing`, `wallet`, `vouchers` and `verify` (the verification
gate). A module owns its routes and its tables; cross-module effects go
through documented services, not direct table writes from another module's
request handlers.

## The learning runtime

The centre of the platform is the learning runtime described in the Grand
Plan (`reference/Grand Plan.md`):

```text
WORKFLOW ENGINE (instances, lifecycle, outcomes)
  Study Prep · Teaching · Decay Review · Practice
        │
ADAPTIVE LEARNING ENGINE (evidence, strategy, mastery, retention)
        │
AGENT RUNTIME ── Context Manager ── LLM ── Harness
        │            (permissions, schema, budget, caps, idempotency)
TOOLS ── EDUCATION ENGINE (score, threshold, evidence, mastery)
        │
LEARNER MODEL        every step ──> EVENT STORE
        │
Socket.IO / SSE / replay ──> learner, instructor and admin UIs
```

The split of authority is strict: the agent proposes one action at a time,
the harness decides whether it is allowed and performs it, the deterministic
Education Engine scores and records evidence, and workflow state lives in
the database and is changed only by code.

## Transport and events

- REST for CRUD and catalogue surfaces.
- Socket.IO / SSE for live learning sessions and streamed agent turns.
  Transport is never business logic and never the workflow itself.
- Every significant workflow step emits a structured event that is stored,
  replayable, and rendered in the UI as activity.

## Boundaries

- Frontends never talk to the database or to AI providers directly.
- Answer keys and scoring stay server-side.
- School ERP data is isolated by `school_id` on every `mgmt` table.
- Learner Library and memory data is owner-scoped by user id.

## Related

- [Platform overview](platform-overview.md)
- [Platform ecosystem](platform-ecosystem.md)
- [Data architecture](../05-data-models/data-architecture.md)
- [Learning and assessment](../01-features/learning/overview.md)
