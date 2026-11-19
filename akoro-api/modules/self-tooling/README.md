# self-tooling

Learner-built tools: capability catalogue, tool definitions and runners,
confirmation cards, escalation to admins, the resume queue, and the views a
built tool can read.

## Entry

`index.js` is the only cross-module entry point. It re-exports the router, the
capability/registry helpers, the pipeline runners, and the review helpers other
modules call.

## Extend

Add a focused file in this directory, then export its public names from
`index.js` with `export { … } from "./file.js"`. Importers outside this module
must use `modules/self-tooling/index.js`.

## Limits

`pipeline.js` and the escalation/confirmation paths hold the behavioural rules
covered by the `*.contract.test.mjs` files. Nothing here starts background work
on import; the resume sweeper is started explicitly at boot.
