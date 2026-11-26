---
title: Agent examples
status: beta
doc_status: draft
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Agent examples

Concrete traces of how an agent should work a task against Akoro —
including the branches where the correct behaviour is to stop, ask, or
report a gap. These complement the
[agent capability workflow](workflows/agent-capability.md); gateway calls
there are internal and are sketched here at the decision level, not as
public API.

## 1. Answer from the learner's own library (success)

Task: "How many tools have I created?"

1. Identify the capability (the learner's own self-built tools) and confirm
   its status in the capability registry — `beta`/`implemented`, not
   `planned`.
2. Read the tool's input schema; the question needs no parameters beyond
   the session identity.
3. Invoke the read tool. Result: 2 tools, with names and statuses.
4. Answer from the result — "You have created 2 tools: …" — and cite the
   observation, not memory.

Failure branch seen in practice: the model once answered this question
from conversation context with **zero tool calls**. That is a defect, not
a style: counts about a learner's data must come from a tool observation
in the same turn, or the agent must say it could not check.

## 2. Write that needs confirmation (success)

Task: "Delete my earliest chat."

1. Resolve the target with a read first (list chats, pick the earliest) —
   never act on a guessed id.
2. Prepare the write through the confirmation path; the learner sees a
   card naming exactly what will be deleted.
3. On approval, execute **exactly the listed change** — one card, one
   deletion — and narrate the outcome in the chat. The card itself is not
   written into the transcript as the outcome.
4. Verify with a follow-up read (count decreased by one) before reporting
   success.

## 3. Capability that does not exist (report the gap)

Task: "Delete that teaching session for me."

There is deliberately **no session-delete capability**: teaching sessions
are permanent learning history. The correct trace is:

1. Check the registry and tool catalogue — no matching capability.
2. Do **not** improvise (no direct API call, no substitute delete).
3. Tell the learner plainly that sessions can't be deleted, and offer the
   nearest supported alternative if one exists.

## 4. Permission failure (stop, don't route around)

Task: a learner asks the agent to open another learner's record.

The read returns 403/404 (see [Authorization](../02-api/authorization.md)).
The agent stops, explains the record isn't visible to them, and does not
attempt the admin portal, an internal route, or a different tool to reach
the same data.

## 5. Duplicate request (don't double-apply)

The learner taps a confirmation card twice, or repeats "did it work?"
after a slow turn.

- A decided card is final: re-delivering the same decision must not apply
  the change twice. The agent checks the current state (the chat is
  already deleted; the tool is already saved) and reports the existing
  outcome instead of executing again.
- For a repeated question, re-read and answer from the fresh observation
  rather than re-running the write.

## 6. Empty result (answer honestly)

Task: "Build me a tool that counts my scheduled follow-ups" — dry run
returns 0 follow-ups.

The build is still valid; the agent reports the dry-run result as zero,
shows the tool working, and does not invent a follow-up to make the demo
look better. Empty is a result, not an error.

## 7. Timeout on a long turn (recover, don't restart)

A proposing turn can wait on a learner decision for a long time. If the
turn times out or the learner responds much later:

- The decision is picked up on the next turn in that chat; the agent
  applies exactly what the card proposed.
- The agent does not re-propose from scratch or apply a *different*
  change than the one that was approved.

## Related

- [API examples](api-examples.md)
- [Complete workflows](complete-workflows.md)
- [Discover and execute an agent capability](workflows/agent-capability.md)
