# battle

Battle lifecycle: entry rules and costs, question sourcing, agent checks and
recall, network/challenge battles, recurring series, judging, and results.

## Entry

`index.js` is the only cross-module entry point for battle code. `worker.js` is
deliberately not re-exported: importing it constructs the BullMQ queue and
Redis connection, so queue users import it directly (and the boot path imports
it only to start the worker).

## Extend

Add a file in this directory and export its public names from `index.js`. Route
wiring goes through `routes.js`, which is the module's default export.

The HTTP surface is split into layers (Phase 19 step 4):

```
routes.js  → service.js → rules.js → store.js
```

- `routes.js` — Router and middleware only; every handler is a one-line
  reference to a service export. Keeps the default export and
  `occurrenceHandlers`.
- `service.js` — request orchestration, one export per handler. Split by
  resource into `service-create.js`, `service-class.js`, `service-course.js`,
  `service-listings.js`, `service-challenge.js`, `service-battle.js`,
  `service-bank.js` and `service-health.js`, with shared machinery (queue
  registry, notifications, eligibility, question assignment, early start) in
  `service-core.js`.
- `rules.js` — pure decisions: deadlines and scheduling windows, seat counts,
  duration formatting and the editable battle fields. No db import.
- `store*.js` — every Supabase query, grouped by table:
  `store-battles.js`, `store-seats.js`, `store-questions.js`,
  `store-people.js`, with `store.js` as the entry. No Express import.

New behaviour goes in the service/rules/store layers, not back into
`routes.js` or `worker.js`.

## Limits

`worker.js` is deliberately large and separate: it is the queue consumer, not a
route layer. New HTTP behaviour should go into the service/rules/store files
above instead of growing `routes.js` or importing the worker into them.
