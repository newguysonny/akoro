# DeepSeek Harness — Creator Mode software capabilities (from the code)

Source: local clones, 2026-11-28 — `~/workspace/dsh-src` (github.com/deepseek-ai/deepseek-harness)
and `~/workspace/dsh-proto-src` (dsh-superagent-prototype). Tool names are the exact
model-facing names from `docs/tool-catalog.md` and the package sources.

Creator Mode = the Standard preset's tool surface + the `dsh-doc` skill steering the
agent at plugin development. The Standard preset (packages/bundle/web-app/presets/
standard.patch.yml) enables: bash, pwsh, fs, fs-search, jobs, schedule, skill, goal,
plan-mode, subagents + workflow, ask-user, todo, web, tool-cordis (cordis_inspect),
present, document, tool-plugin-manager, tool-plugin-market.

## 1. Development knowledge — the `dsh-doc` skill
One skill (packages/preset/agent-preset/skills/dsh-doc). Fact-finding order:
(1) runtime inspection, (2) installed docs + package sources, (3) admit unverified.
16 references read on demand: plugin-development, host-plugin, ui-plugin, mcp-bundle,
practices (extension points/state), user-actions, verification, tool-design,
configuration, compositions (presets), upgrading, packages, artwork, plugin-details,
dsh-version, locate-docs. Templates: a UI "decoration" bundle and an MCP bundle
(package.json + cordis.patch.yml + index.js + client.js + locale + DETAIL.md + icon).

## 2. Runtime inspection — `cordis_inspect` (one tool, read-only)
packages/extensions/tool-cordis. No query → directory of providers. Query =
{platform: host|client, provider, method, input}. Surfaces: exact Service methods +
input schemas, a mounted plugin's Config schema + packageDir, the tools the agent
can call, live Client slot tree (Slots.listSubTree) + registration options/props,
theme tokens. Cannot invoke business methods or modify the runtime.

## 3. Plugin lifecycle — `plugin_manager` + `plugin_market`
plugin_manager actions: list_plugins, list_bundles, set_plugin, set_bundle,
install_bundle, remove_bundle, list_version_exemptions, set_version_exemption.
Installs are pnpm package operations (registry / git / local directory targets);
inspect-before-install reads a spec's manifest; updates are version-checked with
rollback-on-failure; HMR recomposes the profile so changes go live without restart
(set_plugin enabled:true forces recomposition). plugin_market (read-only):
list_indexes, list_plugins, list_versions over user-configured plugin indexes.
EVERY plugin_manager action requires danger-full-access or per-call approval;
build scripts need their own explicit approval (approvedBuilds).

A plugin is a BUNDLE: an npm-style package —
- package.json declaring `dsh.bundle.patch` (+ engines.dsh, meta via locale files)
- cordis.patch.yml inserting plugin rows (id, name, config)
- Host code: index.js exporting `apply(ctx, config)` (or a service class);
  registers tools/services/events via ctx; Config schema validates row config
- Client code (optional): client.js registering React components into named UI
  SLOTS (e.g. conversation.composer.dock, shell.overlay) via ctx.slots;
  React supplied by the host module table
- locale/*.json (meta.title/description/detail), icon (SVG/PNG/JPEG/WebP ≤256 KiB),
  docs/DETAIL.md
Installed Host code executes IN-PROCESS, outside the workspace sandbox.

## 4. Code execution
- `bash` / `pwsh`: one-shot commands, bounded output; background processes with
  handles, polled via job_list / job_output / job_kill (tool-jobs).
- Persistent variants: one owner-isolated long-lived bash/pwsh session per agent.
- `terminal_open/send/read/list/signal/close`: interactive PTY sessions (cwd, env,
  child processes persist across calls; sandboxed backend; die with the process).
- `run_code` (PTC mode): the agent writes a TypeScript program that calls tools as
  `await tools.name(args)`; stateful REPL (variables persist across programs),
  inspect() for output, per-program timeout (default 120 s, cap 600 s), sub-call
  rate limits; the whole program can request one wider sandbox mode with
  justification + approval. In PTC the model sees ONLY run_code; the other tools
  exist as a generated TS SDK inside it.

## 5. Sandbox — a per-call confinement policy, NOT a provisioned VM
packages/sandbox. Modes: read-only | workspace-write | danger-full-access, resolved
per call (deployment default + session override). Backends: Linux bubblewrap then
Landlock, macOS Seatbelt, Windows restricted token (+ ACL write fence). Same-world:
shares the host kernel and filesystem. A denied call can retry once through a
user-approved escalation. fs-sandbox fences file-tool mutations by the same mode.
There is no create/start/stop sandbox API — confinement wraps each execution call.

## 6. Files
read, read_image, write, edit, apply_patch (Codex-style patches), str_replace_editor
(view/create/str_replace/insert), glob, grep (bundled ripgrep). Read-before-edit
policy plugin guards mutations (must have observed the file first).

## 7. Browser automation
One browser-use provider per composition (packages/browser-use + experimental):
- Playwright MCP provider
- Chrome DevTools MCP provider (inspection + control)
- Stagehand native: stagehand_navigate, stagehand_act, stagehand_observe,
  stagehand_extract, stagehand_screenshot, stagehand_tabs
Verification doctrine (dsh-doc/references/verification.md): verify on the
already-connected authenticated page; NEVER launch a separate browser from shell,
fake screenshots, or build mock previews; a screenshot of a mock is not
verification. UX review of a new plugin via a subagent before delivery.

## 8. Web + supporting tools
web_search, web_fetch (pluggable providers). Also in the catalog: lsp (language
server queries), skill (load skills), subagent / list_agents / send_message /
wait_agent / interrupt_agent, workflow, team_task_*, schedule_create/edit/list/view,
create_goal/get_goal/update_goal, todo_write, ask_user_question, present,
document_convert/render/recalculate, session search/trace tools, MCP resource
tools (list_mcp_resources, read_mcp_resource, templates), enter/exit_worktree,
load_workspace_dependencies, im_* (messaging surface).

## The Creator Mode loop (plugin-development.md, condensed)
1. Resolve what the user wants and WHERE it appears in the UI (ask if unclear);
   build a small first version; install before visual refinement.
2. Discover only the APIs needed: cordis_inspect directory → targeted queries
   (for UI: Slots.listSubTree + the slot's options/props).
3. Copy the template / author the bundle in ordinary workspace files; complete
   the display checklist (localised title/description, icon, detail doc);
   syntax-check; install with plugin_manager install_bundle (absolute dir).
4. Read `application` from the result (applied vs restart-required vs failed);
   confirm registrations via cordis_inspect; exercise the capability live;
   verify display metadata/icon on the connected page.
5. UX review (subagent) for new/changed UX; fix defects in the same plugin;
   report what remained unverified.

## Sandbox executor pricing (checked 2026-11-28, vendor pages via Nov-2026 comparisons)

Kilo Code's panel (Matt's screenshot): Cloudflare Containers, Medium = standard-3
(2 vCPU / 8 GiB), retail ~$0.66/hr billed while the sandbox exists, idle included.
That is Kilo's marked-up retail price, NOT Cloudflare's rate.

| Provider | CPU | Memory | While the agent waits | Floor |
|---|---|---|---|---|
| Cloudflare Sandbox | $0.072/active vCPU-hr | $0.009/GiB-hr | CPU $0; memory until sleep (~10 min idle) | $5/mo Workers Paid |
| E2B | $0.0504/vCPU-hr | $0.0162/GiB-hr | Full rate while alive; pause = free, ~1 s resume | Hobby $0 + $100 credit; Pro $150/mo |
| Daytona | $0.0504/vCPU-hr | $0.0162/GiB-hr | Full rate while alive; auto-stop 15 min (loses memory) | none; $200 credit |
| Modal Sandboxes | ~$0.071/vCPU-hr | $0.024/GiB-hr | max(request, actual); no pause | $0 Starter ($30 credit); Team $250/mo |
| Vercel Sandbox | $0.128/active vCPU-hr | $0.0212/GB-hr | Memory only | $20 Pro credit |
| Northflank | $0.0167/vCPU-hr | $0.0083/GB-hr | While running | low — cheapest unit rates, most DIY |
| Fly Sprites | $0.0385/CPU-hr used | $0.0219/GB-hr used | Actual use only | — |

Scenario — one creator session, alive 30 min, code running ~3 min, 2 vCPU:
- Cloudflare standard-3 (2/8): ≈ $0.044 (memory $0.036 + active CPU $0.007 + disk)
- E2B 2/4: $0.083 unpaused; ~$0.028 with auto-pause during model thinking
- Northflank 2/4: ~$0.033 if stopped between turns
- Kilo retail for the same CF box: $0.33 per 30 min
Raw CF for standard-3 at 100% CPU = $0.216/hr; at ~15% CPU ≈ $0.09–0.10/hr.

Fit notes: CF max 4 vCPU / 12 GiB, disk ephemeral (snapshots = the workspace
snapshot in Kilo's panel), Sandbox SDK = exec/files/ports/preview/snapshots,
needs a Worker + Durable Object gateway; Chromium+Playwright go in the image for
browser automation. E2B is open-source (Apache-2.0, self-hostable) — the cheapest
at-scale exit is self-hosted Firecracker/E2B on a rented server, at real ops cost.
Recommendation recorded for planning: executor behind a provider seam (DSH-style),
start on Cloudflare (already Akoro's vendor via R2; active-CPU billing suits
thinking-heavy agent sessions), E2B Hobby for prototyping. Compute per creator
session (~$0.03–0.05) is below the session's model-token cost (~$0.08–0.11).

## Divergence that matters for Akoro planning
DSH is a single-user desktop app: the "sandbox" is an OS confinement policy on the
user's own machine, and installed plugin code runs in-process on that machine —
the risk is the user's own, gated by approvals. Akoro is multi-tenant and
server-side: learner/protégé code cannot run in-process on the API server, so an
Akoro "software domain" needs a real isolated executor (container / microVM /
remote sandbox service) that DSH deliberately does not provide. What maps 1:1:
inspection (akoro_inspect exists), the approval gate (Akoro's build-consent Keep
card ≈ plugin_manager's per-call approval), declarative UI slots (SpecView ≈
client slots, minus real code), and the skill+references knowledge layer.
