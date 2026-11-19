# admin

## Purpose

The platform-admin HTTP surface behind the admin console: operator stats and
DB-usage accounting; user, instructor, school and course administration;
dashboards and analytics; billing, subscriptions, coupons, messages and
reconciliation; payouts; AI cost, model and eval controls; the AI-agent and App
Center catalogues; tiers, pilot schools and website templates; prompt overrides,
proactive modes, confusion-pair and agent-rating review; and real-user
verification. School-scoped management belongs to `school`.

## Entry points

- `modules/admin/index.js` builds one Router and mounts 23 sibling routers at
  `/`: `routes.js`, `analytics.js`, `extended.js`, `marketing.js`,
  `websiteTemplates.js`, `agents.js`, `appCenter.js`, `aiSpend.js`, `aiModel.js`,
  `evals.js`, `agent-tool-requests.js`, `agent-tools.js`, `tiers.js`,
  `pilotSchools.js`, `billing.js`, `coupons.js`, `messages.js`, `reports.js`,
  `verify-real-user.js`, `proactiveKinds.js`, `confusionPairs.js`,
  `agent-ratings.js`, `agent-prompts.js`.
- `app.js` imports the default export and mounts it as
  `app.use("/api/admin", standardLimit, adminModule)`, so a route written as
  `/users` serves `/api/admin/users`.
- `ticks.js` is deliberately absent from that list. `app.js` mounts it at
  `/api/internal/ticks` behind `x-internal-secret` for Cloudflare's cron ticker,
  not JWT.
- The module has no named exports; consumers call the owning modules (`auth`,
  `billing`, `notifications`, `verify`, `autonomy`, ...) rather than this barrel.

## How it works

- Auth is uniform: `authenticateToken` plus `requireRole(["admin"])` (`adminOnly`)
  on every router except `ticks.js`, which authenticates the scheduler's shared
  secret.
- Data access is the Supabase client (`db`, `public`/`edu` schemas) with
  express-validator on writes. `stats` and `/dashboard/stats` fan out many
  count/sum queries with per-query fallbacks so one failing table cannot blank
  the page.
- Money paths keep their own models: billing uses `lib/billingModel.js` and
  `getBillingSettings`, reconciliation calls Paystack through
  `lib/paystackBreaker.js`, messages use `lib/messageModel.js` and
  `billing.queueMessage`, refunds/payouts call Paystack, and eval runs are
  estimated and enqueued through `lib/evals/index.js` + `lib/evalWorker.js` with
  a queue-capacity guard.
- AI administration is mostly read-only: `aiSpend` aggregates `edu.ai_call_log`,
  `aiModel` persists the runtime default through `lib/modelRuntime.js`, `evals`
  spends real money (refuses without a live key), `agent-tools` promotes
  self-tooling tools only after the `selftool` gate scenario passes, and
  `agent-prompts` edits only the prompt files the agent manifest loads.
- Review queues change a record, never provision anything: `agent-tool-requests`,
  `confusionPairs`, `agent-ratings`, `proactiveKinds` and `websiteTemplates`
  gate or annotate existing rows. `verify-real-user.js` is the only path allowed
  to start a gate run on a real account and notifies its owner.
- `marketing.js` is a thin proxy to the external lead-scout service (start job,
  poll status, CSV, health); `ticks.js` delegates to `lib/cronTicks.js`.

## How to extend

- Add a route to the sibling file that already owns the concern (for example a
  new billing view in `billing.js`, a new AI-cost aggregate in `aiSpend.js`).
- For a new concern, create `modules/admin/<name>.js` exporting a Router, then
  import it in `index.js` and add `router.use("/", <name>Router)`. Every router
  shares `/api/admin`, so literal paths must be registered before
  parameterised ones.
- Import another module only through its `index.js`; the structure scan enforces
  this. Keep new files under 600 lines; `extended.js` is baselined over the cap,
  so new dashboard work belongs in a new file. Scheduled work belongs in
  `ticks.js` plus `lib/cronTicks.js`, not in a request handler.

## Known limits

- `extended.js` is 796 lines and over the 600-line cap (baselined);
  `ticks.js` is a second entry point outside `index.js`, so a surface change
  must be checked in both places.
- Tests cover specific contracts: `usage`, `ticks`, `migrations-boot`,
  `rich-text`, `pilot-login`, `copy-message`, `confusionPairs` and
  `redis-trace`; users, schools, billing, payouts and evals routes are untested.
- `marketing` fails without its lead-scout service/key; `evals` refuses to run
  without a live model key rather than score a stand-in.
