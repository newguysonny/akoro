# modules/records

Learner records: access rules, ask/grounding helpers, extraction, search and
chunk indexing, object storage, stored text/office parsing, media transcription
clients, study-material tools, text backfill, and the records router.

Entry point: `modules/records/index.js` — a pure re-export list. Other modules
and `app.js` import the barrel only; internals (`access.js`, `askLib.js`,
`lib/storage.js`, …) are private to this module.

To extend: add the function in the owning file (or a new sibling), export it,
then add the name to `index.js`. Cross-module dependencies go through the other
module's `index.js`.

Known limits: `studyMaterial.js` is over the 600-line ratchet and stays in the
size baseline. Two default routers exist (`routes.js`, `parseConsole.js`) and
are exposed as named aliases `recordsModule` / `parseConsoleModule`. Importing
the barrel eagerly loads every re-exported file, including the router.
