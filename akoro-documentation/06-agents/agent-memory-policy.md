---
title: Agent memory policy
status: beta
doc_status: draft
audience: [agent, engineer]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Agent memory policy

What Akoro agents remember, where it lives, and what must never be treated as
memory. The policy distinguishes three kinds of state that are easy to
confuse.

## 1. The three kinds of state

| Kind | Contents | Lifetime | Owner |
| --- | --- | --- | --- |
| Conversation context | The current session's messages, tool trace and working state | One session (with a durable-context option for agent chat) | The learner's session |
| Learner memory | Learning state: concept mastery evidence, study plans, goals, saved tools, preferences | Persistent, per learner | The learner |
| Operational memory | Registries, documentation index, verification results, runtime settings | Platform lifetime | The platform |

Conversation context is assembled per turn under the
[Context Manager contract](context-manager.md): staged retrieval, deduplication
and pruning. It is working state, not a record — when it is summarised, the
summary must keep permission, confirmation and verification facts intact and
must never invent a field, route or status.

## 2. Learner memory rules

- Mastery is evidence-based. A concept is recorded as mastered only from
  assessment or practice evidence, never from the agent's impression of a
  chat. The agent-memory module's quiet-learning path updates learning state
  from observed activity under the same rule.
- Learner memory is owner-scoped. One learner's memory is never loaded into
  another learner's context, including through the agent network: a peer
  consultation receives the question, not the learner's history.
- Learners can inspect what the agent holds about them through their own
  surfaces (goals, tools, study state). Personal tools and their data are
  strictly owner-scoped; see [Agent permissions](agent-permissions.md).
- Teaching sessions are permanent learning history by design: there is no
  capability to delete them, and agents must not offer to.

## 3. What is not memory

- **Documents are not memory.** A retrieved document informs one task; it
  does not become a standing fact. Availability is re-checked against the
  [capability registry](../capability-registry.yaml) each time.
- **Another agent's output is not memory.** Handoff results and peer answers
  are claims to verify, not facts to store. See
  [Agent handoffs](agent-handoffs.md).
- **Model output is not evidence.** Generated practice questions, summaries
  and explanations are labelled as generated and never written back as
  verified material or mastery evidence.

## 4. Retention and deletion

- Learner-facing records follow the owning feature's rules: library records
  can be deleted by their owner; learner-built tools can be deleted or
  disabled per action, enforced at run time.
- Operational data (logs, telemetry, billing meters) is platform data, kept
  for operations and cost accounting; it is never exposed to learners as
  "memory" and never loaded into a learner's context.
- Secrets are not memory: credentials, tokens and keys live only in the
  environment/configuration layer and are never written into documents,
  examples or stored context.

## 5. Failure behaviour

If memory state is missing or contradictory (for example, a saved tool whose
view no longer exists), the agent reports the gap and works from verified
current state rather than reconstructing what it expected to find.

## Related

- [Context Manager contract](context-manager.md)
- [Agent handoffs](agent-handoffs.md)
- [Agent safety](agent-safety.md)
- [AI and agent runtime overview](../01-features/ai/overview.md)
