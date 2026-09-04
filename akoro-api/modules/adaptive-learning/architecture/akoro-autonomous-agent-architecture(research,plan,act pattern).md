# Akoro Agent: Research → Plan → Act Pattern

Grounded directly in OpenCode's source (`session/prompt/plan-mode.txt`, `tool/todo.ts`, `agent/prompt/explore.txt`) — not a paraphrase of the concept, the actual mechanism. Companion to [[akoro-autonomous-agent-architecture]] (automations/heartbeat/lanes) and [[akoro-agent-upgrade-plan]] (Tools/Skills/Workflows) — read those first if you haven't; this doc refines the "Workflow" layer specifically.

## What OpenCode actually does (not the vibes version)

When you type a coding request, OpenCode doesn't just "think a bit then run commands." It runs a **5-phase state machine**, and — this is the important part — **Phase 1 is not allowed to touch anything**:

1. **Explore** — dispatches a dedicated `explore` subagent (a separate, narrowly-prompted agent instance) that can *only* use read-only tools: `Glob`, `Grep`, `Read`, `Bash` for listing — explicitly forbidden from creating files or changing system state. Up to 3 of these can run **in parallel** if the task's scope is uncertain; just 1 if it's a small targeted change.
2. **Plan/Design** — a separate `Plan` subagent synthesizes the exploration findings into a concrete implementation approach. It's told to consider explicit alternative angles (for a bug fix: root cause vs. workaround vs. prevention; for a new feature: simplicity vs. performance vs. maintainability).
3. **Review/Synthesis** — the main agent reads the critical files the subagents flagged, and asks the *user* clarifying questions before finalizing anything.
4. **Final Plan** — written to an actual plan file, reviewable.
5. **Explicit exit** — the agent calls a dedicated `plan_exit` tool. This is a hard state transition: **nothing executable runs until this tool is called.** The system prompt is explicit: *"you MUST NOT make any edits... or otherwise make any changes to the system. This supersedes any other instructions you have received."*

The mechanism that makes the "thinking" visible to the user isn't a chat bubble — it's a dedicated `todowrite` tool. The agent calls it to write/update a structured todo list as it works, and that list *is* the live status trace you see in the UI. It's not narration bolted on after the fact — the todo list is a real tool call with real state, which the UI just happens to render step-by-step.

## Mapping onto Akoro

| OpenCode concept | Akoro equivalent | Status |
|---|---|---|
| Explore subagent (read-only, narrow) | A research step using only read-only tools: `fetch_student_data`, decay-engine state, syllabus lookup | Tools exist (`fetch_student_data`); not yet gated as "research-only" |
| Plan subagent (synthesizes into approach) | A Skills-layer function — `topicPrioritization`, `difficultyCalibration` — decides *what* to actually do with the research | This is the Skills gap flagged in [[akoro-agent-upgrade-plan]] |
| Hard phase gate (no execution until `plan_exit`) | No consequential tool (`create_battle`, wallet spend, saving a generated quiz) runs until a plan step completes | Doesn't exist yet — currently `extractIntent()` → tools run in one shot, no gate |
| `todowrite` tool (live, real state) | The step-trace UI already built (`akoro-chat-workflow.html`) — currently **faked** with `setTimeout` | UI shape is right; data source is fake |
| Parallel explore agents (up to 3) | Overkill for Akoro — see note below |

## The one place I'd deliberately scale this down, not up

OpenCode launches full parallel subagent instances for research because a coding agent's context (an entire unfamiliar codebase) is genuinely that large and uncertain. Akoro's research step is much narrower — "what's this student's confidence on Photosynthesis, and their recent battle history" is 1-3 fast DB reads, not an open-ended codebase search. Spinning up parallel LLM subagent calls for that would add latency and cost for no real benefit, and your userbase (students, ₦-denominated pricing) is cost-sensitive in a way OpenCode's isn't.

**Right-sized version for Akoro:** the "Explore" phase should be plain parallel tool calls (`Promise.all([fetchStudentData(), fetchDecayState()])`), not parallel LLM subagent dispatch. Reserve an actual subagent-style dispatch (a second LLM call with its own narrow prompt) for the **Plan** phase only — where synthesis/judgment genuinely benefits from a model call — matching how your existing Skills layer (once extracted per the other doc) would work.

## Concrete design for Akoro's version

**Phase 1 — Research** (fast, read-only, no LLM call needed for simple cases):
- Pull whatever the workflow's Skill function will need: confidence scores, recent battle results, due tasks, syllabus topics.
- Runs as plain tool calls, in parallel where independent. Streamed to the frontend as todo items appearing (`"Checking your confidence on Photosynthesis"` → done, `"Pulling recent battle history"` → done).

**Phase 2 — Plan** (one Skill-layer LLM call):
- Takes the research output, decides the concrete approach: which topic, what difficulty, how many questions, whether to recommend a battle or a review session.
- For **low-stakes workflows** (`explain_concept`, `quiz_me` practice with no wallet/grading impact): plan and act can collapse into the same step — no need for a hard gate, matches OpenCode's own "skip agents for trivial tasks" guidance.
- For **consequential workflows** (spending wallet coins, creating a real battle invite, submitting a grade) — this is exactly the authority boundary from [[akoro-autonomous-agent-architecture]] — the plan should be shown to the student/instructor as a distinct step before Act runs, not silently executed.

**Phase 3 — Act**:
- The actual tool(s) run: `generate_quiz`, `create_battle`, etc.
- Result streamed back, todo item marked done, trace collapses to the summary pill (UI already built for this).

**The todo list itself should be a real tool**, not a hardcoded per-intent array. Right now the frontend's `WORKFLOWS` object hardcodes fixed step lists per intent. The OpenCode pattern argues for the backend agent *deciding and writing* its own step list at Plan time (via a `todowrite`-equivalent), which the frontend then just renders — this is more flexible (a workflow's steps can vary based on what Research actually found) and it's one less thing to keep in sync between frontend and backend.

## What to actually build, in order

1. Add a `todowrite`-equivalent tool to `modules/tasks/tools/` — takes a list of `{status, label}` items, persists them against the task/session, and is what the backend streams to the frontend trace UI (replacing the frontend's hardcoded `WORKFLOWS` steps entirely).
2. Extract the Skills layer (already planned) — but now explicitly frame each Skill function as the "Plan" phase: it takes research output in, returns a decision + the todo list for what Act will do.
3. Pick one workflow — `exam_prep` is still the right first candidate — and wire it through all three phases for real, replacing the simulated timeouts.
4. Only for consequential workflows, add the explicit gate: don't call the Act-phase tool until the plan step has been shown (chat message or UI card) and, where money/grades are involved, confirmed.



Here's the full picture, straight from the source (not the docs, which are stubs) — `.opencode/skills/`, `packages/core/src/plugin/skill.ts`, and `packages/opencode/src/tool/skill.txt`.

**The actual skills OpenCode uses on itself (2 real ones):**

| Skill | Triggers on | What it does |
|---|---|---|
| **`effect`** | Any Effect v4/effect-smol TypeScript work in the repo | Tells the agent to stop relying on training-data memory of Effect (which is likely stale/wrong for v2/v3 vs v4), clone the actual `effect-smol` source into `.opencode/references/`, and grep that source for real APIs before writing any Effect code. Also fixes testing conventions (`testEffect`, `it.live` for real filesystem/git/network behavior). |
| **`rtl-aware-development`** | Implementing/reviewing RTL/LTR behavior — CSS, menus, scrolling, icons, Electron title bars | A genuinely detailed style guide: use logical CSS properties (`padding-inline-start`) over physical ones (`padding-left`), isolate mixed-direction text with `<bdi>`, don't naively mirror everything (back/forward arrows yes, brand logos/clocks/charts no), handle the fact that RTL `scrollLeft` can be negative. |

**Plus one built-in, framework-level skill** (`customize-opencode`, defined directly in `plugin/skill.ts`, not as a `.opencode/skills/` folder): triggers only when the user is editing OpenCode's *own* config — `opencode.json`, files under `.opencode/`, or creating agents/subagents/commands/skills/plugins/MCP servers/permission rules. Explicitly scoped to never fire on the user's actual application code.

**How triggering actually works** — this is the mechanism worth stealing conceptually: skill *descriptions* (not names) get listed in the system prompt, and there's a dedicated `skill` tool whose entire job is: *"Load a specialized skill when the task at hand matches one of the skills listed in the system prompt... The skill name must match one of the skills listed in your system prompt."* So the model itself reads the description, decides relevance, and calls `skill(name)` to pull the full `SKILL.md` content into context on demand — it's not preloaded, it's fetched only when the description matches.

**Worth being honest about:** two more `SKILL.md` files exist (`cloudflare`, `agents-sdk`) but they live under `test/fixture/skills/` — they're test fixtures for verifying the skill-loading mechanism itself, not skills OpenCode actually uses when coding on its own repo. So the real, active count is 2 domain skills + 1 framework-config skill, not 4.

**For Akoro:** this is a cleaner, cheaper pattern than a hardcoded workflow-per-intent list — instead of your `extractIntent()` keyword match deciding everything up front, you could define a small set of `SKILL.md`-style files (e.g. a "WAEC syllabus conventions" skill, a "Nigerian curriculum grading scale" skill) with trigger descriptions, list them in the tutoring agent's system prompt, and let the model itself decide when to pull one in via a `skill()` tool call — visible in the same step-trace UI, as a `"Loading WAEC syllabus skill"` step.
