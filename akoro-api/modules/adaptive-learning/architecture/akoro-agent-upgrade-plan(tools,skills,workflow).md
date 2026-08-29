# Akoro Agent Upgrade Plan — Tools, Skills, Workflows

**Purpose of this doc:** a handoff reference for whichever Claude session (or you) picks this up when it's time to wire the chat UI to a real backend. It's grounded in what's actually in `akoro-api` right now — not the generic framework from the pasted docs — so read this before re-deriving anything from scratch.

## The headline finding: two of the three layers already exist

The Tools/Skills/Workflow framework you were pitched isn't a from-scratch build. Checking `modules/tasks/`:

| Layer | Status | Where |
|---|---|---|
| **Tools** | ✅ Built — 18 tools | `modules/tasks/tools/index.js` (`ALL_TOOLS`) |
| **Workflow router** | ✅ Built — keyword classifier | `modules/tasks/lib/context.js` (`extractIntent()`) |
| **Workflow → tool mapping** | ⚠️ Built, but flat | `modules/tasks/tools/index.js` (`TOOLS_BY_TYPE`) |
| **Skills** | ❌ Not formalized | Reasoning is ad hoc, inline per-tool via `_llm.js` |

**And a nice surprise:** `extractIntent()`'s keyword lists (`"quiz me"`, `"test me"`, `"explain"`, `"what is"`, `"study plan"`, `"plan my"`, `"remind me"`, `"challenge"`, `"battle"`, `"duel"`...) are **near-identical** to the intent regexes I hardcoded into the frontend chat's simulated workflow trace, built independently earlier in this conversation. That wasn't planned — it means the UI prototype is already accidentally aligned with the real router, which makes wiring them together later much less work than it could have been.

## Layer 1: Tools (exists, complete enough to start)

`ALL_TOOLS` in `modules/tasks/tools/index.js` — 18 tools, each with a `definition` + `execute`:

`generate_quiz`, `quiz_me`, `explain_concept`, `create_study_plan` (study-plan.js), `set_study_reminder`, `challenge_peer`, `create_battle`, `send_reminder`, `grade_submissions`, `fetch_student_data`, `schedule_session`, `export_report`, `lesson_plan_fill`, `worksheet_fill`, `report_writing`, `exam_prep`, `attendance_rollcall`, `interactive_material`.

There's also a **dynamic tool system** (`tools/dynamic.js`) — partner/instructor-specific tools loaded per creator at runtime and unioned with the static set (`getToolsForTask()`), config-only, admin-registerable via `POST /admin/tools` with their own `intent_keywords`. This is more advanced than the pasted docs assumed — you already support tenant-specific tools, not just a fixed global set.

**Nothing needed here to start** — this layer is genuinely usable as-is.

## Layer 2: Workflow router (exists, works, is shallow)

`extractIntent(title, description)` — pure keyword matching against `text.includes(k)`, returns `{ taskType, payload: {} }`. `TOOLS_BY_TYPE` then maps each `taskType` to an ordered array of tools to run.

**The gap:** this is single-shot. `quiz_me` maps to `[tool("quiz_me")]` — one tool call, done. The pasted docs' actual value (the Phase 1→4 loop: diagnostic → plan → **test/branch/retest loop per topic** → mock exam) doesn't exist yet. Right now there's no stateful, multi-step, branching workflow — just "classify intent, call tool(s) once."

This matters because the two workflows worth building the phased loop for first are the ones that already conceptually need it: `exam_prep` and `quiz_me`/`generate_quiz` — the "test topic → if <70% show Learn button → retest → else next topic" loop is exactly what `orchestrator.js` and `decayEngine.js` already do for the autonomous side (Phase 2/3 in the earlier architecture doc). **Don't build two separate looping systems** — the exam-prep workflow loop and the decay-engine review loop should likely share the same underlying phase-state machine.

## Layer 3: Skills (the actual gap)

Right now, reasoning happens inline: each tool executor calls `llmText()`/`llmJson()` from `_llm.js` directly with its own ad hoc prompt. There's no shared, named, reusable reasoning function — no standalone `KnowledgeGapAnalysis`, `DifficultyCalibration`, `TopicPrioritization`, etc. that multiple tools or workflows could call.

**Why formalize this:** right now if `quiz_me` and `exam_prep` both need "figure out which topic the student is weakest in," that logic is presumably duplicated (or missing) in both tool files. A shared `skills/` directory — `knowledgeGapAnalysis.js`, `difficultyCalibration.js`, `topicPrioritization.js`, `progressSynthesis.js` — each a small function wrapping `llmJson()` with a fixed, tested prompt — lets every tool and workflow call the same reasoning instead of re-deriving it. This is the actual missing piece from the pasted framework, not the router or the tools.

## Connecting this to the earlier architecture doc

The [[akoro-autonomous-agent-architecture]] refinements (automations vs. heartbeat, per-agent lane serialization, memory tiering, authority boundaries) aren't a separate initiative — they're the execution substrate this Tools/Skills/Workflow system should run on:

- **Automations** (deterministic DB triggers) are what *starts* a workflow autonomously — e.g. `knowledge_confidence < 0.35` → auto-start the `exam_prep`-style phased loop for that topic, no chat message needed.
- **Lane serialization** applies directly to workflow execution — a student's `exam_prep` loop and a decay-triggered review shouldn't run concurrently against the same agent state.
- **Skills** (this doc's Layer 3) and **heartbeat** (the earlier doc's cheap judgment layer) are close cousins — both are "small, named LLM calls with a narrow job," just triggered differently (skills are called *by* a workflow step; heartbeat calls itself on a timer to decide if anything needs surfacing).
- **Authority boundaries** apply per-tool: `fetch_student_data`, `grade_submissions`, `export_report` should probably require an authenticated instructor context regardless of which workflow calls them — worth an explicit allow-list per role rather than assuming task-type gating is enough.

## Connecting this to the frontend chat prototype

The chat UI already built (`akoro-chat-workflow.html`) simulates exactly this shape — a `WORKFLOWS` array keyed by intent regex, each with an ordered `steps()` array rendered as a live trace, collapsing to a summary pill. When it's time to wire it up:

1. Backend: `POST /api/tasks` already calls `extractIntent()` → gets `taskType` → `getToolsForTask()` resolves the real tool list.
2. Stream step-by-step progress (tool started / tool finished / result) over SSE or websocket as each tool in the resolved array runs.
3. Frontend: replace `runWorkflow()`'s `setTimeout`-based fake steps with real events from that stream — the step-list/collapse-to-pill UI itself doesn't need to change, just its data source.
4. The intent-to-workflow mapping in the frontend's `WORKFLOWS` array should be deleted in favor of trusting whatever `taskType` the backend's `extractIntent()` actually returned — right now they're two independent copies of similar logic that could drift.

## Suggested build order, when you're ready

1. **Extract Skills** — pull the reasoning out of 2-3 existing tools (`quiz_me`, `exam_prep`, `explain_concept` are good candidates) into named, shared functions in a new `modules/tasks/skills/` directory. Low risk — internal refactor, no behavior change.
2. **Pick one workflow to make truly phased** — `exam_prep` is the best candidate since it conceptually already wants Diagnostic → Plan → Loop → Mock Exam. Add a `workflow_runs` table (current phase, current topic index, scores so far) so the loop survives across chat turns instead of being one-shot.
3. **Stream real step events** for that one workflow, wire the existing frontend trace UI to it end to end, confirm the UX holds up with real latency (LLM calls are slower than the simulated 500-900ms steps).
4. **Only then** generalize the phased-loop pattern to other workflows, and extend automations/heartbeat/lane-serialization from the architecture doc around it.

Resist doing all four at once — step 3 (one real workflow, fully wired, UI included) is the actual proof that the pattern works end to end; everything after that is repetition, not new risk.
