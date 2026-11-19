# billing

Learner subscriptions and billing communications: the Paystack checkout router,
webhook fulfilment, and the delivery queue for billing messages.

## Entry

`index.js` is the only cross-module entry point. Its default export is the
`/api/subscriptions` router (`gateway.js`); named exports are the fulfilment
helper, billing settings, and the message queue.

`jobs.js` is a side-effect module (billing cron jobs) and is imported directly
by `app.js`; it is not re-exported.

## Extend

Add a gateway event to `fulfillSubscriptionEvent` and grant/revoke through the
existing model helpers. Message templates live in `delivery.js`.

## Limits

Payments are disabled without `PAYSTACK_SECRET_KEY`; the gateway reports that
rather than fabricating a charge. Billing amounts use the shared coin model.
