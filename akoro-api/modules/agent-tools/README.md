# agent-tools

Private tool-gateway API for the Python agent: signed capability tokens, write
confirmations, conversation context, concept state, learning insights, soul
state, and bridged teaching sessions.

## Entry

`index.js` is the only cross-module entry point. It re-exports the routers and
the capability/validation helpers other modules may call.

## Extend

Add a new route or helper as its own file in this directory, then export it from
`index.js` with `export { … } from "./file.js"`. Do not import another module's
internals here.

## Limits

`routes.js` is a thin mount point; the gateway's HTTP contracts are covered by
`*.contract.test.mjs`. Capability tokens are short-lived and bound to one
session.
