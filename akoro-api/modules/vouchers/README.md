# vouchers

A self-contained voucher marketplace. Businesses ("startups") register, sell
credit voucher batches to agents, and startups redeem the codes through a
server-to-server API. It carries its own wallets, pricing, Paystack client,
and outbound webhook delivery so it can be extracted as a service.

## Purpose

Owns the `vouchers` Postgres schema: startups, discount tiers, voucher
products, API keys, batches, codes, redemptions, the agent prepaid wallet, the
startup settlement wallet, withdrawals, webhook deliveries, and API logs.

## Entry points

`modules/vouchers/index.js` builds the router mounted by `app.js` at
`/api/vouchers`. Importing it also imports `webhookWorker.js` as a side effect,
which schedules the outbound webhook drain.

- `/v1` → `validate.js`: API-key-authenticated startup endpoints
  `POST /validate` and `GET /redemptions`.
- `/startups` → `startups.js`: Akoro-session endpoints for registering a
  startup, settings, cover/product uploads, discount tiers, voucher products,
  API keys, webhook config and delivery retry, batches, code lookup,
  redemptions, analytics, settlement wallet, and withdrawals.
- `/` → `agent.js`: `GET /marketplace`, `GET /wallet`,
  `/wallet/transactions`, `POST /wallet/topup/init`, `POST /purchase`,
  `POST /purchase-product`, `GET /my-codes`, `GET /batches`.

Named exports `fulfillVoucherWalletTopup` and `fulfillVoucherTransferEvent` are
called from the unified Paystack webhook in `modules/webhooks/paystack.js`.

## How it works

- All database access goes through `vdb()` in `db.js`, the module's single
  boundary to the shared client (`db.schema("vouchers")`).
- Lookup-table ownership: `apiKeyAuth.js` hashes the presented `sk_live_…`
  key (sha256) and confirms the startup is active; `startups.js` checks
  `owner_user_id` on every `/:id` route; agents use the normal
  `authenticateToken`.
- Redemption is one atomic `redeem_code` RPC, with an optional
  `idempotency_key` replay path and a per-key rate limiter (300/min). The
  startup is credited net of `VOUCHER_PLATFORM_FEE_PCT` (default 10%) from the
  code's snapshotted `paid_price_usd`.
- Buying codes is claim-batch → debit wallet → generate/insert codes →
  mark paid, with a refund and `failed` batch if generation fails. Wallet
  debits/credits are conditional-update RPCs so they cannot overdraw or
  double-credit.
- Withdrawals debit the startup wallet first, call Paystack
  recipient/transfer, then record the result. Only Paystack calls sit in the
  refund path; a post-transfer bookkeeping failure is logged, never refunded.
- Outbound webhooks are queued (`webhook_deliveries`) and drained every minute
  by `webhookWorker.js` using `claim_webhook_deliveries` with
  `FOR UPDATE SKIP LOCKED` and `requeue_stuck_webhooks`. Deliveries are HMAC
  signed as `t=<timestamp>,v1=<hex>` over `<timestamp>.<body>`.
- Top-ups and withdrawal reconciliation come back through the unified Paystack
  webhook; the handlers inspect metadata/`vwithdraw_<id>` references and are
  idempotent.

## How to extend

Add agent endpoints to `agent.js`, startup-owner endpoints to `startups.js`, and
startup server-to-server endpoints to `validate.js`, then mount any new router
in `index.js`. Keep all SQL behind `db.js`; use the `lib/` helpers for wallet,
pricing, codes, Paystack, and webhooks. Cross-module imports must go through the
other module's `index.js` (`modules/README.md`); files stay at or under 600
lines.

## Known limits

- `startups.js` is 628 lines and is baselined as oversized; it may only shrink.
- The module has no tests.
- Several flows require database RPCs and tables created outside the module
  (`redeem_code`, `wallet_*`, `startup_wallet_*`,
  `claim_webhook_deliveries`, `requeue_stuck_webhooks`).
- The webhook worker runs per process; `VOUCHER_WEBHOOKS=off` disables it, and
  `VOUCHER_WEBHOOK_BATCH`/`VOUCHER_WEBHOOK_TIMEOUT_MS` tune it.
- Refund and post-transfer failures are logged as requiring manual correction;
  they are not automatically reconciled.
- `USD_NGN_RATE` (default 1600) converts USD amounts for Paystack, and
  withdrawals require a configured `PAYSTACK_SECRET_KEY`.
- Wallet top-ups are fiat-only in this version; there is no card-saved
  subscription or recurring charge flow here.
