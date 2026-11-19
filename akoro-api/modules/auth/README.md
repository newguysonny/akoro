# modules/auth

Authentication and authorization for the API: JWT/session middleware, role
gates, socket handshake auth, token pair issuance, handoff/course-invite
signing, the auth cache, and transactional email.

Entry point: `modules/auth/index.js` — re-exports only. External code imports
the barrel; never `routes.js` or `emails.js` directly.

To extend: add the handler in the owning file (`routes.js`, `emails.js`, or a
new sibling), export it, then add that one name to `index.js`. Keep outbound
imports going through other modules' `index.js`.

Known limits: `routes.js` is one large router file (Phase 19 size baseline);
`index.js` re-exports `routes.js`, so importing the barrel loads the router and
its dependencies. Invite/challenge helpers are re-exported from
`routes.js`, not owned there.
