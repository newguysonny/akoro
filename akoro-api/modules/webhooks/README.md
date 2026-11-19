# webhooks

The single Paystack webhook ingress. Paystack sends every event to one
configured URL; this module verifies the signature once and fans the event out
to the domain that owns it.

## Purpose

Owns signature verification against the raw request body, the event dispatch
table, and the durable payment audit line for every event. It does not own any
domain's fulfilment logic — each domain exposes its own handler.

## Entry points

`app.js` imports `modules/webhooks/paystack.js` directly (there is no
`index.js`) and mounts it at the path component of `PAYSTACK_WEBHOOK_URL`,
defaulting to `/api/webhooks/paystack`. It is mounted with
`express.raw({ type: "application/json" })`, so `req.body` is a `Buffer`.

- `POST /api/webhooks/paystack` (or the configured path) — the only route.

`PAYSTACK_SECRET_KEY` is the signing key; Paystack has no separate webhook
secret.

## How it works

- `paystackSignatureValid` performs a constant-time HMAC check over the exact
  raw bytes. A bad signature is logged with `signatureValid: false`, is never
  acted on, and returns `400`.
- Every valid event is first written through `logPaymentEvent`
  (`lib/paymentAudit.js`) with its type, reference, payment id, and metadata.
- `charge.success` is dispatched sequentially to the payments (course/cart),
  marketplace (agent/tool), coin top-up, voucher wallet, and subscription
  fulfillers. Each handler is idempotent and no-ops when the metadata is not
  its own; each is wrapped in its own `try` so one failure does not mask the
  others.
- `refund.processed` goes to the marketplace fulfiller. `transfer.*` goes to
  the voucher withdrawal handler first, then the instructor payout handler, in
  independent `try` blocks because they own different tables.
- `charge.failed` goes to the subscription handler. Unknown events are
  acknowledged with `200` so Paystack stops retrying.
- All paths return `200` after processing, including internal errors, to avoid
  retry storms; the failure is logged and audited instead.
- Imported fulfillers come from other modules' `index.js` barrels:
  `courses`, `adaptive-learning`, `wallet`, and `vouchers`.

## How to extend

Add a new domain by exporting an idempotent fulfiller from that module's
`index.js`, importing it here, and adding a branch with its own `try`/`catch`
and `logPaymentEvent` outcome. Never re-parse the body before verification, and
never add JWT auth — the signature is the authentication. Cross-module imports
must go through `index.js` (`modules/README.md`); files stay at or under 600
lines.

## Known limits

- `fulfillSubscriptionEvent` is called for `charge.success` and
  `charge.failed` but is not imported in this file. Those calls throw a
  `ReferenceError`, which the surrounding `catch` records as an error, so
  subscription events are currently not fulfilled by this route.
- The module has no tests; the dispatch and signature behaviour are untested.
- Unrecognised events are acknowledged without an audit row (the audit write
  happens inside the per-type branches).
- One function contains the whole dispatcher, so a slow domain handler delays
  the response for the others even though they run sequentially.
