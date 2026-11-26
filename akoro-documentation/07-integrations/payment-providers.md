---
title: Payment providers
status: beta
doc_status: draft
audience: [engineer, partner]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Payment providers

## Purpose

One payment provider settles everything in Akoro: **Paystack**. Wallet
top-ups, course and marketplace purchases, subscriptions and instructor
payouts all run through it. There is no Stripe, Flutterwave or other payment
SDK in the API's dependencies, and no second provider behind a flag — any
document or sales material naming another provider is wrong.

## How it is wired

- `akoro-api/lib/paystackService.js` is the single wrapper for the Paystack
  API: initialise transaction, verify transaction, webhook validation. All
  payment operations go through it.
- `akoro-api/modules/webhooks/paystack.js` is the unified webhook endpoint.
  Paystack signs webhooks with the account secret key — there is no separate
  webhook secret — and the handler verifies the HMAC signature with a
  timing-safe comparison before any fulfilment runs.
- Amounts are handled in kobo (₦100 = 10,000 kobo) end to end.
- Payment events are audit-logged (`lib/paymentAudit.js`).

## Configuration surface (names only)

| Variable | Role |
| --- | --- |
| `PAYSTACK_SECRET_KEY` | Server-side API key; also the webhook signing key |
| `PAYSTACK_PUBLIC_KEY` | Client-side key for checkout |
| `PAYSTACK_WEBHOOK_URL` | Registered webhook target |
| `PAYOUT_MINIMUM_KOBO` | Minimum instructor payout threshold |
| `PLATFORM_COMMISSION_PERCENT` | Platform fee on sales |
| `USD_NGN_RATE` | Rate used where a price is set in USD |

Exact figures (coin value, welcome grant, fee, payout minimum, refund
window) are environment-tunable defaults, not constants of this document.

## Failure handling

- If `PAYSTACK_SECRET_KEY` is unset the API warns at boot and payments fail
  closed — checkout cannot initialise.
- Paystack calls pass through a dedicated circuit breaker
  (`lib/paystackBreaker.js`): a failing provider stops being hammered, and
  the caller receives a clean failure rather than a hang.
- A webhook with an invalid signature is rejected; fulfilment (enrolment,
  earnings credit, marketplace access) runs only after verification of the
  transaction, never on the browser's return alone.
- Refunds within the configured window revoke the purchased access and
  return funds through the same provider.

## Data shared and privacy impact

Paystack receives the payer's email, the amount, a unique reference (the
platform's purchase id) and transaction metadata needed for fulfilment. Card
data is handled by Paystack's hosted checkout and never touches Akoro
servers. Instructor payout details (bank account) are shared with Paystack
at payout time. Learners hold an in-platform coin balance; the wallet,
transactions, payouts, vouchers and subscriptions are Akoro data (see
[Supabase](supabase.md)).

Vouchers are a first-party funding path — codes are issued and redeemed
inside Akoro (`lib/voucherRedeem.js`, `modules/vouchers`) — not an external
voucher provider integration.

## Related

- [Payments overview](../01-features/payments/overview.md)
- [Agent network overview](../01-features/agent-network/overview.md)
- [Agent safety](../06-agents/agent-safety.md)
