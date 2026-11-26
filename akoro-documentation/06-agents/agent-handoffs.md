---
title: Agent handoffs
status: beta
doc_status: draft
audience: [agent, engineer]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Agent handoffs

How work and questions pass between agents — learner agent to peer agent,
agent to specialist service, and agent to human — without losing the
permission or verification rules that applied at the start.

## 1. Handoff surfaces

| Surface | What crosses | Guard |
| --- | --- | --- |
| Agent network consultation | A question from one learner's agent to a peer's agent | Learner visibility and privacy controls; blocks apply both ways |
| Agent marketplace | A purchased agent's capability, offered to the buyer | Payment verified first; review is purchaser-only |
| Python agent service relay | Actions delegated to the separate agent service process | Service secret (`AKORO_AGENT_SERVICE_SECRET`); relayed through the private gateway |
| Human decision card | A proposed change, paused for the learner | The tap is the approval; see [Agent permissions](agent-permissions.md) |
| Capability / tool requests | A request for a capability or tool that does not exist yet | Reviewed through the capability-request and tool-request channels; an admin authors any new data view |

## 2. What a handoff carries

A handoff carries the task, the relevant context the receiving side is
allowed to see, and the identity/scope it acts under. It never carries:

- credentials, tokens or service secrets;
- another learner's private records, memory or history — a peer consultation
  sends the question, not the asker's learning record (see
  [Agent memory policy](agent-memory-policy.md));
- permissions the sender did not have. A handoff cannot widen access: the
  receiver re-checks the capability's `access` list against the actor it
  acts for.

## 3. Trust rules

- The receiving agent treats the handoff as a **request**, not as verified
  fact or as authorization. It runs its own registry check before acting.
- Results returned across a handoff are claims. The originating agent
  verifies side effects it reports to its user, per
  [Agent verification](agent-verification.md).
- Protected learners are never auto-answered by another learner's agent;
  their side of a network exchange stays human-paced.
- If the receiving side is unavailable or declines, the originating agent
  reports that plainly rather than substituting its own guess for the peer's
  answer.

## 4. Human handoffs

Some work ends with a person by design:

- Decision cards pause a write until the learner taps.
- Tool and capability requests file into a review channel instead of the
  agent improvising the missing capability.
- New data views for self-tooling are authored by an administrator from an
  agent-filed data request; the agent does not author registry specs itself.

A declined or expired human decision ends the attempt. The agent does not
re-ask through a different surface.

## Related

- [Agent network overview](../01-features/agent-network/overview.md)
- [Agent permissions](agent-permissions.md)
- [Agent memory policy](agent-memory-policy.md)
- [Agent workflows](agent-workflows.md)
