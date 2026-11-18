# Preview Screenshot Workflow

Capture the learner UI from the sandbox, **before deploying**, and read the
result back with this model's vision. Reproducible in a fresh session — follow
this file and nothing has to be rediscovered.

## 1. What this solves

- The sandbox is headless (no GUI) and ephemeral.
- The agent model (`kilo/opencode-go/deepseek-v4.1-flash`) **does** accept image
  input: `Read` a PNG and describe it. No vision sub-agent is needed (older
  notes about `deepseek-v4-pro` and `Claude Haiku 5.5` are obsolete; Haiku is
  only a fallback if the session model changes).
- The chat cannot render images for the user, so screenshots are written to
  `/artifacts` for download. Artifacts never touch git.
- Anything written inside the repo **is auto-committed and pushed** by the
  platform, and `kilo/modular-storm-thz` auto-deploys (`render.yaml:18`,
  `autoDeployTrigger: commit`). Previews therefore stay **outside** the repo.

## 2. Install once per sandbox

Repo dependencies (learner app):

```bash
cd akoro-learner && npm ci --no-audit --no-fund
```

Playwright + the matching Chromium (browsers are cached, the npm package is
not; version mismatch shows up as "Executable doesn't exist ... chromium_headless_shell-NNNN"):

```bash
cd /workspace/app && npm i playwright --no-save --no-audit --no-fund
npx playwright install chromium
```

Notes:
- The sandbox TLS proxy requires `ignoreHTTPSErrors: true` (already set in
  `scripts/capture.mjs`).
- `npm ci` may skip install scripts; `npx vite --version` confirms the binary
  still works.

## 3. Environments

| Thing           | URL                        | Notes                              |
|-----------------|----------------------------|------------------------------------|
| Production API  | `https://api.akoro.ng`     | real data — avoid for previews     |
| Sandbox API     | `https://sandbox.akoro.ng` | same code, **its own database**    |
| Learner app     | `https://app.akoro.ng`     | deployed                           |
| Marketing site  | `https://akoro.ng`         | deployed                           |

- Sandbox cold-starts: a first request can return `502` for ~30–60s, then
  `/health` answers. Wait and retry.
- Sandbox runs the same commit as the branch, so it previews **server** code
  only after a push; client-side previews do not need it to be current.
- Demo account (seeded in both; sandbox starts with no sessions/XP):

```
email:    stu.jss11@demo.akoro.app
password: Priya2026
```

## 4. CORS for the local dev server

The sandbox API must list the dev origin in `CORS_ORIGIN` (comma-separated env,
set in the deployment dashboard):

```
...,http://localhost:5173
```

Listed origins get `Access-Control-Allow-Origin` **and**
`Access-Control-Allow-Credentials: true`, which the cookie login needs. Verify:

```bash
curl -s -D - -o /dev/null -X OPTIONS https://sandbox.akoro.ng/api/auth/login \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type' | grep -i '^access-control'
```

Expect `204` + both headers. Keep `localhost:5173` on the **sandbox only** —
granting it in production trusts any page served from localhost in a user's
browser with credentialed reads.

## 5. Run the learner app against the sandbox

```bash
cd akoro-learner
VITE_API_URL=https://sandbox.akoro.ng VITE_TARGET=app \
  npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

`curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/` should print
`200` (Chromium uses the `localhost` origin, so keep that hostname for the
capture even though Vite binds `127.0.0.1`).

## 6. Capture into `/artifacts` (default)

```bash
AKORO_APP_URL=http://localhost:5173 AKORO_OUT_DIR=/artifacts/screenshots \
  node scripts/capture.mjs /app lesson-dashboard 1280
```

- `AKORO_APP_URL` points at the local dev server (uncommitted code, sandbox data).
- `AKORO_OUT_DIR` defaults to `docs/screenshots`; **always override it to
  `/artifacts/screenshots`** for pre-deploy previews.
- The script signs in with the demo account when the route bounces to
  `/signin`, then saves `<name>.png` and prints the landing URL.
- Other overrides: `AKORO_DEMO_EMAIL`, `AKORO_DEMO_PASSWORD`.
- The user downloads the PNG from the chat's Artifacts panel; there is no
  public URL for it.

## 7. Read the screenshot back

```
Read /artifacts/screenshots/<name>.png
```

Describe layout, visible text, empty states, and misalignment/overflow, then act
on it. Only if the session model loses image support, dispatch a `task`
sub-agent on a vision model (`OpenCode Go: Claude Haiku 5.5` worked;
`DeepSeek V4 Flash Vision Exp` was credit-gated) and relay its text report.

## 8. Deploy safety

- Never place preview screenshots under `docs/screenshots` unless the push is
  intended: the platform auto-commits and pushes the worktree at the end of a
  turn, and a push to `kilo/modular-storm-thz` deploys the API/learner.
- Code changes follow the same rule: review via `/artifacts` first, then let
  the push happen when the change is accepted.
- `docs/screenshots/*` on the branch are historical captures (`git log --
  docs/screenshots`).

## 9. URL without deploying (throwaway branch)

When the user needs a clickable link instead of an artifact download, put the
PNG on a branch that Render does not track, without touching the session branch
or its worktree:

```bash
blob=$(git hash-object -w /artifacts/screenshots/<name>.png)
GIT_INDEX_FILE=/tmp/kilo/preview-index git read-tree HEAD
GIT_INDEX_FILE=/tmp/kilo/preview-index \
  git update-index --add --cacheinfo 100644,$blob,docs/screenshots/<name>.png
tree=$(GIT_INDEX_FILE=/tmp/kilo/preview-index git write-tree)
commit=$(git commit-tree "$tree" -p HEAD -m "docs(preview): <name> (throwaway branch)")
git push origin "$commit:refs/heads/preview-assets"
```

View at
`https://github.com/newguysonny/akoro/blob/preview-assets/docs/screenshots/<name>.png`
(the repo is private, so `curl` returns 404 — open it in a logged-in browser).
Delete it when done:

```bash
git push origin --delete preview-assets
```

The session branch (`git status -sb`) must stay clean and untouched by this.
