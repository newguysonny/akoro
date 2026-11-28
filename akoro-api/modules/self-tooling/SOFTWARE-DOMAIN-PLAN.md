# Akoro Software Domain — Plan (DRAFT for Matt's approval, 2026-11-28)

Status: PLANNING ONLY. No code written. Research annex:
`DSH-CREATOR-CAPABILITIES.md` (DeepSeek Harness Creator Mode, from the code, +
executor pricing). This plan folds that research into Akoro's existing
self-tooling architecture.

## 1. What this is

A new domain — **software** — whose "view" is a learner's sandboxed workspace and
whose actions let the agent (and, in teach sessions, the protégé flow) write,
run, verify, and install real code as plugins/tools. It is the Plugin Runtime
plan's Phase 4 (sandboxed code) opened deliberately: where mode tools are
declarative (steer + effects + SpecView), software-domain plugins are actual
code, executed ONLY inside an isolated executor — never in-process on the API
server (the one DeepSeek property Akoro cannot copy: DSH is single-user desktop;
Akoro is multi-tenant).

## 2. Executor decision (from the pricing research)

- **Provider seam first** (the DSH `ctx.sandbox` pattern): one internal
  interface — create / exec / files / snapshot / restore / expose port /
  destroy — with swappable providers.
- **v1 provider: Cloudflare Sandbox SDK** (Containers behind a Worker +
  Durable Object gateway our API calls). Akoro already vendors with Cloudflare
  (R2). $5/mo floor; CPU billed only while active ($0.072/vCPU-hr), memory
  $0.009/GiB-hr until sleep (~10 min idle). Modelled cost ≈ **$0.03–0.05 per
  creator session** (alive 30 min, ~3 min executing) — below the session's
  model-token cost (~$0.08).
- Fallback/prototyping: E2B (free Hobby tier; Pro floor $150/mo and wall-clock
  billing make it the scale-up fallback, not the default).
- Exit when the bill justifies it: self-hosted E2B/Firecracker. The seam makes
  this a provider swap, not a redesign.
- v1 sandbox size: fixed **basic** (1 vCPU / 2 GiB) — plugin dev does not need
  Kilo's Medium (2/8). Size becomes a plan/quota parameter later.
- Persistence: workspace **snapshots** (files) are the durable state — taken on
  install, on session end, and on demand. The sandbox itself is disposable;
  stopping it ends billing. (Mirrors Kilo's "workspace snapshot, shared by all
  chats in this workspace".)

## 3. Where it sits in the existing architecture

- **Taxonomy**: new runtime area **`software`** (14th), keywords: code, plugin,
  sandbox, app, script, build, program, website. Domain registered in the
  self-tooling domain system like the merged domains; its backing "view" is
  workspace/sandbox state served by the executor module, not a SQL view.
- **Approvals reuse existing machinery, unchanged in spirit**:
  - Build-consent gate: a finished plugin is a draft + **Keep card**; only the
    tap installs it (same as every built tool).
  - Permission cards: package installs and first network use are card-gated
    (DSH's approvedBuilds pattern).
  - Card-bound application + per-step narration apply as-is (model-only
    principle: the agent narrates; the server posts nothing).
- **Plugins are tools**: an installed plugin appears in My Tools (grouped
  domains UI), inherits per-action toggles, the 20-tool cap question applies
  unchanged, and runs through the same runtime area selection.
- **Inspection**: `akoro_inspect` gains a `software` provider (sandbox state,
  plugin manifest schema, SpecView slot catalogue, capability bridge surface) —
  the agent inspects before it writes, per the DSH fact-finding order.
- **Capability bridge**: plugin code never holds Akoro credentials and cannot
  reach the API/DB. It calls Akoro capabilities through a brokered bridge
  (the agent runtime mediates each call, owner-scoped, same permission checks
  as chat tools). This is the PTC lesson: code composes tools; the platform
  keeps the keys.

## 4. The action list (draft)

### Sandbox lifecycle
1. `create_sandbox` — provision or resume the project's sandbox; returns
   state + workspace summary. One active sandbox per project.
2. `get_sandbox` — status: provider, size, running/sleeping, uptime,
   snapshot info, live preview URLs.
3. `snapshot_workspace` — capture files as the restore point.
4. `stop_sandbox` — stop compute, keep the snapshot (ends billing).
5. `destroy_sandbox` — delete sandbox + snapshot. Destructive → confirmation
   card, always.

### Execution
6. `run_command` — one bash command (cwd, timeout default 60 s / cap 600 s);
   bounded stdout/stderr + exit code.
7. `run_code` — run a Python program in the sandbox with the capability bridge
   available as an SDK (PTC-style composition). *Phase 2 — v1 agents use
   run_command + files.*
8. Background processes ride `run_command` semantics + job handles:
   `start_process` / `process_output` / `kill_process` (needed for dev
   servers). *start_process in v1; the job trio completes in Phase 2.*

### Files (inside the sandbox workspace)
9. `write_file` / `read_file` / `edit_file` — with the read-before-edit rule
   (a file must be read before it can be edited, DSH's observation policy).
10. `list_files` — tree/glob of the workspace.
11. `search_files` — ripgrep over the workspace.

### Packages & preview
12. `install_packages` — pip (v1) installs in the project. Permission card on
    first install per project; build scripts named on the card.
13. `expose_port` — expose a sandbox port (dev server) → preview URL the
    agent and learner can open. Returns the URL; revoking = stop process.

### Browser automation (Playwright + Chromium inside the sandbox)
Launch scope DECIDED 2026-11-28: **the plugin's own preview only** — the
browser exists to verify what the agent just built; general web browsing is
a later, separate decision.
14. `browser_open` — open a URL in the sandbox browser session.
15. `browser_snapshot` — accessibility-tree observation of the page.
16. `browser_act` — click / type / select by snapshot ref.
17. `browser_extract` — structured read of page content.
18. `browser_screenshot` — screenshot → returned to the chat as an image the
    agent (and learner) can see. Primary v1 use: **verifying the plugin's own
    preview** (DSH's verification doctrine: real page, never a mock).
19. `browser_close` — end the browser session.

### Plugin lifecycle (Akoro-side, not executor calls)
20. `scaffold_plugin` — create a project from the plugin template: manifest
    (name, description, icon intent, params schema), server entry, optional
    SpecView presentation, README/detail.
21. `validate_plugin` — the gate: manifest schema, syntax check, bridge-surface
    check, presentation spec validation (reuses the SpecView validator).
    A plugin that fails validation cannot be installed.
22. `install_plugin` — the Keep-card flow: snapshot pinned, tool registered
    (mode: `code`), appears in My Tools. Reinstall/update = new snapshot +
    version note; failed update keeps the old version live (DSH rollback
    lesson).
23. `run_plugin` — how an installed code tool executes: restore snapshot →
    run entry with params via the bridge → return result → stop. (Runs ride
    the normal tool runtime; this is the executor binding behind it.)

## 5. Safety & cost controls (v1, non-negotiable)

- Code runs only in the executor. No eval, no in-process require, no path
  from plugin code to API server memory, env, or DB.
- Egress: package registries + preview/browser traffic allowed; cloud
  metadata endpoints and Akoro internal hosts blocked at the provider level.
- Quotas, metered like AI usage (same wallet/usage ledger pattern):
  per-session alive cap 60 min, auto-sleep ~10 min idle, per-learner daily
  sandbox-minutes budget; exhaustion narrated by the agent, never a server
  post.
- Every mutating lifecycle action (destroy, install packages, install
  plugin) is card-gated as specified above.
- Kill switch: `AKORO_SOFTWARE_DOMAIN=false` removes the area's tools.

## 6. Phasing

- **Phase 1** — executor seam + Cloudflare gateway + actions 1–6, 9–13
  (sandbox, run, files, packages, preview) in the agent chat, flag-gated,
  sandbox-environment testers only. Acceptance: agent builds and runs a
  "hello" Python project end-to-end from one prompt.
- **Phase 2** — plugin lifecycle (20–23) + `run_code` bridge + job trio.
  Acceptance: the Pomodoro test — one sentence → scaffolded, validated,
  Keep-card-installed, working code tool in My Tools.
- **Phase 3** — browser automation (14–19) + verification loop: agent opens
  its own plugin's preview, screenshots, fixes defects. Acceptance: a plugin
  with a UI verified from a real screenshot.
- **Phase 4** — teach/protégé integration: code projects inside teach
  sessions (the protégé writes code with the learner). Separate design pass —
  session model questions (whose sandbox, what persists into the session
  record) are open.

## 7. Decisions for Matt

1. **Name**: domain + area both `software`? (Alternatives: `code`, `builder`.)
2. **Who gets it**: DECIDED 2026-11-28 — **Premium-only at launch**.
3. **Language**: DECIDED 2026-11-28 — **Python first**. The sandbox's primary
   runtime, the scaffold template, `run_code`, and the bridge SDK are Python;
   packages via pip. Plugin UI is unaffected (still declarative SpecView —
   the learner app is React either way). Node support can be added later as
   a second runtime in the same sandbox image.
4. **Installed-plugin runs**: DECIDED 2026-11-28 — **on-demand sandbox per
   run** (restore snapshot → run → stop), as designed in Phase 2.
5. **Browser automation scope**: DECIDED 2026-11-28 — **the plugin's own
   preview only** at launch (the verification tool); general web browsing
   is a later decision.
