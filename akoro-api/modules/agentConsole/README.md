# agentConsole

## Purpose

A shared-key-guarded operator console for the real learner Agent Chat. It lets a
tester (or an automated agent holding the key) drive one genuine chat turn as a
learner and inspect which tool the model picked, what the tools returned, the
reply, and the server log lines produced while it ran. It also exposes repair
and diagnostic operations for learner tools and AI providers. It is not an
end-user API: every route is behind `AGENT_CONSOLE_KEY`.

## Entry points

- `modules/agentConsole/routes.js` is imported directly by `app.js` and mounted
  as `app.use("/api/agent-console", standardLimit, agentConsoleModule)`. This
  module has no `index.js`; the default export is the only public entry.
- The documented routes are `GET /status`, `POST /pick`, `POST /chat`,
  `POST /tool`, `GET /logs`, `GET /runs`, `GET /runs/:id`, and `GET /` (the small
  HTML console page). The file also serves operational endpoints:
  `repair-library-tools`, `cleanup-domain-tools`, `learner-tools`,
  `content-parses`, `debug-token`, `pharmd-hash-backfill`, `structured-test`,
  `grounding-ab`, `ai-provider`, `ai-ping`, `ai-failover-test`, and the durable
  trace endpoints under `/execution/*`.
- `cleanup.js` is an internal pure helper (`cleanupPlan`, `isSimpleRead`) used by
  the tool-cleanup endpoint and unit-tested separately.

## How it works

- `guard` requires `AGENT_CONSOLE_KEY` to be configured and compares it with
  `safeCompare`. The key may arrive as `x-agent-console-key`, an
  `Authorization: Bearer` token (cloud network secrets can inject that), or
  `?key=` for the HTML page.
- A learner is resolved from `@username`, email or UUID in `public.users` and
  must have the `student`/`learner` role. When `AGENT_CONSOLE_LEARNERS` is set,
  only those usernames/emails are accepted.
- `/chat` signs a short internal access token with `signInternalAccess` and
  calls the real `POST /api/adaptive/chat/agent` over loopback. `dry` is the
  default and is passed as `x-agent-console-dry`; the chat route wraps execution
  in `runDry`, so side-effecting tools return their "would have" result.
- `/tool` loads the learner tool catalogue lazily from
  `modules/adaptive-learning/index.js`, rejects tools that do not belong to that
  catalogue, and runs one tool either under `runDry` or for real.
- The last 50 runs are kept in an in-memory ring buffer (`/runs`); durable
  execution traces come from `edu.agent_runs` through `listRuns`,
  `getAgentRun` and `listFailureDigests` in the adaptive-learning barrel.
- `lib/logTap.js` supplies the log sequence and lines (`/logs`), and the AI
  diagnostics use `lib/modelRegistry.js`, `lib/aiModel.js` and the OpenCode
  adapter to exercise provider selection and failover.

## How to extend

- Add a new diagnostic route inside `routes.js` and put `guard` as the first
  handler; the console test asserts that every registered route uses it.
- `routes.js` is already over the 600-line cap, so a new family of endpoints
  should go in a sibling file and be mounted from `routes.js` (or from `app.js`)
  rather than growing that file further.
- Import other modules only through their `index.js`; the adaptive-learning
  import here is deliberately dynamic so the console module does not build a
  static dependency on the large chat stack at boot.
- Keep pure planning/parsing logic beside `cleanup.js` so it can be unit-tested
  without a model call.

## Known limits

- `routes.js` is 694 lines (baselined over 600).
- Runs live only in memory and reset on restart; durable traces are separate and
  must be queried through `/execution/runs`.
- `live` mode really executes tools and can change data; dry mode is the
  default, but callers must pass `mode: "live"` explicitly and should treat the
  endpoint as privileged.
- The header comment lists the console's main routes but not the later
  operational endpoints; the route table above is the current surface.
- `console.test.mjs` and `cleanup.test.mjs` are source/behaviour contracts; they
  do not run a full model-backed chat turn.
- `/chat` depends on the API reaching itself at `INTERNAL_API_URL` (or the local
  port), and the AI diagnostics depend on whichever provider keys are set.
