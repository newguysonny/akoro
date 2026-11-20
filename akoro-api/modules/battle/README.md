# battle

Battle lifecycle: entry rules and costs, question sourcing, agent checks and
recall, network/challenge battles, recurring series, judging, and results.

## Entry

`index.js` is the only cross-module entry point for battle code. `worker.js` is
deliberately not re-exported: importing it constructs the BullMQ queue and
Redis connection, so queue users import it directly (and the boot path imports
it only to start the worker).

## Worker

`worker.js` owns the `battles` queue, Redis connection and Worker events. The
job logic is beside it (Phase 19 step 4):

```
worker.js        queue + Worker + BullMQ lifecycle
worker-jobs.js   action → job module router
worker-create.js start-battle: claim live, drop unclaimed seats, Q1
worker-start.js  advance-question and the per-agent answer jobs
worker-battle.js agent-answer and reveal-question
worker-end.js    end-battle: settle, rank, pay, Agent Check hand-off
worker-expire.js expire-battle and refresh-leaderboard
worker-rules.js  pure helpers (no db/queue)
worker-core.js   queue registry, battle log/XP writes, per-run state
```

New HTTP behaviour goes in the service/rules/store layers below, not in the
worker.

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

`worker.js` stays small: it is the queue consumer's construction, not a route
layer. Job behaviour goes into the worker job files above; new HTTP behaviour
goes into the service/rules/store files instead of growing `routes.js` or
importing the worker into them.
