# courses

## Purpose

The largest learner/instructor module: course catalogue and delivery, commerce,
live teaching, and engagement APIs. It owns course content (modules, lessons,
progress, quizzes), carts and checkout, payments and coupons, enrolments,
bundles and search, gifts, certificates, reviews, Q&A, announcements, class chat,
agent profiles, notifications, progress analytics, video streaming/subtitles,
live and peer sessions, meeting OAuth, and earnings/payouts. It mounts at the API
root, so its route files carry their own path prefixes.

## Entry points

- `modules/courses/index.js` composes 20 routers; `app.js` mounts it as
  `app.use("/api", standardLimit, coursesModule)`.
- `public-catalog.js` is registered first so `GET /api/courses/published`,
  `/api/courses/:idOrSlug/full`, `/api/live-sessions` and
  `/api/instructors/featured` are not captured by a `/:id` route.
- `meeting-integration.js`, `stream.js` and `scheduler.js` are mounted at
  `/meeting`, `/stream` and `/scheduler`; everything else is flat on `/api`.
- `payments.js` is mounted once because its paths already start with
  `/payments`; `payments-mount.contract.test.mjs` pins that.
- Named exports are `fulfillPaymentsCharge` (`payments.js`) and
  `fulfillTransferEvent` (`payouts.js`); `modules/webhooks/paystack.js` imports
  both from this `index.js` to fulfil webhooks.
- `student-feed.js` is a special case: `app.js` imports its
  `studentFeedRouter`/`battleFeedRouter` directly and mounts them at
  `/api/student` and `/api/battle`, outside this barrel.

## How it works

- Two auth layers: `authenticateToken`/`requireRole` from
  `modules/auth/index.js`, then `courseAccess.js` for id-taking routes.
  `canManageCourse` is the course's instructor or an admin, `canUseCourse` adds
  an active enrolment, and `role === "instructor"` is never ownership.
- Commerce is Paystack-backed through `lib/paystackBreaker.js`. Direct purchase,
  cart, bundles and gifts initiate/verify payments; the unified webhook router
  verifies the signature once and calls the exported fulfil functions. Sales
  write `instructor_earnings` with the commission snapshotted from
  `PLATFORM_COMMISSION_PERCENT`.
- Live teaching: `meeting-integration.js` stores Zoom/Google/Teams OAuth tokens
  in `provider_tokens` with a Redis read cache and refresh lock;
  `live-sessions.js` is the mounted router over `live-sessions-service*.js`
  (request orchestration), `live-sessions-rules.js` (validation + field
  allowlist) and `live-sessions-store.js` (Supabase queries). `peer-sessions.js`
  and `scheduler.js` create and drive meetings. A `node-cron` tick runs every
  minute to create links and expire sessions; `/api/scheduler/*` can force that
  state manually.
- Media: `stream.js` uploads the source to R2. With `MEDIA_WORKER_URL` set,
  `encodeDispatch.js` hands the job to the media container and opens no BullMQ
  queue; otherwise it enqueues on `video-encoding`. The container/worker calls
  back through `/api/stream/internal/*` with the shared secret. Certificates use
  `pdf-lib` and R2; subtitles accept VTT/SRT (SRT becomes VTT).
- Engagement: `course-content.js` owns modules/lessons/progress/quizzes;
  `chat.js` broadcasts class messages over Socket.io; Q&A, announcements,
  reviews, notifications, progress analytics and agent profiles fill out the
  student/instructor views. `notifications.js` also registers Web Push.

## How to extend

- Add a feature as a sibling router, then add an import and `router.use(...)` in
  `index.js`. Decide deliberately whether its paths need a prefix or stay flat.
- Keep ownership checks in the new route: call `courseAccess.js` for any
  course/module/lesson/session/video id, and put literal paths before `/:id`.
- Import another module only through its `index.js`; sibling imports inside this
  module are expected (as `scheduler.js` does for its two helpers).
- New files must stay under 600 lines. Several files here are baselined over the
  cap, so shape a new feature as its own file instead of growing them.

## Known limits

- Baselined over 600 lines: `cart.js` (821), `meeting-integration.js` (754),
  `payouts.js` (717), `course-content.js` (709), `courses.js` (644).
- `courses.js` is the legacy in-memory mock, intentionally unmounted: real CRUD
  lives in `/api/instructor/courses`, reads come from `public-catalog.js` and
  `course-content.js`, and mounting it would shadow real routes.
- `student-feed.js` belongs to this directory but is mounted by `app.js` at
  `/api/student` and `/api/battle`; changes are not visible through `index.js`.
- Paystack, R2, Redis and the meeting providers are required in production;
  `MEDIA_WORKER_URL` selects container encoding, otherwise BullMQ/Redis is.
- Tests are ownership/mount contracts (`course-ownership`, `payments-mount`,
  `stream-encode-dispatch`), not an end-to-end checkout test.
