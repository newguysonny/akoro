# modules/agent-proposals

The learner's proposal inbox: help suggestions, proactive proposals and ideas
merged into one list, the accept/dismiss actions, suggest-help chats and the
background sweep, plus the router.

Entry point: `modules/agent-proposals/index.js` — a pure re-export list. Other
modules and `app.js` import the barrel only; internals (`inbox.js`,
`inboxCore.js`, `suggestHelp.js`, …) are private to this module.

To extend: add the function in the owning file (or a new sibling), export it,
then add the name to `index.js`. Cross-module dependencies go through the other
module's `index.js`.

Known limits: the default export is the agent-proposals router from `routes.js`;
importing the barrel eagerly loads every re-exported file, including the router.
