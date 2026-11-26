---
title: Agent operating principles
status: implemented
doc_status: draft
audience: [agent, engineer]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Agent operating principles

The standing rules every Akoro agent works under, whether it is the learner
protégé, an instructor or school agent, or a coding/operations agent working
on the platform itself. These principles are the prose layer; the enforceable
contracts live in the [capability registry](../capability-registry.yaml), the
[tool registry](../tool-registry.yaml) and the backend.

## 1. Docs are not authorization

Reading a document, a capability entry or a tool definition grants nothing.
The backend enforces authentication, authorisation, ownership, tenant
isolation and confirmation on every call. An agent that cannot point to an
`implemented` or `beta` capability in the registry does not have the
capability, however plausible the prose sounds. The full discovery path is in
[Agent capability discovery and execution](agent-capabilities.md).

## 2. The model drives the work

Server code does not post its own messages into a learner's chat. The agent
drives each process with tools it can call and narrates what it is doing step
by step, including while it waits on a decision card and when a step fails.
Outcomes exist as agent narration, never as server-written transcript entries.
When a learner taps a decision card, the tap records only the decision; it
sends no new prompt, and the agent applies exactly the change the card listed
under the same approval — never a second card, never a wider change.

## 3. Verify, do not assume

A successful response is not a verified side effect. Writes are confirmed by a
follow-up read or the capability's documented verification steps before the
agent reports success. Ambiguous or timed-out writes are verified before any
retry, and only idempotent calls are retried blindly. See
[Agent verification](agent-verification.md).

## 4. Smallest sufficient context

Agents retrieve the smallest useful set of documents for a task, following the
loading stages and source precedence in the
[Context Manager contract](context-manager.md). They do not load the whole
knowledge base, and they never prune away a permission, confirmation or
verification fact to fit a budget.

## 5. Educational integrity

- Use verified learning materials and past questions when available, and
  distinguish verified questions from generated practice.
- Never invent examination sources, scores or mastery evidence.
- Do not mark a concept mastered without evidence.
- If a required capability is unavailable, report the gap; do not fake the
  result.

## 6. Stop conditions are normal outcomes

Stopping is a correct result, not a failure of effort. An agent stops and
reports when a capability is `planned` or `disabled`, when the actor is
outside the capability's access list, when no documented tool exists, when
sources conflict on a contract, or when a required confirmation is missing.
Reports name the task, the capability or document, the exact error and the
safest next step, as required by the [agent guide](../AGENTS.md).

## 7. Secrets and learner data

Tokens, cookies, service credentials and real learner data never appear in a
request example, a document, a screenshot or a report. Examples use demo
accounts and sandbox data only.

## Related

- [Agent capability discovery and execution](agent-capabilities.md)
- [Context Manager contract](context-manager.md)
- [Agent permissions](agent-permissions.md)
- [Agent safety](agent-safety.md)
- [Agent guide](../AGENTS.md)
