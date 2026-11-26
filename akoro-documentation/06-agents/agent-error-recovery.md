---
title: Agent error recovery
status: beta
doc_status: draft
audience: [agent, engineer]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Agent error recovery

How agents and the runtime recover from failure without corrupting state,
double-applying a change, or hiding what happened.

## 1. Classify before reacting

| Class | Examples | Reaction |
| --- | --- | --- |
| Permanent request error | Validation failure, unknown field, capability `planned`/`disabled` | Do not retry unchanged; fix the cause or report the gap |
| Permission refusal | Actor outside `access`, ownership check failed | Stop; report the permission issue; never try another token |
| Missing confirmation | Write proposed without a decision | Present the decision card; wait; a decline ends the attempt |
| Transient transport failure | Timeout, connection reset, upstream 5xx, rate limit | Verify state, then retry within the bounded policy below |
| Ambiguous write result | Timed out after the request was sent | Read back the state first; retry only if the effect is absent |
| Provider failure | Model provider error, quota, overload | Fail over along the model ladder (section 3) |
| Documentation conflict | Registry, OpenAPI and prose disagree | Stop and report both sources; do not silently pick one |

## 2. Retry discipline

- Retry only idempotent calls, or calls with an idempotency key. The
  notification outbox, for example, keys sends idempotently so a retry after
  a restart cannot double-send (see
  [Email and notifications](../07-integrations/email-notifications.md)).
- A failed tool step inside an agent turn is narrated as failed, with a
  recovery hint, and the turn continues or stops honestly — the agent never
  claims a failed step "found" something.
- A turn that produced no executed tool calls and ends mid-sentence is
  retried once; a second failure is reported, not looped.
- Retries are bounded. When the bound is exhausted the agent reports the
  exact error, what was verified, and the safest next step.

## 3. Model failover

Model calls fail over along an ordered ladder: the model's own configured
fallback, then the runtime global fallback, then the default — each with its
own chain followed in turn, bounded to a small number of hops. Only failures
that are plausibly transport- or quota-shaped (rate limited, auth, upstream
5xx, timeout, connection, payment/quota statuses) trigger failover; a bad
request does not. Capability requirements are respected on every hop — a
vision role never fails over to a model that cannot see images. Circuit
breakers per provider stop a dead provider from being hammered while it
recovers. Details in [AI providers](../07-integrations/ai-providers.md).

## 4. Partial failure in multi-step work

- Each step's effect is verified independently; a later failure does not
  roll back an earlier verified step silently — the agent reports which
  steps landed and which did not.
- Card-bound changes are trimmed to the frozen target set approved by the
  learner; if none of the targets remain, the change expires untouched
  rather than applying to something else.
- Background work (autonomy cycles, scheduled follow-ups, deferred jobs)
  runs through queues with their own retry and gating; a paused queue (for
  example when a shared quota is exhausted) resumes rather than dropping
  work.

## 5. Reporting

Failure reports name the task, the capability or endpoint attempted, the
exact error, what was verified, the missing documentation or contract if
any, and the safest next step. Paraphrased errors and invented recovery
paths are both prohibited.

## Related

- [Agent verification](agent-verification.md)
- [Agent safety](agent-safety.md)
- [Context Manager contract](context-manager.md)
- [Agent guide](../AGENTS.md)
