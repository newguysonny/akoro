# wallet

The learner coin wallet: balance, top-up and payment fulfilment.

## Entry

`index.js` is the cross-module entry point. It re-exports `fulfillCoinTopup`,
the fulfilment the unified Paystack webhook calls. The Express router is mounted
directly from `routes.js` by `app.js`.

## Extend

Keep ledger writes in one transaction in `routes.js`; add new top-up sources as
fulfilment functions that are idempotent per payment reference.

## Limits

Top-ups depend on Paystack verification; a replayed webhook is a no-op.
