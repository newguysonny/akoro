---
title: Webhooks and realtime
status: beta
doc_status: draft
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Webhooks and realtime

Akoro's event surface today is **inbound only**: the API receives signed
callbacks from its payment provider. There is **no outbound webhook
system** — developers cannot register a URL and subscribe to platform
events. Event-driven updates inside Akoro's own clients travel over the
realtime socket channel described below instead.

## Inbound: Paystack callbacks

Payments are fulfilled by provider callback, not by the checkout response.
Two inbound endpoints exist:

| Endpoint | Purpose | Auth |
| --- | --- | --- |
| `POST /api/webhooks/paystack` | Unified Paystack webhook for billing/subscription events | Paystack signature |
| `POST /api/adaptive/marketplace/webhook` | Agent-marketplace purchase events | Paystack signature |

Facts that matter for integrators and operators:

- The unified webhook path is configurable: it is derived from the
  `PAYSTACK_WEBHOOK_URL` environment variable and defaults to
  `/api/webhooks/paystack` when unset. The provider dashboard and the
  server must be kept in sync through that one variable.
- Signatures are verified **once, from the raw request body**. The server
  mounts a raw-body parser for the webhook paths before any JSON parsing —
  a parsed-then-reserialised body would fail verification. Callers must
  send the exact provider payload, unmodified.
- There is no session, cookie or bearer auth on these routes; the provider
  signature is the credential. Requests with a missing or invalid
  signature are rejected and fulfil nothing.
- Subscription checkout (`/api/subscriptions`) is webhook-fulfilled: a
  successful checkout response does not by itself activate a subscription —
  the callback does. Clients must read subscription state back rather than
  assuming activation.
- Marketplace purchases similarly complete on the callback; the realtime
  channel then notifies the buyer (an `agent_purchased` socket event).

These routes are provider-facing, not a public API for Akoro developers:
do not call them from clients, and never replay a captured callback to
force fulfilment.

## Outbound webhooks: not available

Status: **planned, not implemented.** There is no endpoint to register a
webhook URL, no event catalogue, no signing secret issuance and no delivery
retry machinery for third parties. The only outbound HTTP callbacks in the
codebase are internal: an optional alert webhook for platform operators and
a `http_webhook` executor type inside the internal scheduled-tasks system.
Neither is a developer feature and neither should be documented or used as
one.

## Realtime: Socket.IO channel

Akoro's own web clients receive live updates over a Socket.IO channel
(`socket.io` with the Redis adapter for multi-instance fan-out). It is an
authenticated, session-bound channel for first-party clients, not a public
integration surface:

- Teaching sessions stream over the socket: clients join a student room
  (`subscribe-student` / `join-student-room`) and receive session lifecycle
  and token-stream events (`session_preparing`, `session_ready`,
  `student_token`, `guide_token`, `state_update`, `turn_complete`, …) in
  response to `start_adaptive_session` and `teacher_message`.
- Unauthenticated socket messages are dropped with an `error` event
  ("Sign in required.").
- Agent-network state (agent pairs, owned agents) is also served over the
  socket for the signed-in user.

Because the socket protocol is first-party and evolves with the learner
app, it is not part of the public contract in [OpenAPI](openapi.yaml);
third-party integrations should poll the documented REST endpoints with
backoff (see [Rate limits](rate-limits.md)) instead of connecting to the
socket.

## Related

- [Authentication](authentication.md)
- [Authorization](authorization.md)
- [Rate limits](rate-limits.md)
- [Errors](errors.md)
