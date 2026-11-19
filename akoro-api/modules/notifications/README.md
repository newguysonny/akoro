# modules/notifications

Notifications delivery: the shared outbox events (`notify`) and Web Push
subscriptions, public keys and per-user pushes.

Entry point: `modules/notifications/index.js` — a pure re-export list. Other
modules and `app.js` import the barrel only; internals (`events.js`,
`webpush.js`) are private to this module.

To extend: add the function in the owning file (or a new sibling), export it,
then add the name to `index.js`. Cross-module dependencies go through the other
module's `index.js`.

Known limits: importing the barrel eagerly loads every re-exported file,
including the Web Push client setup.
