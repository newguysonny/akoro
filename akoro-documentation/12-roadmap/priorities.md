---
title: Priorities
status: beta
doc_status: draft
audience: [product, partner, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---
# Priorities

Priorities follow the implementation sequence of the Grand Plan
(`reference/Grand Plan.md` §17), read against the platform's current state.
No dates are attached: sequencing here is an ordering, not a schedule.

## The plan's sequence

| Phase | Focus | Note |
| --- | --- | --- |
| 0 | Audit and migration matrix | Marked done 2026-10-17 in the plan. |
| 1 | Workflow infrastructure | The shared workflow engine every workflow runs on. |
| 2 | Agent runtime generalisation | One loop for all workflows, promoted from the chat runtime. |
| 3 | Event stream | Structured events, narration, replayable transport. |
| 4 | Context Manager wiring | Minimum-context selection per operation. |
| 4a | Learning evidence everywhere | Every workflow records the same evidence shape. |
| 5 | Study Prep completion | The first full workflow on the shared runtime. |
| 6 | Teaching Workflow (agent-driven) | One teaching implementation, wherever it is launched from. |
| 7 | Handoff and completion callback | Child workflows report outcomes; parents validate and transition. |
| 8 | Decay Review Workflow | Spaced review driven by decay, on the same runtime. |
| 9 | Practice Workflow | Live proctored assessment as a workflow. |
| 10 | Learner model unification | One learner model fed by all workflows. |
| 11 | UI | Dashboard as workflow launcher and continuation surface. |
| 12 | Hardening and rollout | Security review, load and rollout discipline. |

## What that means in practice now

1. **Verification before expansion.** The learning features exist in code
   and are declared beta in `capability-registry.yaml`. The standing
   priority is live sandbox verification of what already exists — the
   registry's `verification_status` only moves on real runs, not on code
   presence.
2. **One runtime, no second implementations.** Study Prep–created teaching
   and dashboard teaching are the same Teaching Workflow; new learning
   behaviour lands on the shared runtime and harness rather than as a
   parallel implementation.
3. **Evidence before claims.** Learning-evidence recording (Phase 4a) and
   the unified learner model (Phase 10) gate any stronger product claims
   about mastery or progress.
4. **Hardening is a phase, not an afterthought.** Phase 12 carries the
   security review — including the recorded note on media and file access
   control — before paid, access-controlled content depends on it.

## How priorities change

The Grand Plan is the artefact that changes first: a reprioritisation is a
plan edit (with its decision log) followed by an update to this page and to
[Planned features](planned-features.md). A roadmap page never makes a
capability available — availability is determined by
`capability-registry.yaml` and the code.
