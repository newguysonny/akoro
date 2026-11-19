# agent-network

The learner's agent network: the social graph and settings, peer messaging and
consultations, challenges, study buddies, daily battles and circles, and the
agent's outreach to a struggling learner's friends.

## Entry

`index.js` is the only cross-module entry point. `routes.js` is the module's
default export; the remaining named exports are the helpers other modules call.

## Extend

Add a file in this directory and export its public names from `index.js`. Wires
that need boot-time registration belong in `lib/bootHooks.js`, not here.

## Limits

Peer content is untrusted: message/outreach shaping and the protected-learner
check live in `messaging.js`, `autoReplyCore.js`, and `outreachCore.js`.
