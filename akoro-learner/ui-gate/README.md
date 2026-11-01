# Frontend gate

The learner app's own journeys, run in a real browser against the real API,
with a verdict per scenario — the frontend partner of the API's Verification
Gate (`akoro-api/modules/verify`, the `/verify` skill).

```bash
cd akoro-learner
npm run ui-gate                                  # local build, all suites, phone + desktop
node ui-gate/run.mjs --suite reader --device phone
node ui-gate/run.mjs --scenario reader.quote_chip   # brings what it needs along
UI_GATE_APP=https://akoro.name.ng node ui-gate/run.mjs --target live
node ui-gate/run.mjs --suite instructor          # the instructor app, as tester51
```

**The instructor app** — suite `instructor` builds `akoro-instructor` instead
(the same pass-through to the API) and signs in with portal `instructor` as
an instructor test account (`tester51` by default, `--learner tester52`).

**Verdicts** — `PASS` every check held · `FAIL` a check did not (screenshot +
video in `ui-gate/.out/`) · `BLOCKED` a precondition was missing, with the
reason (network, login, a scenario it needs) · `ERROR` the scenario broke.
Only `PASS` is verified. Exit code 0 only for `PASS`.

**Targets**
- `live` — the deployed app (`UI_GATE_APP`) and its API (`UI_GATE_API`).
- `local` (default) — this checkout, built and served on `127.0.0.1:4321` by
  `vite preview`, with `/api` and `/socket.io` passed through to `UI_GATE_API`
  (default `https://api.akoro.name.ng`) — see `vite.gate.config.mjs`.
  `--no-build` reuses the last build.

**Accounts** — only the seeded test learners (`tester01`–`tester50`
@demo.akoro.app), signed in through the app's own login. The gate adds no
way in. Password: `UI_GATE_PASSWORD`, else the seed's documented one
(`migrations/2026-seed-agent-testers.sql`). Never a real account.

**What a run leaves** — nothing: every record a scenario makes carries a
`[ui-gate:xxxxxx]` marker and is deleted at the end, pass or fail.
Screenshots and video stay in `ui-gate/.out/` (git-ignored), never committed.

**Devices** — `phone` (Pixel 7: touch, mobile viewport) and `desktop`
(1280×800). Real Android quirks (Brave's selection handles) are close but
not identical; `reader.selection_one_page` drives the handle case directly.

**In a locked-down network** (a cloud sandbox): the browser and the
pass-through use `HTTPS_PROXY`. What that network can't reach is reported,
not faked:
- the file store (`*.supabase.co`) unreachable → `reader.opens_pdf` and
  `reader.selection_one_page` are BLOCKED;
- WebSockets dropped by the proxy (probed at start) →
  `reader.session_connects` is BLOCKED.

## Scenarios

| Suite | Scenario | Checks |
|---|---|---|
| auth | `auth.signin_form` | the sign-in form lands on /app as the learner |
| reader | `reader.opens_pdf` | a PDF record opens with real pages and a guarded text layer |
| reader | `reader.selection_one_page` | margin drag, drag onto the next page, a handle range, Select all — one page |
| reader | `reader.opens_text` | a pasted-text record opens with its paragraphs |
| reader | `reader.session_connects` | the live teaching session connects |
| reader | `reader.quote_chip` | "Ask the tutor" → quote chip (page, words, focus) → sent bubble with the quote |
| reader | `guide.learn_suggestions` | Learn suggestions are about the document, never the old generic list |
| onboarding | `onboarding.conversation` | the learner setup chat: required answers can't be skipped, optional ones can, school and teacher are searched, and the saves the app sends match the old form's (intercepted, never sent) |
| onboarding-instructor | `onboarding.instructor_conversation` | the same for the instructor setup chat (name, school, subject required; guide name optional) |

**Onboarding suites** run on demand (not in `all`): a test account is already onboarded, so the scenario
shows the app an un-onboarded session and intercepts every write the onboarding makes — nothing about the
account changes and no real teacher or school admin gets a join request.

**Journey: onboarding and approvals** (`npm run journey:onboarding`) — the one run that uses REAL accounts,
so it targets the sandbox API only (it refuses any other unless `--allow-api`). It builds and serves the
learner, instructor and school apps, then: a new instructor signs up, onboards and lands on the dashboard → the
school admin approves them on Teacher requests → a new learner signs up, onboards choosing that instructor and
lands on /app → the instructor approves them on Join requests. Every save is read back through the API (name,
level/class, school, subjects, agent, guide, onboarding flag, both join requests) and each app is reloaded to
prove it stays routed. Accounts are "Ada Obi <tag>" / "Tunde Bello <tag>" at @demo.akoro.app, left as
evidence. School admin: `SCHOOL_ADMIN_EMAIL` / `SCHOOL_ADMIN_PASSWORD` (default the demo school,
`Admin2026`). Flags: `--no-build`, `--headed`. Output: `ui-gate/.out/journey-onboarding/`.

Add one: a `{ name, description, needs?, devices?, run(t) }` in
`scenarios/*.mjs`, listed in `scenarios/index.mjs`. `t` gives `page`,
`context`, `app`, `api(method, path, body)` (as the learner), `check`,
`equal`, `note`, `block`, `cleanup`, `shot`, `state` (shared within a run),
`network`.

CI: `.github/workflows/verification-gates.yml` — on deploy (after the backend gate) and by hand; evidence kept as an artifact.
