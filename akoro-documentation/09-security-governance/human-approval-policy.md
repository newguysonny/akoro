---
title: Human approval policy
status: beta
doc_status: draft
audience: [engineer, security, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Human approval policy

Some actions must not happen on an agent's or an automation's word alone.
This policy defines which actions require a human decision, what a valid
approval is, and what happens when approval is refused, expires or never
arrives. The registry-level mechanics — `requires_confirmation` on
capabilities and tools — are specified in
[Agent capabilities](../06-agents/agent-capabilities.md); this document is
the policy those mechanics implement.

## Actions that require approval

| Action class | Who approves | Mechanism in place |
| --- | --- | --- |
| A write proposed by the learner's agent (change or delete the learner's data) | The learner | A decision card lists the exact change; the tap is the approval |
| Activating a brand-new learner-built tool | The learner | The tool is saved inactive as a draft; only the learner's Keep decision activates it |
| Applying a change a card proposed | The same learner, same card | The applied change is bound to the targets frozen on the approved card — nothing beyond them |
| Registering a new agent-readable data view | An admin | Admin-only endpoints create, approve and disable views; specs pass a validation gate first |
| Learner-proposed tools, components and capabilities | An admin or reviewer | Review queues in the admin surface |
| Verification runs against real user accounts | An admin | Real-user verification runs require a short-lived admin approval before they start |
| Production verification writes | An operator | The verification gate keeps production read-only unless writes are explicitly enabled |

## What counts as approval

- **Specific.** The approval names the action and its targets. Approving
  one deletion approves that deletion, not deletions in general.
- **Informed.** The deciding human sees what will change before deciding —
  the card or review screen shows the proposed change, not a vague
  summary.
- **Bound.** Execution applies exactly the approved change set. If the
  targets no longer exist or have changed, the approved change expires
  untouched rather than expanding to new targets.
- **Final in both directions.** A decline ends the attempt: the agent does
  not retry, rephrase or route around it. Silence is also a no — an
  unanswered card or an expired approval authorises nothing, and no
  cleanup or partial application happens on expiry.
- **Attributable.** The decision, the decider and the outcome are recorded
  (see [Audit logging](audit-logging.md)).

## What approval is not

- Approval is not a second prompt to send: a tap records the decision and
  the original flow continues; the human is not asked to re-approve the
  same change in a follow-up card.
- Approval of a *kind* of action (a saved tool, a standing permission) is
  separate from approval of an *instance*; saved tools carry their own
  per-action enable/disable controls owned by the learner.
- Documentation, including this policy, never substitutes for the backend
  check: if the confirmation is absent, the write does not execute.

## Exceptions

Read-only actions, the user's own direct UI actions, and idempotent
system maintenance do not need approval. Any proposed new exception is a
policy change: it is recorded here with its reason before it ships.

## Related

- [AI governance](ai-governance.md)
- [Access control](access-control.md)
- [Audit logging](audit-logging.md)
- [Agent capabilities](../06-agents/agent-capabilities.md)
