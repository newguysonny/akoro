# modules/materials

Learner materials: upload ingest and extraction, subject/kind classification,
filing into folders, study-source lookup for agents, the recently-deleted
purge and the materials router.

Entry point: `modules/materials/index.js` — a pure re-export list. Other
modules and `app.js` import the barrel only; internals (`routes.js`,
`studySource.js`, `uploadTools.js`, …) are private to this module.

To extend: add the function in the owning file (or a new sibling), export it,
then add the name to `index.js`. Cross-module dependencies go through the other
module's `index.js`.

Known limits: the default export is the materials router from `routes.js`;
importing the barrel eagerly loads every re-exported file, including the router.
