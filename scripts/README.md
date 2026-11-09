# Preview Screenshot Workflow

How to preview UI changes as screenshots in the sandbox, push them to GitHub for
review, and have them read back by a vision model. This is fully reproducible in
a fresh session.

## 1. What this solves

- The sandbox is headless (no GUI, no display) and ephemeral.
- The main agent model (`deepseek-v4-pro`) does **not** accept image input, and
  the chat cannot render images inline.
- So the loop is: **capture → push to GitHub (you review) → vision sub-agent
  reads it back (text report)**.

## 2. Install Playwright + Chromium (once per sandbox)

```bash
mkdir -p /tmp/kilo/browser && cd /tmp/kilo/browser
npm init -y
npm install playwright
npx playwright install --with-deps chromium
```

Notes:
- The sandbox has a TLS-intercepting proxy, so every page/context must be
  created with `ignoreHTTPSErrors: true`.
- Install lives under `/tmp/kilo` and does not survive the session.

## 3. Environment / endpoints

| Thing         | URL                                    |
|---------------|----------------------------------------|
| API           | `https://api.akoro.ng`                 |
| Learner app   | `https://app.akoro.ng`                 |
| Instructor app| `https://instructors.akoro.ng`         |
| Marketing site| `https://akoro.ng`                     |

Demo student account (from `docs/learner-smoke-test.md`):

```
email:    stu.jss11@demo.akoro.app
password: Priya2026
```

Auth is HttpOnly-cookie based; a real browser login (the capture script) sets the
session cookie, which is what lets us screenshot authenticated pages.

## 4. Capture a page

```bash
node scripts/capture.mjs <route> [outputName] [viewportWidth]

# examples
node scripts/capture.mjs /app learner-dashboard 1280
node scripts/capture.mjs /settings wallet-settings 1280
```

The script:
- Opens the learner app at `<route>`.
- Signs in with the demo account if the route bounces to `/signin`.
- Saves the screenshot to `docs/screenshots/<outputName>.png`.

Overridable via env: `AKORO_APP_URL`, `AKORO_DEMO_EMAIL`, `AKORO_DEMO_PASSWORD`.

Because `scripts/capture.mjs` imports `playwright`, run it with the sandbox
install on the module path when the repo has no `node_modules`:

```bash
cd /workspace/app
NODE_PATH=/tmp/kilo/browser/node_modules node scripts/capture.mjs /app learner-dashboard 1280
```

## 5. Read the screenshot back with a vision model

The main model can't see images, so dispatch a **task sub-agent on a
vision-capable model** to describe the PNG:

- Working model: `OpenCode Go: Claude Haiku 5.5` (provider `kilo`).
- Prompt the sub-agent to `Read` the PNG path and return a written description
  (layout, visible text, and any misalignment/overflow/empty states).
- It returns a text report, which the main agent relays or acts on.

Do **not** use `DeepSeek V4 Flash Vision Exp` here — it is credit-gated in this
session ("Add credits to continue").

## 6. Push to GitHub for preview

```bash
git add docs/screenshots/<outputName>.png
git commit -m "docs(screenshots): add <name> capture"
git push origin kilo/modular-storm-thz
```

The preview branch is `kilo/modular-storm-thz`. `gh` cannot auto-open a PR (bot
token is invalid), so open a draft PR from the compare URL printed on push, or
browse the branch file view directly.

## 7. Full loop, end to end

1. Make a code change.
2. `node scripts/capture.mjs <route> <name>` to capture the changed UI.
3. Dispatch a `Claude Haiku 5.5` sub-agent to read the PNG and flag issues.
4. Fix issues and re-capture as needed.
5. `git commit` + `git push` the screenshots (and the code) to the preview branch.
6. Reviewer opens the branch/draft PR on GitHub.
