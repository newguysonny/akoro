# autonomy

The learner agent's autonomy loop: cadence and quiet hours, signal gathering,
proposal shaping, delivery into chats, instructor sweeps, and the event
triggers hot paths call.

## Entry

`index.js` re-exports the module's public surface. `scheduler.js` holds the
queue + nightly scheduler (`startAutonomyCycleWorker`); `triggers.js` holds the
cheap event seam. Importers outside this module use `modules/autonomy/index.js`.

## Extend

Add a focused file and export its public names from `index.js`. Keep
module-level work free of timers; the scheduler's interval starts only when
`startAutonomyCycleWorker` is called.

## Limits

Cadence is env-tunable via `AKORO_AUTONOMY_*` (`cadence.js`). A cycle proposes,
it never writes learner data directly.
