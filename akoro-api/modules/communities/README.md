# communities

## Purpose

Higher-ed study groups: discovery and membership, creator-authored activities
with member submissions, shared items ("add to community"), member/analytics
views, and the per-community discussion (group chat) that is surfaced beside
connected content. Communities are separate from courses; a community has one
creator/owner and any number of members.

## Entry points

- `modules/communities/routes.js` is imported directly by `app.js` and mounted
  as `app.use("/api/communities", standardLimit, communitiesModule)`. There is
  no `index.js`; the default export is the HTTP router and the named
  `COMMUNITIES_QUERY_TIMEOUT_MS` is used by `/health` to prove the query
  deadline is deployed.
- `modules/communities/discussionSocket.js` exports `setupDiscussionSocket(io)`,
  which `lib/socketHandlers.js` calls at boot next to its JWT socket middleware.
- HTTP surface: `GET /mine`, `GET /` (discovery, `?q=`), `POST /`, `GET /:id`,
  `PATCH /:id`, `DELETE /:id`, `POST /:id/join`, `POST /:id/leave`;
  activities at `GET|POST /:id/activities`, `POST /activities/:activityId/submit`,
  `DELETE /activities/:activityId`; items at `GET /:id/items`, `POST /items`,
  `GET /for-item`; creator views at `GET /:id/members` and `GET /:id/analytics`;
  discussion messages at `GET|POST /:id/discussion/messages`.
- Files (Phase 19 step 4 split):
  - `routes.js` — router, middleware, registration order, 503/504 handlers,
    thin handler wiring (224 lines).
  - `service.js` — community, activity, item, member, and analytics flows,
    plus the response envelope and `communityOr404` (496 lines).
  - `discussions.js` — `/for-item` and the discussion history/post flows
    (124 lines), split out when the module outgrew the 600-line cap.
  - `rules.js` — pure membership / visibility / deadline predicates (34 lines).
  - `store.js` — every Supabase query, each read deadline-capped (376 lines).

## How it works

- `router.use(authenticateToken)` protects the whole router. Two tiny middleware
  log the arrival and the post-auth point so a hang can be attributed to the
  edge, auth, or a route handler from the logs alone.
- Flows follow find → gate → act: `store.js` loads, `rules.js` states the gate
  (`isOwner`, `requiresMembership`, `canJoin`, `isOwnerRole`, …), `store.js`
  writes, and the handler answers with `ok`/`bad`/`denied`/`missing`.
- All database work uses the `edu` schema tables `communities`,
  `community_members`, `community_activities`,
  `community_activity_submissions`, `community_items`, `community_discussions`
  and `community_discussion_messages`, with display names read from
  `public.users`.
- Every query that can hang runs through `lib/queryDeadline.step(name, ...)`;
  a wedged query answers 504 instead of hanging, and the offending step is
  named in the log. The losing query is abandoned on purpose and its late
  rejection is swallowed. Step labels are unchanged from the pre-split file.
- Ownership is checked per route: only the creator edits/deletes the community,
  creates activities, or reads analytics; members read the member list, items
  and discussion; joining and activity submission are idempotent.
- Discussion writes stay on REST (`POST /:id/discussion/messages`) and are
  broadcast through `req.app.get("io")` to `discussion:<communityId>`. The
  socket only fans out; every `join-discussion` re-checks
  `edu.community_members`, and the identity comes from `socket.data.user`.
- `modules/autonomy/index.js` receives `emitAutonomyEvent` calls for community
  activity so proactive/agent features can observe it.

## How to extend

- Register the endpoint in `routes.js` and put the flow in `service.js` (or
  `discussions.js` for discussion/for-item work). Keep the existing ordering
  rule: literal prefixes such as `/activities`, `/for-item`, `/items`, and
  `/mine` must be registered before `/:id`, or they are captured as an id.
- Add queries to `store.js` and wrap every read in `step(...)`; put the gate
  itself in `rules.js` so service flows read as one line. Use the module's
  `ok`/`bad`/`denied`/`missing` helpers for a consistent envelope.
- Keep every file under 600 lines: the Phase 19 ratchet fails on new oversized
  files, and `modules/communities/routes.js` is no longer in the baseline.
- Import another module only through its `index.js`; within this module,
  sibling-file imports are fine.

## Known limits

- There is still no `index.js`; `app.js` imports `routes.js` directly and
  `discussionSocket.js` is mounted from `lib/socketHandlers.js`.
- The two per-request `console.log` lines are intentional diagnostics and are
  present on every communities request.
- The deadline abandons slow queries; their results/errors are not reconciled
  later, and a 504 does not cancel the database work.
- `detail-responds.test.mjs` drives the real router with PostgREST stubbed at
  the fetch boundary, `queryDeadline.test.mjs` tests the shared deadline helper,
  and `community-ownership.contract.test.mjs` pins the ownership gates by
  reading `service.js`/`store.js`. There is no live-database integration test.
- Missing tables are detected from Supabase error codes and answered as a
  schema-unavailable error; deploying the code before the migration will fail
  those routes until the tables exist.
