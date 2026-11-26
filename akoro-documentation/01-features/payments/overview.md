---
title: Payments overview
status: beta
doc_status: overview
tier: 2
audience: [learner, instructor, developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
capabilities: []
---

# Payments overview

The learner wallet and coins, instructor earnings and payouts, vouchers,
subscriptions, purchases and refunds.

## What it covers

Payments settle through the unified Paystack webhook with signature
verification. Learners hold a coin balance; instructors earn on sales and
payout to bank accounts; vouchers and subscriptions provide additional funding
paths.

## Primary flow

1. A learner funds a wallet (naira top-up or voucher code) or checks out a
   purchase.
2. Payment is verified and fulfilment runs (enrolment, earnings, notification).
3. Instructors accumulate earnings and request payouts.
4. Refunds within the window revoke access and return funds.

## Status

Implemented and in use; treat as **beta** for public documentation. Exact
figures (coin value, welcome grant, platform fee, payout minimum, refund
window) are environment-tunable defaults.

## Permissions

- Learner owns their wallet; instructors own their earnings.
- Payouts require verified bank details and a minimum threshold.

## Data

Wallets, transactions, payouts, vouchers, subscriptions and refunds.

## Documentation gaps

- Exact tunable values are environment-specific.

## Related

- Public docs: `akoro-docs/content/docs/learn/payments.mdx`
- Webhook: `akoro-api/modules/webhooks/paystack.js`
