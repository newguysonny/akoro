# Akoro Self-Tooling & Verification Gate — Grand Plan

**Status:** the implementation plan for two linked features:

- **Self-tooling** — the learner's agent can build a tool it lacks, through
  one `create_tool` call, and use it straight away.
- **Verification Gate** — real, evidence-backed PASS / FAIL checks of the
  running system, used by the coding agent to verify its own work and by
  `create_tool` to verify every tool before it goes live.

**How it was made:** consolidated from `reference/Self tooling/` (5 notes,
ending with the user's single-interface, auto-escalating `create_tool`) and
`reference/verification-gate/` (5 notes), then reconciled with the code as it
is on 2026-10-16 (every ✅ / 🟡 claim below was checked against the repo).
Format follows `reference/Grand Plan.md`.

**Legend:** ✅ built · 🟡 exists, needs change · 🆕 new · ❓ decide before building

---

## Contents

1. Purpose and the one-paragraph idea
2. Non-negotiable rules
3. Vocabulary (locked)
4. Decisions
5. Architecture
6. Current code baseline and reuse map
7. Part A — Self-tooling
   - 7.1 What the agent sees
   - 7.2 Capability Registry and Data Views
   - 7.3 `schema_lookup`
   - 7.4 The `create_tool` pipeline (stages 0–4)
   - 7.5 Stage 1 — Compose (recipe)
   - 7.6 Stage 2 — Spec (query DSL)
   - 7.7 Stage 3 — Sandboxed code
   - 7.8 Stage 4 — Escalate (capability request)
   - 7.9 Verify before register
   - 7.10 Tool registry, runtime and catalogue
   - 7.11 Resume after approval
   - 7.12 Admin: requests, tool library, promotion, analytics
   - 7.13 Learner UI
   - 7.14 Writes (later phase)
   - 7.15 Limits, billing, abuse
8. Part B — Verification Gate
   - 8.1 What it is for
   - 8.2 Where it runs and how it is reached
   - 8.3 Scenarios, suites, assertions, evidence
   - 8.4 Verdicts and the fail-closed rule
   - 8.5 Targets and safety policy
   - 8.6 Verifying the agentic system
   - 8.7 The coding agent's verification workflow
   - 8.8 First scenario catalogue
   - 8.9 Sandbox environment (later)
   - 8.10 MCP interface (later)
9. How the two connect
10. Data model and migrations
11. API surface
12. Feature flags and env
13. Implementation phases
14. Risks
15. Acceptance criteria
16. Open questions

---

## 1. Purpose and the one-paragraph idea

Learners ask their agent for things no tool covers ("which of my weak topics
did I also get wrong in past questions?", "list study buddies who were online
this week and share my exam"). Today the agent says it can't, or files a tool
request that nobody can act on. **Self-tooling** lets the agent close that
gap itself: it calls one tool, `create_tool`, with a plain-language goal. A
pipeline behind it tries the cheapest, safest way to build that tool first —
**compose existing capabilities → a constrained query spec → sandboxed code**
— checks it with the **Verification Gate**, registers it for that learner,
and the agent calls it in the same turn. If the goal needs something the
platform does not allow, the pipeline **escalates to an admin** and the work
resumes in the same chat once it is approved.

The **Verification Gate** is the other half: an independent runner of
scenarios against the real system that returns PASS / FAIL / BLOCKED /
ERROR / INCONCLUSIVE with evidence (HTTP traces, database reads, tool
traces, logs). The coding agent (Claude, reaching the API through the
environment's Bearer secret) uses it to prove a change works on the
deployed build; `create_tool` uses the same engine to prove a new tool works
before any learner relies on it.

> The agent decides **what tool it needs**. Code decides **what tools are
> possible**, an admin decides **what capabilities exist**, and the gate
> decides **whether it actually works**.

---

## 2. Non-negotiable rules

These hold for both features. An implementation that breaks one is wrong
even if its tests pass. They extend Grand Plan §2 (rules 1–24 still apply).

**Authority**
25. **The agent never writes raw SQL, raw HTTP calls or unrestricted code.**
    Every created tool is built only from registered capabilities and data
    views. "The schema allows it" is never permission.
26. **A created tool can never do more than its learner could do with the
    existing tools.** Scope (whose data) is enforced by the interpreter, not
    by the prompt, on every call.
27. **The Capability Registry is code-owned; grants are admin-owned.** The
    agent and the learner can request a capability, never grant one.
28. **Escalation is a normal outcome, not an error.** The agent tells the
    learner plainly and the work resumes when an admin decides.
29. **Every created tool is verified before it is registered** (§7.9). A tool
    that fails verification is never offered to the model.
30. **Created tools are read-only** until the Writes phase (§7.14); writes then
    always need the learner's confirmation.

**Verification**
31. **Fail closed.** Only PASS is a pass. FAIL, BLOCKED, ERROR, INCONCLUSIVE
    and "no run" are never reported as verified.
32. **Evidence over responses.** A 200 response is not proof. Assertions read
    the database (and traces) independently of the code under test.
33. **Verify what is deployed.** A run records the build SHA it ran against; a
    claim "verified" names that SHA. A stale deploy is BLOCKED, not PASS.
34. **The gate's policy is the security boundary, not the agent's
    instructions.** Targets, accounts, writes, timeouts and budgets are
    enforced in code.
35. **Real users are read-only to the gate.** The gate may run `read` and
    `dry` scenarios as real users; real changes (`write` scenarios) touch the
    seeded test learners only, and every write registers its own cleanup.
    Every run as a real user is audit-logged and its evidence is minimised.

**Privacy and display**
36. **No backend names in learner UI** (rule 12): a created tool has a
    learner-language label; capability names, specs and code show only in
    developer mode and admin.
37. **No secrets in evidence.** Tokens, keys, emails and phone numbers are
    redacted before a run is stored.

---

## 3. Vocabulary (locked)

**Self-tooling**
- **Capability** — one operation the platform allows a tool to use, declared
  in code (`capabilities.js`): e.g. `tasks.list_mine`, `agents.search`. Has a
  kind (`read` / `write`), a scope, input and output schemas, and a status.
- **Data View** — a curated, typed, learner-scoped read projection over one or
  more tables (e.g. `my_tasks`, `my_past_questions`). Never a raw table.
- **Capability status** — `enabled` (usable), `locked` (exists, requestable),
  `forbidden` (never; cannot be requested or approved).
- **Grant** — an admin decision that turns a `locked` capability on, for
  everyone or one learner.
- **Tool builder** — the internal LLM call (fixed prompt, not the chat agent)
  that turns a goal into a recipe, spec or code. Its output is a proposal;
  code validates it.
- **Recipe** (stage 1, *compose*) — an ordered chain of capability calls with
  parameter binding and in-memory post-steps (filter, sort, limit, pick,
  count).
- **Spec** (stage 2, *DSL*) — one declarative query over one Data View:
  `where`, `select`, `order`, `limit`, `aggregate`.
- **Code tool** (stage 3) — one JavaScript function run in the sandbox, able
  to call only enabled read capabilities through a bridge.
- **Learner tool** — a created tool owned by one learner. **Platform tool** —
  a learner tool an admin promoted to everyone.
- **Capability request** — an escalation record; carries a **resume ticket**
  (goal, proposed tool, params, chat) so the work continues on approval.

**Verification**
- **Scenario** — a named, versioned script of steps + assertions against the
  real system. **Suite** — a named set of scenarios.
- **Run** — one execution of a scenario or suite, persisted with its verdict.
- **Assertion** — one deterministic check with expected / actual.
- **Evidence** — what the run observed: redacted HTTP exchanges, DB reads,
  tool traces, log window, cost, build SHA.
- **Verdict** — `PASS`, `FAIL`, `BLOCKED`, `ERROR`, `INCONCLUSIVE` (§8.4).
- **Target** — where a run executes: `production` (test accounts only),
  `sandbox`, `local`.
- **Risk class** of a scenario — `read` (no changes), `dry` (agent writes are
  simulated), `write` (real changes on test accounts, with cleanup).

---

## 4. Decisions

| # | Decision | Choice | Status |
|---|---|---|---|
| S1 | How does the agent create a tool? | **One tool, `create_tool(goal, name, params, hint?)`**, returning `created`, `escalated` or `rejected`. The agent never sees stages, sandboxes or admin paths. | **User decision** |
| S2 | How is the tool built? | **Auto-escalating pipeline: compose → spec (DSL) → sandboxed code → request capability.** Cheapest and safest first; the first stage that succeeds wins. | **User decision** |
| S3 | Who writes the recipe/spec/code? | **The tool builder** (a separate LLM call with a fixed prompt and the registry as context), not the chat agent. Output is validated by code. | Proposed |
| S4 | Does the agent read the database schema? | **No.** `schema_lookup` returns Data Views and capabilities from the registry, never `information_schema`. | Proposed (rule 25) |
| S5 | Who can use a created tool? | **The learner who created it**, across their chats. Admins see all tools and can **promote** one to every learner after a gate run. | **User decision** |
| S6 | Can created tools change data? | **Read-only in v1.** Writes come in phase S6, composed only from write capabilities, each step confirmed by the learner. | **User decision** |
| S7 | Sandbox for stage 3 | **QuickJS compiled to WebAssembly, in a worker thread inside akoro-api**: no network, no filesystem, no imports, memory and CPU limits, a single capability bridge. External sandboxes (E2B / Daytona) stay an option if code tools ever need packages. | Proposed |
| S8 | Where do escalations go? | **The existing "Agent requests" flow**, extended: `edu.agent_tool_requests` gains a `kind = capability` with the resume ticket; the existing admin page gains a capability tab. | Proposed (reuse) |
| S10 | Who gets an approved capability? | **Everyone.** An admin approval turns the capability on for all learners (optional expiry); there is no per-learner grant. Every waiting request for the same capability resumes. | **User decision** |
| S9 | How does work resume? | **Event-driven**: an admin decision enqueues a job that re-runs the stored `create_tool` as that learner and posts the outcome into the original chat (the delivery path built for scheduled messages), plus a notification. No polling. | Proposed |
| V1 | What is the gate for? | **Both** the coding agent verifying its changes **and** `create_tool` verifying new tools. One engine. | Proposed |
| V2 | Where does the gate run? | **Inside akoro-api as `modules/verify/`**, mounted at `/api/verify`, behind the console key. Reason: DB evidence and tool traces live there; scenarios are code-reviewed and versioned in the repo. **A separate service comes later** (phase V3, with the MCP wrapper, §8.10). | **User decision** |
| V3 | How does the coding agent reach it? | **The cloud environment's network secret** (Bearer on `api.akoro.name.ng`) already set up for the agent console. Same key, `Authorization: Bearer`. The coding agent never sees the key. | ✅ reachable today |
| V4 | Which target first? | **Production, with test learners and real users.** Test learners (tester01–50): all risk classes, writes with cleanup. **Real users: `read` and `dry` scenarios only** — never a real change to their data, never a message to them (§8.5). **Local** (golden-path stack) for pre-deploy checks; **sandbox** later. | **User decision** (real users in), writes kept to testers — see §16 |
| V5 | How are LLM behaviours judged? | Deterministic assertions on tool calls, arguments, state and DB first. Open-ended text only by rubric with repeats; disagreement is `INCONCLUSIVE`, never PASS. | Proposed |

---

## 5. Architecture

```
                    LEARNER                                   CODING AGENT (Claude)
                       │ chat                                         │ HTTPS + Bearer
                       ▼                                              ▼
┌───────────────── akoro-api ────────────────────────────────────────────────────────┐
│                                                                                    │
│  Agent Chat tool loop (chat.js runAgentToolLoop)                                   │
│    catalogue = built-in tools + schema_lookup + create_tool + learner tools        │
│        │                         │                                                 │
│        │ call learner tool       │ create_tool(goal, name, params)                 │
│        ▼                         ▼                                                 │
│  ┌─────────────┐   ┌──────────────────── Tool Pipeline ─────────────────────┐      │
│  │ Tool Runtime│   │ 0 validate → 1 compose → 2 spec → 3 code → 4 escalate │      │
│  │ (interpret  │◄──┤        tool builder (LLM) proposes, code validates     │      │
│  │  recipe /   │   │        every stage: capability check + verify (§7.9)   │      │
│  │  spec /code)│   └───────┬──────────────────────────────┬─────────────────┘      │
│  └──────┬──────┘           │ register                     │ escalate               │
│         │                  ▼                              ▼                        │
│         │        edu.agent_tools              edu.agent_tool_requests (capability) │
│         │                                       └─► admin decides ─► resume job ──►│ chat
│         ▼                                                                          │
│  Capability Registry (code) + grants (db) ──► existing tools / Data Views ──► DB   │
│                                                                                    │
│  ┌──────────────────────── Verification Gate (modules/verify) ─────────────────┐   │
│  │ scenarios · suites · runner · assertions · evidence · policy · persistence │   │
│  │   drives: HTTP as tester (loopback) · agent console (chat/pick/tool)        │   │
│  │   reads:  DB evidence (read path) · tool traces · logTap · /health build    │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**Each layer answers one question**

| Layer | Question |
|---|---|
| Capability Registry | What operations may any tool use at all? |
| Grants | Which locked capabilities has an admin turned on, for whom? |
| Tool builder | How could this goal be met with what is allowed? |
| Pipeline | Which stage can build it safely? |
| Gate (verify) | Does the built tool actually work, within scope? |
| Tool Runtime | Run it now, for this learner, within limits. |
| Admin | Should this capability exist? Should this tool be shared? |

---

## 6. Current code baseline and reuse map

### 6.1 What exists today

| Area | What exists | Where |
|---|---|---|
| Learner tools | 62 tools in a static `CHAT_TOOLS` array, feature-gated; one `switch` in `executeChatTool`; unknown tool → `{error:"Unknown tool"}` | `modules/adaptive-learning/chat.js` ✅ |
| Tool loop | `runAgentToolLoop`, cap **8 iterations**, sequential calls, per-call trace + log line | `chat.js` ✅ |
| Side-effect list | `SIDE_EFFECT_TOOLS`, `isSideEffecting`; dry-run short-circuit | `chat.js`, `lib/dryRunContext.js` ✅ |
| Trace display | `CHAT_TOOL_DISPLAY` (frozen), neutral fallback row for unknown tools | `chat-trace.js` ✅ |
| Tool requests | `submit_tool_request` → `edu.agent_tool_requests` (statuses `new/under_review/planned/declined/implemented`), dedupe fingerprint, admin page "Agent requests". **No resume, no learner notification.** | `modules/agent-tool-requests/`, `modules/admin/agent-tool-requests.js`, `akoro-admin/.../AgentToolRequestsPage.jsx` 🟡 |
| Write confirmations | Token-based confirm-before-write (preview, digest, TTL) — **Python gateway path only** | `modules/agent-tools/`, `edu.agent_tool_write_confirmations` 🟡 (pattern to reuse in §7.14) |
| Learner approvals | Autonomy proposals inbox; approve executes via `executeChatTool` | `modules/agent-proposals/` ✅ (pattern) |
| Delivery into a chat | Scheduled messages can land in an existing chat; `post_to_chat` | `chat-follow-ups.js`, `chat-history-tools.js` ✅ (resume path) |
| Sandbox / DSL | **None.** No vm, isolated-vm, QuickJS, E2B. Only a Python AST calculator. | 🆕 |
| Schema introspection | **None.** Service-role PostgREST client; schema lives in migrations. | 🆕 (Data Views instead) |
| Agent console | `/api/agent-console`: status, pick, chat (dry/live), tool, logs, runs **in memory (last 50)** | `modules/agentConsole/routes.js` ✅ → gate builds on it |
| Log capture | 1500-line ring, `readLogs`, `logSeq` | `lib/logTap.js` ✅ |
| Evals | 6 suites incl. `learner-tools` (choice/args/run), `edu.eval_runs/results`, BullMQ worker, admin page | `lib/evals/`, `lib/evalWorker.js` ✅ (pattern for persistence + worker) |
| Golden path | Real API + PostgREST + Postgres + Redis locally; ~28 journeys; pass/fail only | `scripts/golden-path/` 🟡 → **local target** |
| Test accounts | tester01–50 with data for every tool; `AGENT_CONSOLE_LEARNERS` allow-list | `migrations/2026-seed-agent-testers.sql` ✅ |
| Coding-agent access | Network secret → `Authorization: Bearer` on `api.akoro.name.ng`; console accepts Bearer | ✅ (verified 2026-10-11) |
| Audit | `public.admin_audit_log` (insert-only), written ad hoc; no shared helper | 🟡 add `auditAdmin()` |
| Notifications | `notifyUser` (in-app, socket, push, email) | `modules/notify.js` ✅ |
| Metering | `__feature` / `__payer` on every model call; coins per model call | `lib/aiModel.js`, `lib/coins.js` ✅ |

### 6.2 Reuse map

| New piece | Built from |
|---|---|
| Capability Registry (read) | Wraps existing read tools' `executeChatTool` cases + new Data Views |
| Tool Runtime dispatch | `executeChatTool` default branch → `runLearnerTool()` |
| Created-tool trace rows | `chatToolDisplay` neutral fallback + a learner label |
| Escalation | `edu.agent_tool_requests` + admin page (extend, don't fork) |
| Resume | BullMQ job + follow-up delivery into existing chat + `notifyUser` |
| Write confirmation (later) | `agent_tool_write_confirmations` token pattern, brought to Node chat |
| Gate runner/persistence | Evals worker + `eval_runs` shape |
| Gate agent driving | Agent console internals (`signInternalAccess` loopback, dry header, logTap) |
| Gate local target | `scripts/golden-path` stack |

---

## 7. Part A — Self-tooling

### 7.1 What the agent sees 🆕

Two new tools in `CHAT_TOOLS` (feature-gated `self_tooling`), plus the
learner's own created tools:

```json
{
  "name": "schema_lookup",
  "description": "Find what data and operations a new tool could use for a goal. Returns data views (fields you can filter, sort and count) and capabilities, each marked available or needs-approval. Read-only. Call before create_tool.",
  "input_schema": { "type": "object", "properties": {
    "goal": { "type": "string", "description": "What you want to find out or do, in plain language." }
  }, "required": ["goal"] }
}
```

```json
{
  "name": "create_tool",
  "description": "Build a new tool when no existing tool covers the learner's goal. It is built safely from approved capabilities and checked before use. Returns created (call it now), escalated (needs admin approval — tell the learner it may take longer; it continues automatically) or rejected (not supported — say so).",
  "input_schema": { "type": "object", "properties": {
    "goal":   { "type": "string", "description": "What the tool should do, in plain language (≤ 300 chars)." },
    "name":   { "type": "string", "description": "snake_case, e.g. weak_topics_missed_in_past_questions." },
    "label":  { "type": "string", "description": "Learner-facing name, e.g. 'Weak topics I also missed in past questions'." },
    "params": { "type": "object", "description": "JSON Schema of the inputs (≤ 6; string, number, integer, boolean, enum)." },
    "hint":   { "type": "object", "description": "Optional: {mode: 'compose'|'spec'|'code', views:[...], capabilities:[...]}." }
  }, "required": ["goal", "name", "label", "params"] }
}
```

Outcomes (exactly one):

```json
{ "status": "created",   "tool": "weak_topics_missed_in_past_questions", "mode": "spec", "verified": true }
{ "status": "escalated", "requestId": "…", "reason": "needs approval: battles.history_of_others" }
{ "status": "rejected",  "reason": "Asks for other learners' private data — not allowed." }
```

**Agent policy** (added to the chat system prompt and a context file,
`akoro-agent/policies/SELF_TOOLING.md`):
- Use an existing tool first. Use `schema_lookup` then `create_tool` only when
  none fits.
- `created` → call the new tool in the same turn.
- `escalated` → tell the learner in plain words that it needs approval and
  will continue in this chat; give no backend names.
- `rejected` → say it isn't supported and why, in learner language.
- Never describe code, SQL, specs or sandboxes to the learner.

### 7.2 Capability Registry and Data Views 🆕

`modules/self-tooling/capabilities.js` — code-owned, reviewed like any code.

```js
// Capability: an existing operation a tool may call.
{
  name: "tasks.list_mine",
  kind: "read",
  scope: "self",                       // self | network | public
  status: "enabled",                   // enabled | locked | forbidden
  input:  { status: { enum: ["pending","done"] } },
  output: { items: "task[]" },         // typed: tools can filter on fields
  run: (learner, input) => executeChatTool("list_tasks", input, learner.id),
  cost: 0, rateLimit: { perCall: 1 },
}

// Data View: a typed, scoped projection — the only thing specs can query.
{
  name: "my_past_questions",
  scope: "self",                       // interpreter ALWAYS adds user_id = learner
  source: { schema: "edu", table: "past_question_attempts", owner: "user_id" },
  fields: {
    exam:      { type: "string" },
    subject:   { type: "string", filter: true, sort: true },
    year:      { type: "integer", filter: true, sort: true },
    attempted: { type: "integer", aggregate: true },
    correct:   { type: "integer", aggregate: true },
    created_at:{ type: "timestamp", filter: true, sort: true },
  },
  maxRows: 500,
}
```

**v1 Data Views** (all `scope: self` unless noted; fields are allowlisted, never
`*`): `my_tasks`, `my_goals`, `my_chats` (titles/dates, not message text),
`my_weak_topics` (agent_knowledge: subject, topic, confidence, next_review),
`my_study_notes` (student_knowledge: subject, topic, confidence — content via
capability only), `my_learning_sessions`, `my_past_questions`,
`my_battles` (own seats: score, rank, subject, date), `my_xp` (xp_transactions
by subject/date), `my_courses` (enrollments + progress), `my_buddies`,
`my_agent_messages` (meta only), `network_agents` (scope `network`: only what
`search_agents` already exposes, through `canFind`), `public_blog_posts`
(scope `public`).

**Capabilities v1** = every existing **read** learner tool, wrapped with a typed
output (62 tools → ~40 read capabilities). **Write capabilities** are declared
`locked` (e.g. `buddies.end`, `circles.leave`, `challenges.cancel_mine`,
`tasks.mark_done`) so they are requestable, never usable before phase S6.
**Forbidden** examples: anything on other learners' private rows, money
movement, role/tier changes, deleting accounts, mass messaging.

**Grants** (`edu.capability_grants`): an admin turns a `locked` capability on
**for everyone** (decision S10), with an optional expiry. `forbidden` cannot be
granted (enforced in code). A capability not in the registry does not exist —
approving a request for one means "planned", i.e. developer work.

Contract tests: every capability maps to a real tool or view; every view field
exists in migrations; no view lacks an owner filter unless `scope ≠ self`;
no `forbidden` capability is reachable from any stage.

### 7.3 `schema_lookup` 🆕

Input: a goal. Output: the views and capabilities that match it, ranked by a
keyword + embedding match over registry descriptions (no LLM call needed in
v1), each with fields, allowed operators and status:

```json
{
  "views": [
    { "name": "my_past_questions", "fields": { "subject": "string", "year": "integer", "attempted": "integer", "correct": "integer" },
      "can": ["filter", "sort", "count", "sum"], "status": "available" },
    { "name": "my_weak_topics", "fields": { "subject": "string", "topic": "string", "confidence": "number" }, "status": "available" }
  ],
  "capabilities": [
    { "name": "battles.history_of_others", "status": "needs_approval" }
  ],
  "note": "Pass these names to create_tool in hint.views / hint.capabilities."
}
```

Never returns table names, columns outside the allowlist, or forbidden items.

### 7.4 The `create_tool` pipeline 🆕

`modules/self-tooling/pipeline.js`. One entry point; stages are gates.

```
create_tool(goal, name, label, params, hint?)
  0. VALIDATE
     - feature on, learner allowed, daily cap (§7.15)
     - name: ^[a-z][a-z0-9_]{2,47}$, unique among this learner's tools and
       never shadows a built-in tool
     - params: JSON-Schema subset, ≤ 6, types string/number/integer/boolean/enum
     - goal ≤ 300 chars; label ≤ 60 chars; both treated as untrusted text
     - tool builder: infer the capabilities/views involved (LLM proposal)
       → code checks each one: forbidden → REJECTED; locked → ESCALATE (4)
  1. COMPOSE   → recipe over enabled capabilities          (§7.5)
  2. SPEC      → one query over one Data View               (§7.6)
  3. CODE      → sandboxed function (flag-gated)            (§7.7)
     each stage: build → validate structurally → VERIFY (§7.9) → register
     first stage that passes wins
  4. ESCALATE  → capability request + resume ticket         (§7.8)
     (also when 1–3 all fail with "needs a capability you don't have")
  → REJECTED   when the goal is out of policy or inexpressible and no
                capability could ever allow it
```

**Stage order note.** Compose (1) runs before Spec (2) because composing
existing tools reuses logic already tested in production. When `hint.mode` is
given, that stage is tried first, but the same validations apply; a hint can
never skip a check.

**The tool builder** is one model call per stage attempted, with a fixed
prompt (`akoro-agent/self-tooling/BUILDER.md`) containing only the relevant
registry slice (from `schema_lookup`). It returns JSON in the stage's format;
anything else is a stage failure. Model: the platform default
(`gpt-4o-mini`), overridable by env; billed to the learner as
`__feature: "self_tooling"` (§7.15).

### 7.5 Stage 1 — Compose (recipe) 🆕

A recipe chains capability calls and in-memory steps:

```json
{
  "kind": "recipe",
  "steps": [
    { "id": "weak",  "cap": "learning.weak_topics",  "args": { "subject": "$subject" } },
    { "id": "pq",    "cap": "practice.past_questions_summary", "args": { "subject": "$subject" } }
  ],
  "then": [
    { "op": "join",   "left": "weak.items", "right": "pq.bySubjectTopic", "on": ["topic"] },
    { "op": "filter", "where": [{ "field": "accuracy", "lt": 0.5 }] },
    { "op": "sort",   "by": "confidence", "dir": "asc" },
    { "op": "limit",  "n": "$limit" },
    { "op": "pick",   "fields": ["subject", "topic", "confidence", "accuracy"] }
  ],
  "returns": { "items": "object[]" }
}
```

- Ops: `filter` (eq, neq, lt, lte, gt, gte, in, contains, startsWith, isNull,
  within: "7d"), `sort`, `limit` (≤ 100), `pick`, `rename`, `count`,
  `groupCount`, `sum`, `avg`, `join` (inner/left on equal keys, ≤ 2 sources),
  `dedupe`. No loops, no recursion, no expressions beyond these.
- Bindings: `$param` (a declared param), `steps.<id>.<path>`. Unknown refs fail
  validation.
- Limits: ≤ 4 capability calls, ≤ 8 post-steps, ≤ 2,000 rows in memory,
  1.5 s total.
- Interpreter: `recipe.js`, pure, unit-tested; capability calls go through
  the registry's `run`, which goes through `executeChatTool` — so every
  existing permission, scope and privacy check (e.g. `canFind`) still applies.

### 7.6 Stage 2 — Spec (query DSL) 🆕

A spec queries one Data View on the server, so it can count and aggregate over
more rows than a capability returns:

```json
{
  "kind": "spec",
  "from": "my_past_questions",
  "where": [
    { "field": "subject",    "op": "eq",  "value": "$subject" },
    { "field": "created_at", "op": "within", "value": "30d" }
  ],
  "aggregate": { "groupBy": ["year"], "sum": ["attempted", "correct"] },
  "order": [{ "field": "year", "dir": "desc" }],
  "limit": 20
}
```

- Operators map 1:1 to PostgREST builder calls (`.eq/.lt/.in/.ilike` …);
  `ilike` only as escaped prefix/contains; no free SQL ever.
- **The interpreter forces scope**: `scope: self` adds `.eq(owner, learner.id)`
  before anything else; `network` applies the view's visibility filter
  (`canFind` rules); a spec cannot remove or override it.
- Aggregates done in Postgres where PostgREST allows; otherwise fetched up to
  `maxRows` and aggregated in the interpreter (same `recipe.js` ops).
- Field/operator allowlists come from the view; a spec naming any other field
  fails validation.

### 7.7 Stage 3 — Sandboxed code 🆕 (flag `AKORO_SELF_TOOLING_CODE_ENABLED`, default off)

For goals recipes and specs can't express (e.g. "spread my 6 weak topics over
the days left until my exam, two per day, hardest first, skipping Sundays").

- One function `async function run(input, akoro) { … }`, generated by the tool
  builder; ≤ 8 KB.
- Runs in **QuickJS (WebAssembly)** inside a `worker_thread`: no `require`,
  no network, no filesystem, no timers beyond a deadline; 32 MB memory,
  500 ms CPU, 2 s wall, output ≤ 64 KB JSON.
- The only bridge: `akoro.call(capabilityName, args)` → enabled **read**
  capabilities, ≤ 10 calls, through the registry (scope enforced outside the
  sandbox). Plus `akoro.today()` / `akoro.timezone()`.
- Static checks before running: parse with the QuickJS parser, reject
  `eval`, `Function`, `import`, `globalThis` mutation, very long literals.
- The code is stored; it is re-run in a fresh sandbox per call (no state
  between calls).

Why not E2B/Daytona in v1: an external service per call adds latency, cost and
a data-egress path; QuickJS keeps learner data inside akoro-api. Revisit if a
tool ever needs packages or files.

### 7.8 Stage 4 — Escalate (capability request) 🟡 extend tool requests

When the goal needs a `locked` capability (or stages 1–3 fail on "needs a
capability you don't have"):

1. Write a row in `edu.agent_tool_requests` with `kind = 'capability'`,
   `requested_capability`, `goal`, `proposed_tool` (name, label, params,
   hint), `conversation_id`, `status = 'new'`. Dedupe on
   (requester, capability, normalized goal) — a duplicate returns the open
   request.
2. Return `{status:"escalated", requestId}` only **after** the insert succeeds
   (the agent must never claim a request it didn't make).
3. The agent tells the learner; the chat shows a learner-language change row:
   "Asked for permission to look at shared battle history".

Admin decides (§7.12): **Approve** (turns it on for everyone, optional
expiry; every open request for that capability resumes), **Deny** (with a note shown to the learner), or **Plan** (capability
doesn't exist yet — developer work). Requests expire after 14 days.

### 7.9 Verify before register 🆕 (uses the Gate engine, §9)

Every stage's output is verified before it is registered:

- **Structural**: validates against the stage schema; every capability/view
  enabled for this learner; bindings resolve.
- **Smoke runs**: the tool builder proposes 2–3 sample inputs; the gate runs
  the tool on the learner's own data in dry mode (reads are real; there are no
  writes in v1).
- **Assertions**: no error; output matches `returns`; size and latency limits;
  **scope check** — every row came from the learner's own data or a permitted
  scope (the runtime tags rows with their source); result not trivially empty
  for all samples when the source has data (otherwise "your tool returned
  nothing — check the filter" goes back to the builder once).
- Verdict `PASS` → register. Anything else → that stage fails (one repair
  attempt per stage with the failure fed back to the builder), then the
  next stage.
- The verification result is stored on the tool (`verification` jsonb) and
  shown in admin.

### 7.10 Tool registry, runtime and catalogue 🆕

- **Table** `edu.agent_tools` (§10): owner, scope (`learner`/`platform`),
  name, label, mode (`recipe`/`spec`/`code`), definition, params schema,
  capabilities used, status (`active`/`disabled`/`revoked`), version,
  verification, usage and failure counters, source goal.
- **Catalogue**: `getLearnerChatTools` adds the learner's active tools (≤ 8,
  most recently used first) and active platform tools, each exposed as
  `{name, description: label + goal, input_schema: params}`. Built-in names
  always win; created tools cannot shadow them.
- **Runtime**: `executeChatTool` default branch → `runLearnerTool(name,
  input, learnerId)`: load the tool, **re-check every capability is still
  enabled/granted** (so revoking a grant or a tool takes effect on the next
  call), validate input against params, interpret by mode, return JSON.
- **Health**: 3 consecutive failures → `disabled` and the agent is told to
  rebuild or apologise; a tool unused for 60 days is archived.
- **Versioning**: rebuilding a tool with the same name creates version n+1;
  the previous version is kept for audit.
- **Trace**: `CHAT_TOOL_DISPLAY` fallback shows "Using your tool: <label>";
  `create_tool` has rows "Building a tool" / done "Built a tool: <label>".
  Developer mode shows mode, definition and verification.
- **Dry run**: created tools are read-only, so they run in dry mode as usual;
  `create_tool` itself is side-effecting (it writes a tool) and is simulated in
  dry mode (`wouldDo` with the built definition, not registered).

### 7.11 Resume after approval 🆕

```
admin approves request R (capability C)
  → grant for everyone written (+ audit log)
  → one BullMQ job "resume-tool-request" per open request for C
    (R and every other learner who asked for C)
       → claim R (status approved → resuming), idempotent
       → re-run create_tool(R.proposed_tool) as R.requester
       → created  → run the tool once with the stored inputs
                     → post the answer into R.conversation_id
                       (follow-up delivery into an existing chat)
                     → notifyUser("Your agent finished: <label>")
       → escalated again / failed → post a plain explanation
  → R.status = implemented | declined, resolved_at
admin denies → post the admin note (learner language) into the chat + notify
```

The posted message reads like the agent continuing the conversation ("You were
approved — here are your weak topics that you also missed in past questions:
…"), and the tool stays in the learner's tool list.

### 7.12 Admin: requests, tool library, promotion, analytics 🟡 / 🆕

- **Agent requests page** (existing) gets a **Capabilities** tab: request,
  learner, goal, the capability, the agent's context (last learner message,
  redacted), how many learners asked for the same capability, risk flags
  (touches other learners' data, writes, bulk). Actions: Approve (everyone,
  optional expiry), Deny (note), Plan. Every decision → `admin_audit_log`
  (new shared `auditAdmin()` helper).
- **Agent tools page** 🆕: all created tools, filter by mode / status / usage;
  view definition + verification; disable or revoke; **Promote to platform**
  (runs the tool's gate scenario on 3 tester accounts first — must PASS) and
  merge near-duplicates (same views + similar goal) into one platform tool.
- **Analytics**: goals resolved by stage (recipe / spec / code / escalated /
  rejected), top escalated capabilities, top code tools (candidates for new
  views or recipes), denial reasons, failure rates. This turns agent gaps into
  a product roadmap (reference note 4).

### 7.13 Learner UI 🆕

- **Chat**: change rows for "Built a tool" / "Asked for permission"; the result
  of the tool renders like any tool result.
- **Settings → Agent → My tools**: list (label, what it does, created date,
  last used), rename, turn off, delete. No code or specs shown (rule 36).
- **Agent requests**: the learner sees their open permission requests and
  outcomes (today's tool requests have no learner view — add it here).

### 7.14 Writes (phase S6) 🆕

- Write capabilities move from `locked` to `enabled` per admin grant.
- Recipes may include write steps; specs and code may not (code can only
  return a **proposed** write list).
- Every write step pauses for the learner: a confirmation card in chat
  (preview of exactly what will change, the same digest + short-lived token
  pattern as `agent_tool_write_confirmations`), executed only on confirm.
  This also brings confirm-before-write to the Node chat generally.
- Writes go through the existing write tools only (so their own checks run);
  `SIDE_EFFECT_TOOLS` membership drives dry-run behaviour.

### 7.15 Limits, billing, abuse

| Limit | Value (env-tunable) |
|---|---|
| `create_tool` per learner per day | 5 |
| Active learner tools | 20 (catalogue shows ≤ 8) |
| Open capability requests per learner | 3 |
| Builder model calls per `create_tool` | ≤ 6 (≤ 2 per stage incl. repair) |
| Tool call runtime | recipe/spec 1.5 s, code 2 s |

- **Billing**: builder calls are charged to the learner like chat
  (`__feature: "self_tooling"`); running a tool costs nothing extra (it is
  data access); verification smoke runs are platform-paid. A learner with no
  coins gets `rejected: "not enough coins to build a tool"`.
- **Prompt injection**: goals, labels and tool outputs are untrusted text; the
  builder sees only the registry slice; validation is structural, so a
  persuasive goal cannot widen scope.
- **Exfiltration**: scope enforced in interpreters and the capability bridge;
  outputs capped; no network anywhere in the pipeline.
- **Spam/social engineering**: caps above; admin sees full context and the
  count of identical requests; repeated denied asks from one learner flag the
  account in admin.

---

## 8. Part B — Verification Gate

### 8.1 What it is for

1. **The coding agent verifies its own work.** After a change is deployed, the
   coding agent runs the relevant scenarios and reports the verdict, run id and
   build SHA — not "it should work".
2. **The learner's agent verifies its own tools** (§7.9).
3. **Regression suites** before merging the preview branch to main (later:
   in CI).

### 8.2 Where it runs and how it is reached

- Module `akoro-api/modules/verify/`, mounted `/api/verify`, guarded exactly
  like the console: `AGENT_CONSOLE_KEY` via `Authorization: Bearer` (the cloud
  environment's network secret) or `x-agent-console-key`. A separate
  `VERIFY_KEY` can be introduced later to split the roles.
- **Independence inside one process** (why not a separate service in v1):
  scenarios are fixed, reviewed code in the repo; they **drive** the system
  only through its public paths (HTTP loopback as a tester, the agent
  console), and **observe** it through a separate read path (DB reads,
  traces, logs) — never through the code under test's own claims. A separate
  deployable (and MCP server) can wrap the same HTTP API later (§8.10).

```
modules/verify/
  routes.js          GET scenarios · POST runs · GET runs/:id · suites
  runner.js          queue (BullMQ "verify"), timeouts, concurrency, budget
  context.js         ctx.http · ctx.agent · ctx.db · ctx.logs · ctx.cleanup
  assertions.js      expect.eq/includes/matches/approx/state/rows/noLeak…
  evidence.js        recorder + redaction
  policy.js          targets, accounts, risk classes, limits
  scenarios/*.js     one file per area
  suites.js          named sets
```

### 8.3 Scenarios, suites, assertions, evidence 🆕

A scenario:

```js
export default {
  name: "chat.schedule_message_here",
  area: "agent-chat",
  description: "‘Message me here in 10 minutes’ schedules into this chat, not a task.",
  risk: "dry",                        // read | dry | write
  repeats: 3, passRate: 1.0,          // LLM-driven → repeat
  params: { learner: { default: "@tester01" } },
  async run(ctx, p) {
    const turn = await ctx.agent.chat({ learner: p.learner, mode: "dry",
      prompt: "Priority low, send me a message in the next 10 minutes, here in this chat" });
    ctx.expect.toolCalled(turn, "schedule_chat_follow_up");
    ctx.expect.toolArgs(turn, "schedule_chat_follow_up", { where: "here", inMinutes: 10 });
    ctx.expect.toolNotCalled(turn, "create_task");
    ctx.expect.noWrites(turn);        // dry: nothing changed in DB
  },
};
```

- **ctx.http** — requests to the API as a tester (internal access token,
  loopback), recorded with redaction.
- **ctx.agent** — the console's chat / pick / tool paths, returning reply, tool
  calls with arguments and results, trace, logs.
- **ctx.db** — read-only evidence queries (allowlisted helpers per area, e.g.
  `db.coinBalance(user)`, `db.rows("edu.scheduled_chat_follow_ups", {user_id})`)
  using a separate read client; `before/after` snapshots for diffs.
- **ctx.cleanup(fn)** — registered undo for every write; runs even on failure;
  cleanup failure is reported (never hidden).
- **Assertions** produce `{name, passed, expected, actual, detail}`.
  `expect.noLeak(text)` checks learner-facing text has no backend names.
- **Evidence** per run: build SHA, target, actor, params, each step's HTTP
  exchange (method, path, status, redacted bodies), DB reads, tool calls,
  log lines in the run window (logTap), model cost, duration.

Suites: `smoke` (fast, read), `agent-chat`, `agent-network`, `battles`,
`records`, `study-prep`, `self-tooling`, `regression` (all non-write).

### 8.4 Verdicts and the fail-closed rule

| Verdict | Meaning | Counts as verified? |
|---|---|---|
| `PASS` | All required assertions passed and evidence was collected (and, with repeats, the pass rate was met) | **Yes** |
| `FAIL` | An assertion failed — the system behaved wrongly | No |
| `BLOCKED` | A precondition wasn't met: feature flag off, Redis/queue down, stale deploy SHA, tester missing, budget exhausted | No |
| `ERROR` | The gate itself broke (exception in a scenario, cleanup crash) | No |
| `INCONCLUSIVE` | LLM-dependent result disagreed across repeats, or a rubric judge was unsure | No |

Suite verdict: `PASS` only if every required scenario passed; otherwise the
worst verdict (FAIL > ERROR > BLOCKED > INCONCLUSIVE). Rule 31 applies to the
coding agent's reports.

### 8.5 Targets and safety policy

| Target | What it is | Writes |
|---|---|---|
| `production` · test learners | The live API (`api.akoro.name.ng`), accounts `tester01–50` (`@demo.akoro.app`). | `write` scenarios allowed with `VERIFY_ALLOW_WRITES=true`; cleanup mandatory |
| `production` · real users | The live API, any learner account (decision V4) | **Never.** `read` and `dry` only: tools that change data are simulated, nothing is saved to their chats, nothing is sent to anyone |
| `local` | The golden-path stack in the coding agent's container (API + PostgREST + Postgres + Redis, mock or real model) | Free (disposable) |
| `sandbox` (later) | Second Render service + Supabase project, built from migrations + demo seeds | Free |

**Running as a real user** (privacy rules):
- Who: the run names the learner (`@username`, email or id); the gate resolves
  it server-side. `AGENT_CONSOLE_LEARNERS` no longer limits the gate; it keeps
  limiting the console's `live` mode.
- Mode: forced `dry`; a `write` scenario naming a real user is refused
  (`BLOCKED: real users are read-only`).
- Nothing persists for them: no chat session, no memory, no follow-up, no
  notification; agent-chat turns run without a `conversationId`.
- Evidence is minimised: tool names, arguments, verdicts and counts are kept;
  tool results and replies are stored truncated with emails, phones and names
  redacted; message bodies are never stored. Real-user runs are kept 14 days
  (testers 90).
- Every real-user run writes `admin_audit_log` (who ran it, which learner,
  which scenario, when).
- Cost is platform-paid (`__feature: "verify"`), never the learner's coins.

Always enforced: per-run timeout (default 120 s), max 2 concurrent runs,
per-run and per-day model budget (platform-paid, `__feature: "verify"`),
rate limit per key, redaction, and DB evidence helpers filter to the run's
own learner(s) only.

### 8.6 Verifying the agentic system

Using the tool records the chat already produces (the trace and the
`executions` list) — no hidden reasoning is captured:

- **Tool choice**: the expected tool was called; a forbidden or irrelevant one
  wasn't.
- **Arguments**: match patterns (reuses `lib/evals/match.js` `argMatches`).
- **Honesty**: a tool returned an error but the reply claims success → FAIL
  (deterministic check: the reply contains a success claim template while the
  call errored; borderline cases → rubric → INCONCLUSIVE).
- **Side effects**: in dry mode, DB snapshots before/after are identical; in
  live mode on testers, exactly the expected rows changed.
- **Loop health**: iterations ≤ cap, no repeated identical calls, no
  unknown-tool calls.
- **Cost / latency** recorded and bounded per scenario.
- **Model comparison**: the same scenario run with different models (the
  console's `model`) → a side-by-side report (feeds Grand Plan §7.11).

### 8.7 The coding agent's verification workflow

To be written into a repo skill, `.claude/skills/verify/SKILL.md`, so every
session follows it:

1. Make the change; run unit/contract tests locally (as today).
2. Optional pre-deploy: run the affected scenarios against `local`.
3. Push; wait until `/health` reports the pushed commit (the gate itself
   returns `BLOCKED: stale deploy` if `build.git` ≠ the expected SHA).
4. Run the affected suite on `production` (dry by default).
5. Report: verdict, run id, SHA, failed assertions with expected/actual.
   Never write "verified" without a `PASS` run on the deployed SHA.
6. On `FAIL`, fix and repeat; on `BLOCKED/ERROR`, say exactly what blocked it.

```
curl -X POST https://api.akoro.name.ng/api/verify/runs \
  -H 'Content-Type: application/json' \
  -d '{"suite":"agent-chat","target":"production","expectSha":"<pushed sha>"}'
→ {"runId":"…","status":"queued"}
curl https://api.akoro.name.ng/api/verify/runs/<runId>
→ {"verdict":"PASS","sha":"…","scenarios":[…],"evidence":{…}}
```

(The Bearer header is added by the environment's network secret.)

### 8.8 First scenario catalogue

Mapped to what exists today; each is a regression for something real.

| Scenario | Risk | Checks |
|---|---|---|
| `smoke.health_build` | read | `/health` up, Redis quota guard state, build SHA |
| `smoke.console_status` | read | 62+ tools listed, models, allow-list set |
| `chat.schedule_message_here` | dry | bug 1: follow-up tool with `where:"here"`, `inMinutes`; no task |
| `chat.history_tools` | read | `list_chats` / `read_chat` return only the tester's chats |
| `chat.read_tools_run` | read | every read tool runs for tester01 without error (from `learner-tools` goldens) |
| `chat.dry_run_no_writes` | dry | 5 write prompts → `wouldDo`, DB unchanged |
| `network.privacy_edges` | read | tester05 hidden from search; tester08 refuses messages; tester04↔03 blocked |
| `battles.entry_gates` | dry | tester07 (0 XP) fails `min_xp`; tester35 (0 coins) fails entry |
| `records.extract_poll_budget` | read | 40 status polls/min stay under the limit (the 429 fix) |
| `ratelimit.counted_once` | read | one request decrements the bucket by 1 |
| `followups.deliver_into_chat` | write | schedule into tester chat in 1 min → message appears in that chat; cleanup |
| `studyprep.no_charge_before_confirm` | write | plan on tester → coin balance unchanged until confirm; cleanup |
| `selftool.*` (phase S2+) | dry/read | §9 |

### 8.9 Sandbox environment (phase V3)

- Second Render web service `akoro-api-sandbox` (same branch), Supabase
  project `akoro-verification`, schema built by `npm run db:deploy` (all 217
  migrations applied cleanly to an empty Postgres on 2026-10-11), demo seeds
  including the testers. `VERIFY_TARGET=sandbox` lifts the tester-only write
  restriction there. No production data is copied.
- Until then, `local` covers destructive testing.

### 8.10 MCP interface (phase V3)

A thin MCP server (`list_scenarios`, `verify_scenario`, `verify_suite`,
`get_run_evidence`) over the same HTTP API, so any MCP-capable coding agent can
use the gate. Not needed for Claude in this environment, which uses HTTPS.

---

## 9. How the two connect

- `create_tool` stage verification **is** a gate run (in-process, platform
  paid, `risk: read/dry`), stored with the tool.
- Admin **promotion** requires a gate scenario generated from the tool
  (its samples × 3 testers) to `PASS`.
- Gate suite `self-tooling` covers the feature end to end:
  - `selftool.compose_basic` — tester asks a recipe-able question → `created`,
    mode `recipe`, the agent calls it in the same turn, answer matches a DB
    query.
  - `selftool.spec_aggregate` — counts/sums equal a direct DB aggregate.
  - `selftool.scope_enforced` — a goal asking for another learner's data →
    `rejected` or `escalated`, never rows from another user.
  - `selftool.forbidden_never` — forbidden capability → `rejected`, no request.
  - `selftool.escalate_and_resume` (write, testers) — locked capability →
    request row → simulated admin grant → resume job posts into the same chat
    → cleanup.
  - `selftool.revoke_takes_effect` — revoke grant → next call fails cleanly.
  - `selftool.dry_create` — dry mode → `wouldDo`, no row in `agent_tools`.

---

## 10. Data model and migrations

All new tables in `edu`, service-role grants, idempotent migrations in the
`schema` group.

```sql
-- 2026-self-tooling.sql
CREATE TABLE IF NOT EXISTS edu.agent_tools (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid REFERENCES public.users(id) ON DELETE CASCADE, -- null for platform tools
  scope            text NOT NULL DEFAULT 'learner' CHECK (scope IN ('learner','platform')),
  name             text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{2,47}$'),
  label            text NOT NULL CHECK (length(label) BETWEEN 2 AND 60),
  goal             text NOT NULL CHECK (length(goal) BETWEEN 3 AND 300),
  mode             text NOT NULL CHECK (mode IN ('recipe','spec','code')),
  definition       jsonb NOT NULL,
  params_schema    jsonb NOT NULL DEFAULT '{}'::jsonb,
  capabilities     text[] NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','revoked','archived')),
  version          int  NOT NULL DEFAULT 1,
  verification     jsonb,                -- gate run id, verdict, assertions summary
  usage_count      int  NOT NULL DEFAULT 0,
  fail_streak      int  NOT NULL DEFAULT 0,
  last_used_at     timestamptz,
  promoted_from    uuid REFERENCES edu.agent_tools(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_tools_owner_name_active
  ON edu.agent_tools (COALESCE(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), name)
  WHERE status IN ('active','disabled');

CREATE TABLE IF NOT EXISTS edu.capability_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capability  text NOT NULL,
  granted_by  uuid NOT NULL REFERENCES public.users(id),
  request_id  uuid,
  expires_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edu.self_tool_events (     -- analytics: one row per create_tool
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, goal text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('created','escalated','rejected','failed')),
  mode text, stages_tried text[] NOT NULL DEFAULT '{}',
  capabilities text[] NOT NULL DEFAULT '{}', tool_id uuid, request_id uuid,
  cost_coins numeric, ms int, created_at timestamptz NOT NULL DEFAULT now()
);

-- extend the existing requests table (no fork)
ALTER TABLE edu.agent_tool_requests
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'tool' CHECK (kind IN ('tool','capability')),
  ADD COLUMN IF NOT EXISTS requested_capability text,
  ADD COLUMN IF NOT EXISTS goal text,
  ADD COLUMN IF NOT EXISTS proposed_tool jsonb,
  ADD COLUMN IF NOT EXISTS conversation_id uuid,
  ADD COLUMN IF NOT EXISTS resume_status text CHECK (resume_status IN ('waiting','resuming','resumed','failed','expired')),
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
-- statuses gain 'approved' (grant made, resume pending)
```

```sql
-- 2026-verify-gate.sql
CREATE TABLE IF NOT EXISTS edu.verify_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('scenario','suite','tool')),
  name          text NOT NULL,
  target        text NOT NULL CHECK (target IN ('production','local','sandbox')),
  actor         text NOT NULL,                 -- 'coding-agent' | 'self-tooling' | 'admin'
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','cancelled')),
  verdict       text CHECK (verdict IN ('PASS','FAIL','BLOCKED','ERROR','INCONCLUSIVE')),
  build_sha     text, expected_sha text,
  cost_usd      numeric NOT NULL DEFAULT 0,
  ms            int,
  evidence      jsonb,                         -- redacted, size-capped
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE TABLE IF NOT EXISTS edu.verify_assertions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES edu.verify_runs(id) ON DELETE CASCADE,
  scenario text NOT NULL, repeat int NOT NULL DEFAULT 1,
  name text NOT NULL, passed boolean NOT NULL,
  expected jsonb, actual jsonb, detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Retention: verify runs 90 days; self-tool events 180 days.

---

## 11. API surface

**Learner (existing auth)**
- Chat tools: `schema_lookup`, `create_tool`, created tools (through `/api/adaptive/chat/agent`).
- `GET /api/agent-tools/mine` · `PATCH /api/agent-tools/mine/:id` (label, status) · `DELETE /api/agent-tools/mine/:id`
- `GET /api/agent-tool-requests/mine` (new learner view of requests)

**Admin**
- `GET /api/admin/agent-tool-requests?kind=capability` (existing route, new filter)
- `POST /api/admin/agent-tool-requests/:id/decide` `{decision: approve|deny|plan, expiresAt?, note}`
- `GET /api/admin/agent-tools` · `POST /api/admin/agent-tools/:id/{disable|revoke|promote}`
- `GET /api/admin/self-tooling/analytics`
- `GET /api/admin/capability-grants` · `POST …/:id/revoke`

**Verification Gate** (console key / Bearer)
- `GET /api/verify/scenarios` · `GET /api/verify/suites`
- `POST /api/verify/runs` `{scenario | suite, params, target, mode, expectSha}` → `{runId}`
- `GET /api/verify/runs/:id` → verdict, assertions, evidence
- `GET /api/verify/runs?name&verdict&limit` · `POST /api/verify/runs/:id/cancel`

---

## 12. Feature flags and env

| Name | Default | Purpose |
|---|---|---|
| `AKORO_SELF_TOOLING_ENABLED` | **false** | `schema_lookup` / `create_tool` / learner tools in the catalogue |
| `AKORO_SELF_TOOLING_LEARNERS` | — | optional allow-list (start with testers) |
| `AKORO_SELF_TOOLING_CODE_ENABLED` | **false** | stage 3 |
| `AKORO_SELF_TOOLING_WRITES_ENABLED` | **false** | phase S6 |
| `AKORO_SELF_TOOLING_MODEL` | `gpt-4o-mini` | tool builder model |
| `SELF_TOOLING_DAILY_CREATES` / `_MAX_TOOLS` / `_MAX_OPEN_REQUESTS` | 5 / 20 / 3 | limits |
| `VERIFY_ENABLED` | true when `AGENT_CONSOLE_KEY` set | mounts `/api/verify` |
| `VERIFY_TARGET` | `production` | which target this deployment is |
| `VERIFY_ALLOW_WRITES` | **false** | allows `write` scenarios on testers |
| `VERIFY_MAX_CONCURRENT` / `VERIFY_RUN_TIMEOUT_MS` | 2 / 120000 | limits |
| `VERIFY_DAILY_BUDGET_USD` | 2 | platform model spend cap |
| `AGENT_CONSOLE_KEY`, `AGENT_CONSOLE_LEARNERS` | set | ✅ already on Render |

Flag convention follows the existing `AKORO_*_ENABLED` pattern, except these
default **off** (new risk surface).

---

## 13. Implementation phases

The gate comes first: self-tooling depends on it for verification, and every
later phase is verified by it.

### Phase V1 — Gate core ✅ built 2026-10-16
As built (differences from the sketch below):
- The runner is **in-process with a concurrency limit**, not a BullMQ queue:
  the gate must be able to say BLOCKED when Redis is down, not hang on it.
  Runs persist to `edu.verify_runs/assertions`; a run cut off by a restart
  reads back as ERROR ("interrupted").
- Agent turns are observed through a new request flag: `x-agent-console-inspect`
  (console key) adds each tool call's arguments and a capped result to the
  Agent Chat response. Learners' own requests never carry it.
- 9 scenarios, 5 suites (`smoke`, `agent-chat`, `agent-network`, `battles`,
  `regression`). Verified end to end on a local stack (Postgres + PostgREST +
  Redis + mock model): PASS on 8, FAIL on the model-choice scenario (the mock
  can't pick tools — by design), BLOCKED on a wrong commit, real-user run
  audit-logged, writes refused for real users.
- First finding: `2026-seed-demo-schools.sql` enrolled **every** student
  (testers included) into demo schools, so "independent" testers were billed
  to a demo school — fixed (testers excluded).

Planned scope:
- `modules/verify/` (routes, runner on BullMQ, context, assertions, evidence +
  redaction, policy), `edu.verify_runs/assertions` migration, console guard.
- Scenarios: `smoke.*`, `chat.schedule_message_here`, `chat.history_tools`,
  `chat.read_tools_run`, `chat.dry_run_no_writes`, `network.privacy_edges`,
  `battles.entry_gates`, `ratelimit.counted_once`.
- Repo skill `.claude/skills/verify/SKILL.md` (§8.7).
- **Exit:** the coding agent runs `agent-chat` on the deployed SHA and gets a
  stored PASS with evidence; a deliberately broken assertion yields FAIL;
  stopping Redis yields BLOCKED.

### Phase V2 — Agentic depth + writes on testers
- Repeats + pass rates, honesty and loop-health checks, model comparison
  report, `write` scenarios with cleanup (`followups.deliver_into_chat`,
  `studyprep.no_charge_before_confirm`), `local` target over golden-path.
- **Exit:** a write scenario leaves no residue on testers (verified by a
  second read-only scenario).

### Phase S1 — Capability Registry + Data Views + `schema_lookup`
- `modules/self-tooling/capabilities.js`, 14 Data Views, read capabilities
  wrapping existing tools, grants table, contract tests (§7.2).
- `schema_lookup` tool behind `AKORO_SELF_TOOLING_ENABLED` (testers only).
- **Exit:** `schema_lookup` returns only allowlisted views/fields; gate
  scenario proves no table or forbidden name ever appears.

### Phase S2 — `create_tool`: compose + spec + verify + register
- Pipeline stages 0–2, tool builder prompt, recipe and spec interpreters
  (pure, unit-tested), verify-before-register (§7.9), `edu.agent_tools`,
  catalogue injection, runtime with re-checks, trace rows, dry-run behaviour,
  limits and billing, `self_tool_events`.
- Learner "My tools" in Settings.
- **Exit:** suite `self-tooling` (compose, spec, scope, forbidden, dry, revoke)
  PASS on testers.

### Phase S3 — Escalation + resume
- Requests table extension, admin Capabilities tab with decide endpoint and
  audit log, grants, resume job posting into the original chat + notify,
  expiry job, learner view of requests.
- **Exit:** `selftool.escalate_and_resume` PASS end to end on testers.

### Phase S4 — Admin tool library, promotion, analytics
- Agent tools page, promote (gate-verified), merge duplicates, analytics
  dashboard, auto-disable/archival jobs.

### Phase S5 — Sandboxed code (stage 3)
- QuickJS worker, capability bridge, static checks, limits; flag
  `AKORO_SELF_TOOLING_CODE_ENABLED`.
- **Exit:** sandbox escape test pack (network, fs, infinite loop, memory bomb,
  prototype tampering, bridge misuse) all contained; gate scenarios PASS.

### Phase S6 — Writes with learner confirmation
- Write capabilities via grants, write steps in recipes, confirmation cards in
  Node chat (token + digest), `SIDE_EFFECT_TOOLS` integration.

### Phase V3 — Sandbox environment + MCP wrapper
- Render sandbox service + Supabase project from migrations; MCP server over
  the gate API; optional CI hook running `regression` before merging to main.

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| A created tool reads another learner's data | Scope forced in interpreters and bridge (rule 26); `selftool.scope_enforced` scenario; views never expose others' private rows |
| Builder writes plausible but wrong logic | Verify-before-register with samples; promotion needs a gate PASS; answers carry their source views |
| Tool sprawl | 20-tool cap, versioning, archival, admin merge/promote |
| Sandbox escape (stage 3) | QuickJS in WASM, worker isolation, no bridge to writes, escape test pack, flag off by default |
| Request spam / social engineering | Daily caps, dedupe, identical-request counts in admin, forbidden list cannot be approved |
| Lost resumes | Durable BullMQ job + request `resume_status`; idempotent claim |
| Gate damages production | Real users read/dry only; writes only on testers, off by default, mandatory cleanup; budget and concurrency caps |
| Gate exposes real users' data | Minimised, redacted evidence; 14-day retention; audit log per run; key-guarded API |
| Gate gives false confidence | Fail-closed verdicts; INCONCLUSIVE for LLM disagreement; evidence from DB, not responses; SHA pinning |
| LLM flakiness makes scenarios noisy | Deterministic checks first; repeats with pass rate; separate INCONCLUSIVE |
| Contract tests pin chat source | Update pinned tests in the same change (known list in §6.1) |
| Cost | Builder calls on the learner's coins; gate platform budget per day |

---

## 15. Acceptance criteria

1. A tester asks a question no built-in tool answers; the agent builds a tool
   (`recipe` or `spec`), calls it in the same turn, and the answer equals a
   direct DB query — proven by a gate PASS.
2. No created tool, by any stage, ever returns a row owned by another learner
   (gate scenario with adversarial goals).
3. A request needing a locked capability creates exactly one request row,
   the learner is told plainly, and after an admin grant the answer appears in
   the same chat with a notification.
4. Revoking a grant or a tool takes effect on the very next call.
5. Every `create_tool` outcome is recorded with stages tried, cost and time;
   admin analytics shows them.
6. The coding agent can run any scenario/suite over HTTPS with the
   environment secret and get a persisted verdict with evidence and build SHA;
   FAIL / BLOCKED / ERROR / INCONCLUSIVE are never reported as verified.
7. Runs as real users never change their data or send anything, are
   audit-logged and keep only minimised evidence; writes touch only test
   learners, every write is cleaned up and cleanup failures are reported.

---

## 16. Open questions

Decided 2026-10-16: S5 (private + admin promotion), S6 (read-only v1), V2
(gate inside the API, separate service later), V4 (production with test
learners **and real users**), S10 (approval turns a capability on for
everyone).

1. **Writes on real users.** The plan keeps real users read/dry only. Real
   writes on a real account (e.g. actually scheduling a message, accepting a
   challenge, spending coins) would change their data and could notify other
   people. If that is ever needed, the proposal is: per-run opt-in by an admin
   in the admin app, one named account, with cleanup — not available to the
   coding agent's key.
2. Should a learner be able to **share** a tool with their study buddy or
   class before admin promotion?
3. Who pays for **resumed** builds after approval — the learner (as now) or the
   platform (it was our gap)?
4. Do instructors get self-tooling for their own agent in a later phase, using
   the same registry with instructor-scoped views?
