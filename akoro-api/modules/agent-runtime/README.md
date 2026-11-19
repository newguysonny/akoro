# agent-runtime

The shared agent runtime: the tool loop, loop guards, per-tool time limits,
caps, harnesses/checkers, LLM-agent construction, and the action-basis rules
that record why an action happened.

## Entry

`index.js` is the only cross-module entry point.

## Extend

Add a focused file here and export its public names from `index.js`. Keep the
runtime free of worker/cron work — it is loaded by chat paths and verification.

## Limits

`actionBasis.js` is the single source of the basis vocabulary (`RULES`,
`BASES`, `NO_RULE_CODE`); do not duplicate rule codes elsewhere.
