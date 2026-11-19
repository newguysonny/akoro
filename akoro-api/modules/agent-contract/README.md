# modules/agent-contract

The agent contract: episode recording, real-traffic gating, error
classification and the sensitive-text scrubber used before anything leaves the
process.

Entry point: `modules/agent-contract/index.js` — a pure re-export list. Other
modules import the barrel only; internals (`anonymise.js`, `contract.js`,
`episode.js`, `store.js`) are private to this module.

To extend: add the function in the owning file (or a new sibling), export it,
then add the name to `index.js`. Cross-module dependencies go through the other
module's `index.js`.

Known limits: importing the barrel eagerly loads every re-exported file.
