# modules/auth

Authentication and authorization for the API: JWT/session middleware, role
gates, socket handshake auth, token pair issuance, handoff/course-invite
signing, the auth cache, and transactional email.

Entry point: `modules/auth/index.js` — re-exports only. External code imports
the barrel; never `routes.js` or `emails.js` directly.

Layering (Phase 19):

- `routes.js` — Router, rate limiters, validation chains, thin handlers; keeps
  the default export and the named exports the barrel re-exports.
- `service*.js` — the flows: `service.js` (signup/login/email codes),
  `service-2fa.js`, `service-session.js` (issuance, refresh, logout,
  change-password), `service-google.js`, `service-password.js`. Shared response
  plumbing in `service-common.js`, frontend links in `service-links.js`.
- `rules.js` — pure validators/normalisers and response shapes.
- `store.js` — every Supabase query; no Express.
- `tokens.js` — cookie names/options, signing/verification, hand-off/invite
  tokens, the deny-list (and its unref'd sweep), and the gate signers.
- `session.js` — `authenticateToken`, `authenticateSocket`, `requireRole`, and
  the per-request user cache.

To extend: add the handler in the owning service file (or a new sibling), add
it to the `authHandlers` table in `service.js` (or import it in `routes.js`),
then add that one name to `index.js` if it is public. Keep outbound imports
going through other modules' `index.js`.

Known limits: importing the barrel loads the router and its dependencies,
including the Google strategy registration (only when credentials are set) and
the deny-list sweep. Invite/challenge helpers are re-exported from `routes.js`,
not owned there.
