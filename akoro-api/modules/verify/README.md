# verify

The Verification Gate: scenario registry, sandbox/runner, evidence capture, the
real-user approval flow, and the policy that keeps production read-only.

## Entry

`index.js` is the only cross-module entry point. Its default export is the
`/api/verify` router; named exports are the run entry points (`startRun`,
`getRun`), the real-user helpers, the target/write policy, and the assertion
helpers and verification assertions installed at boot.

Scenario modules are deliberately not re-exported: register a scenario in
`scenarios/index.js` and let the runner reach it.

## Extend

Add a scenario under `scenarios/` and register it in `scenarios/index.js` with
its suite and risk. Keep assertions deterministic and evidence files small.

## Limits

Writes are gated by `TARGET`: production is read-only unless
`VERIFY_ALLOW_WRITES` is set. Real-user runs additionally need a short-lived
admin approval.
