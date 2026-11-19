# learner-state

The Redis-backed record of what each learner's agent already knows: the student
state blob, per-topic analysis, cached clears, agent preferences, agent
ownership and purchases.

## Entry

`index.js` — the only import surface. It re-exports from `student-state.js`:

- `getRedis` — the shared ioredis client used for this state.
- `getStudentState` / `saveStudentState` / `updateStudentState` —
  read/write/merge the learner's state blob for a given agent.
- `clearStateCache` — drop the cached copy after a reset.
- `getAgentPreferences` / `saveAgentPreferences` / `userOwnsAgent` /
  `addPurchasedAgent` — the agent ownership and purchase side.

## Rules

- Import only `lib/`, `config/` and db/redis clients here. This module is the
  bottom of the agent stack (see the layering in Phase 19 step 2); anything
  from another module would recreate the cycle it was extracted to break.
- Callers import the entry, never `student-state.js`.
- `learning-events.js` deliberately stays in `adaptive-learning`: it calls the
  strategy and struggle layers, which call it back, so moving it here would
  form a new cycle. Invert those calls first (listener or passed dependency),
  then it can join this module.

## Known limits

- State is cached in Redis and written through to `edu.user_agent_preferences`;
  a cache miss falls back to the database row.
- No schema migration lives here; table shape is owned by `migrations/`.
