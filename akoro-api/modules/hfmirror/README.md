# hfmirror

Operator console and engine for copying a Hugging Face model repository into
the account that owns `HF_TOKEN`. It is a tool for platform operators, not a
learner-facing feature.

## Purpose

Owns the mirrored-repo workflow: validate a source repo id, resolve the
destination account, plan the file list, prefer the Hub's server-side duplicate,
and fall back to a resumable file-by-file transfer. `engine.js` also owns the
pure helpers (`parseRepoId`, `resolveTarget`, `formatBytes`, `scrub`).

## Entry points

`app.js` imports `modules/hfmirror/routes.js` directly (there is no
`index.js`) and mounts it at `/api/hf`:

- `GET /api/hf/mirror/status` — current job, token configuration, file cap,
  destination account.
- `POST /api/hf/mirror` — start a run; `409` while one is already running.
- `GET /api/hf/mirror` — the same-origin HTML console.

Every route is guarded by the shared `HF_MIRROR_KEY` (`x-hf-mirror-key` header
or `?key=`); without the env var the routes answer `501`. `engine.js` exports
`runMirrorJob` and the helpers above for the contract test and other callers.

Environment: `HF_MIRROR_KEY`, `HF_TOKEN` (write token for the destination),
`HF_SOURCE_TOKEN` (optional read token), `HF_MAX_FILE_MB` (per-file cap,
default 8192).

## How it works

- One in-memory job per process. Starting again returns `409`; the job snapshot
  keeps the last 400 log lines and is lost on restart.
- Safe defaults: `dryRun` is on and `private` is on unless the request
  explicitly changes them. A dry run lists the plan and touches nothing.
- `whoAmI` validates the token and names the default destination namespace.
  `listFiles` builds the plan and totals the bytes.
- For the default `main` revision the engine first calls the Hub's
  `POST /api/models/{source}/duplicate`, so model bytes never pass through this
  process. If that is refused or the repo exists, it creates the destination
  and transfers file by file with `useXet: false`.
- The destination is listed once before transfer; files already present are
  skipped, which makes re-running after a crash a resume rather than a restart.
- Per-file failures are collected in `failures[]` instead of aborting the run.
  Every log line and error passes through `scrub`, which redacts `hf_…` tokens.

## How to extend

Add behaviour to `runMirrorJob`/helpers in `engine.js` and keep `routes.js` a
thin guard + HTTP shell. When adding an env var, document it here and in
`.env.example`; `hfmirror.contract.test.mjs` asserts the console defaults,
key guard, single-job rule, and that the module is mounted. Cross-module code
must be imported through the other module's `index.js`
(`modules/README.md`), and files stay at or under 600 lines.

## Known limits

- The job is process-local: a restart loses the log and the "already running"
  lock; only one mirror can run per instance.
- Non-main revisions always use the slower file-by-file path, because the
  duplicate API has no revision parameter.
- Files larger than `HF_MAX_FILE_MB` are skipped and reported as failures; the
  default cap is 8 GB per file.
- Real runs need network access to huggingface.co and valid tokens. The
  contract test drives the engine offline with a mocked `fetch`, so it cannot
  prove Hub-side behaviour.
- The module is entered through `routes.js`, not an `index.js` barrel.
