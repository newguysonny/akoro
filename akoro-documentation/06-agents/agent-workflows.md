---
title: Agent workflows
status: beta
doc_status: draft
audience: [agent, engineer]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Agent workflows

The recurring multi-step shapes Akoro agents execute. Every workflow is a
composition of capabilities from the
[capability registry](../capability-registry.yaml); a workflow never grants
more than its steps do, and each step follows the discovery-to-verification
path in [Agent capability discovery and execution](agent-capabilities.md).

## 1. The agent turn (learner chat)

The core loop behind the learner agent tab, instructor chat, scheduled
follow-ups and card continuations:

1. Assemble context under the [Context Manager contract](context-manager.md)
   — session history, learner state, the turn's tool set (core tools plus the
   active areas' tools).
2. The model plans and calls tools one step at a time, narrating each step
   before it runs, including failed steps with failure wording.
3. A write that needs approval pauses on a decision card; the agent waits
   for the decision inside the same turn and applies exactly the listed
   change if approved (see [Agent permissions](agent-permissions.md)).
4. The final answer is composed only from tool results and verified state —
   never from an unexecuted plan.

A named tool plus a run verb in the learner's message forces that tool into
the turn; a negated verb ("do not run it") never forces. A turn that ends
mid-sentence with zero executed tools is retried once.

## 2. Upload and file workflow

Attaching a file starts extraction at attach time in the composer. Once the
learner sends, the agent itself drives the remaining steps with tools: read
the extraction, retry a failed extraction, list folders, and file the upload.
The server does not post its own progress blocks into the chat; the agent
narrates "reading / checking folders / filing" as tool steps in order. Text-
layer documents skip the model parse; scanned pages go to the extraction
worker (see [Educational content](../07-integrations/educational-content.md)).

## 3. Self-tooling workflow

When a learner asks for something no built-in covers:

1. **Lookup / answer-only.** A pure computed read is answered directly with
   no draft, card or save.
2. **Build.** A new tool is drafted and dry-run silently. For a domain the
   learner does not own yet, the own-copy gate first asks whether they want
   their own copy when a built-in already covers the data.
3. **Consent.** The draft is saved off and a build card asks the learner to
   keep it. Only the tap activates the tool and runs it once; "not now"
   archives it.
4. **Reuse.** Repeat computations (the platform sweep watches for the same
   computation recurring) are suggested as tools rather than rebuilt.

## 4. Autonomy cycles

The autonomy module runs scheduled background cycles for learners and
instructors within configured bounds: cadence and window settings, per-cycle
batch limits, weekly run caps, trigger cooldowns and quiet hours are all
environment-configured (`AKORO_AUTONOMY_*`). Autonomous work uses the same
tool and confirmation rules as interactive work — autonomy changes *when*
work runs, never *what* it may do without approval.

## 5. Scheduled follow-ups and reminders

Learners can schedule follow-ups the agent delivers later in chat. Delivery
is chat plus in-app notification; there is no automatic email on follow-up
delivery. Email happens only when the learner explicitly asks the agent to
email them, and only to their own account address (see
[Email and notifications](../07-integrations/email-notifications.md)).

## Related

- [Agent capability discovery and execution](agent-capabilities.md)
- [Agent handoffs](agent-handoffs.md)
- [Agent verification](agent-verification.md)
- [Agent error recovery](agent-error-recovery.md)
