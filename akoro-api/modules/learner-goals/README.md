# learner-goals

A learner's educational goals: listing, creating, and updating them through one
write path so the active-goal cap and title checks always apply.

## Entry

`index.js` is the only cross-module entry point. Its default export is the
`/api/learner-goals` router; named exports are the service calls the chat tools
and self-tooling runtime use.

## Extend

Add behaviour to `service.js`, not the router, so every caller (chat tool,
self-tooling, agent proposals) gets the same checks. Export new service calls
from `index.js`.

## Limits

At most `MAX_ACTIVE_GOALS` active goals; titles are trimmed and capped. The
service writes, so callers must pass the authenticated learner's id.
