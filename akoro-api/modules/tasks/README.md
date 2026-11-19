# tasks

School task intake and execution: routes, the task/agent context builder, the
tool catalogue for each task type, task persistence, and the task worker's
scheduling hand-off.

## Entry

`index.js` is the only cross-module entry point for pure helpers. `scheduler.js`
and `worker.js` are deliberately not re-exported: importing either opens a Redis
connection and constructs the queue/worker, so their callers import them
directly.

## Extend

Add a tool under `tools/` and register it in `tools/index.js`; export new shared
helpers from `index.js`. Keep task records in `lib/db.js`.

## Limits

`routes.js` is the module's largest file; new behaviour belongs in `lib/` or a
tool module. Scheduling is Postgres-backed (`lib/deferredJobs.js`) with Redis
only for near-term jobs.
