---
title: Planned features
status: planned
doc_status: draft
audience: [product, partner, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---
# Planned features

Work the Grand Plan (`reference/Grand Plan.md`) commits to but which is
**not available today**. Everything on this page has status `planned`:
agents must not use these capabilities, and product surfaces must not
present them as available. When an item ships, it leaves this page, gains a
feature document, and is declared in `capability-registry.yaml` with a
verification status earned from live runs.

## Completing the shared platform (Grand Plan §7, §17)

- **Workflow Engine generalisation** — the shared engine under all four
  workflows, replacing per-workflow plumbing (Phase 1).
- **Agent runtime generalisation** — the single agent loop promoted to serve
  every workflow, not only chat (Phase 2).
- **Event stream and narration layer** — one structured event envelope,
  stored and replayable, rendered as thinking blocks, tool groups and
  learner-safe activity narration across all workflows (Phase 3).
- **Context Manager wiring** — per-operation minimum-context selection for
  every workflow step (Phase 4).
- **Learning evidence everywhere** — every workflow recording the same
  evidence shape into the learner model (Phase 4a).

## Workflow completions

- **Decay Review as a full workflow** — decay-driven review with persisted
  states and operations on the shared runtime (Phase 8).
- **Study Prep → Teaching handoff and completion callback** — child
  workflows emitting outcomes that the parent validates before changing its
  own state (Phase 7).
- **Learner model unification** — one learner model across Study Prep,
  Teaching, Decay Review and Practice (Phase 10).
- **Agent Check** — practice that tests the learner's agent (Grand Plan
  §7.12), with its fixed-in-code checks and teach-back gates.
- **Peer agent help** — learning from how other learners got unstuck, with
  consent-gated capture of struggles and breakthroughs (§7.13).
- **Learning struggle taxonomy** — the classified struggle types and the
  struggle → strategy mapping that drives adaptation (§7.15).

## Hardening (Phase 12)

- **Media and file access-control hardening** — the Grand Plan's Phase 12
  security review note records an open item on course media access: access
  must be checked against enrolment before paid video content ships.
- **Rollout hardening** — the plan's acceptance and failure test suites
  (§18–19) passing as release gates, not aspirations.

## Explicitly not promised

- No dates. The plan sequences work; it does not schedule it.
- Nothing in the plan's "Open questions / verify before building" (§20) is a
  planned feature until the question is resolved and the decision is logged
  in the plan.
- A capability that appears in a feature document but not in
  `capability-registry.yaml` is not available, whatever this page says.
