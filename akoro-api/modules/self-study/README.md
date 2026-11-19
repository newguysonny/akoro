# self-study

Instructor self-study authoring: activity drafts and versions, routines,
generated question papers/rubrics, activity reviews, and submission rendering.

## Entry

`index.js` is the only cross-module entry point. `routes.js` is the module's
default export; draft/routine helpers are named exports.

## Extend

Add a focused file and export its public names from `index.js`. Background
version jobs register through the draft/routine helpers, not at import.

## Limits

`drafts.js`, `questionPaper.js`, and `routes.js` are the large files; new
behaviour belongs in a smaller module (`paperTemplate.js`, `plan-scaffold.js`).
