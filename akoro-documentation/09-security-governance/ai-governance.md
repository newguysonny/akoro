---
title: AI governance
status: beta
doc_status: draft
audience: [engineer, security, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# AI governance

Akoro's AI is not a side feature: an agent reads learner materials, runs
tools, builds learner-owned tools, teaches, grades practice and talks to
other learners' agents. This document states the governance rules for that
surface — what the AI may do, what bounds it, and how its behaviour is
checked. The operating contract for agents is
[Agent capabilities](../06-agents/agent-capabilities.md); this document is
the governance layer above it.

## Governing rules

1. **The agent acts as the user, never above the user.** Every tool call
   runs under the served user's session and permissions. The capability
   registry's `access` list is the ceiling; a tool may be narrower, never
   wider. There is no agent backdoor around
   [Access control](access-control.md) or
   [Tenant isolation](tenant-isolation.md).
2. **Writes are confirmed; builds are consented.** Capabilities marked
   `requires_confirmation` stop for the user's decision, and the applied
   change is bound to exactly what the user approved — see
   [Human approval policy](human-approval-policy.md). Brand-new
   learner-built tools are saved inactive as drafts and activate only on
   the learner's explicit Keep decision.
3. **Grounding over invention.** Answers about a learner's materials are
   grounded in those materials, with citations. The agent must not invent
   examination sources, scores, mastery or facts about the learner's data;
   when a capability does not exist (for example, an operation the
   platform deliberately does not offer), it says so instead of
   improvising a substitute.
4. **Model choice is configuration, not chance.** Which model serves a
   workflow is set by the platform's model configuration and persisted
   picks, visible to admins together with AI spend. Fallback behaviour on
   refusal or failure is itself a tested behaviour, not an accident.
5. **Extension is gated.** New agent reach is added through governed
   channels: data views an agent may read are registered, validated
   against the live schema and approved by an admin before they go live;
   learner-proposed tools and components go through review queues.
   Sensitive data classes are denied to agent-readable views by rule.
6. **Generated content is labelled by provenance.** Verified materials and
   past questions are distinguished from generated practice, in the
   product and in the agent's answers. Generated study content is checked
   for quality before it is presented as teaching material.
7. **Cost is governed.** AI spend is recorded per account and reviewed by
   admins; expensive workflows carry budgets and ceilings that the agent
   must respect and report honestly when reached.

## Evaluation and oversight

Agent behaviour is evaluated continuously, not by anecdote: benchmark
cases and scenario suites exercise tool choice, honesty about failures,
refusal handling and learning workflows against the sandbox — see
[Agent evaluation](../10-testing-quality/agent-evaluation.md). Admin
surfaces expose agent ratings, tool requests and spend so a human can see
what the fleet of agents is doing and intervene.

## Prohibited

- Placing credentials, tokens or one learner's private data in another
  learner's prompt, tool call or answer.
- Presenting a planned or disabled capability as available.
- Retrying or rephrasing around a user's declined confirmation.
- Using agent channels to bypass a rate limit, a paywall or a role gate.

## Review

This document is reviewed whenever a new agent capability area, model
provider or autonomous workflow is introduced. Changes to confirmation
rules are changes to this policy and to
[Human approval policy](human-approval-policy.md) together.

## Related

- [Human approval policy](human-approval-policy.md)
- [Agent capabilities](../06-agents/agent-capabilities.md)
- [Learner data protection](learner-data-protection.md)
- [Agent evaluation](../10-testing-quality/agent-evaluation.md)
