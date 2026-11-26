---
title: Roadmap summary
doc_status: draft
audience: [developer, product, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Roadmap summary

Where Akoro is heading, in the terms the project itself uses. This page
summarises direction; it is not a commitment list and it declares no dates.
Availability of anything named here is decided by
`capability-registry.yaml` and the code — never by this page. Detailed
direction lives in [Roadmap](../12-roadmap/README.md) and the Grand Plan
(`reference/Grand Plan.md`).

## The central programme: one runtime, four workflows

The Grand Plan's direction is to run four durable learning workflows —
Study Prep, Teaching, Decay Review and Practice — on one shared agent
runtime, with a deterministic Education Engine underneath. Its
implementation phases (section 17) run from workflow infrastructure,
agent-runtime generalisation, the event stream and Context Manager wiring,
through completion of each workflow, learner-model unification and UI, to
hardening and production readiness. Later phases extend the same runtime:
the proactive agent (suggestions, ideas, goal work, quiet learning),
materials-to-study ingestion, endpoint and security audit follow-ups,
agent-chat planning/recovery/measurement, session plugins (learner-made
teaching recipes), autonomous agent-to-agent messages, and a durable
execution trace with crash recovery.

## Documentation programme

This repository is itself on the plan in
`docs/PLATFORM-DOCUMENTATION-SYSTEM-PLAN.md`: foundation and Tier-1 API
documentation are in place; Tier-2/3 feature, learning-methodology and
data-model documentation is being populated category by category. Public
documentation is an allow-listed subset of this repository.

## Known open decisions

These are recorded as open in the platform overview and the Grand Plan;
they are decisions for the product owner, not defaults an agent may pick:

- The approved `/api/v1` policy (versioning and deprecation window).
- Whether the school ERP is partner-facing in the first public release.
- Which capabilities are public versus internal.
- Per-domain documentation ownership.
- Open items carried in the Grand Plan, including the Phase 12 security
  follow-ups it records.

## How to read this page

- A phase named here may be partly shipped; several Grand Plan phases are
  marked done or in progress in the plan itself.
- "Planned" in the status vocabulary means not available; agents must not
  use a planned capability.
- When this page and the code disagree, the code and the capability
  registry win, and the disagreement should be reported.

## Related

- [Platform overview](platform-overview.md)
- [Product principles](product-principles.md)
- [Roadmap](../12-roadmap/README.md)
