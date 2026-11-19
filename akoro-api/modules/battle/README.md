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

## Limits

`routes.js` and `worker.js` are large; new behaviour should go into focused
files (as `agentCheck.js`, `seriesCore.js`, and `knowledge.js` already do)
instead of growing them.
