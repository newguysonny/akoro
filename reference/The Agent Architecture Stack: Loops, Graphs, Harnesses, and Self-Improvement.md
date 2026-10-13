# The Agent Architecture Stack: Loops, Graphs, Harnesses, and Self-Improvement

A consolidated reference combining five perspectives on building reliable, multi-agent AI systems: loop design, graph coordination, dynamic workflows, harness engineering, and self-improving skills.

---

## 1. The Core Layers, Top to Bottom

Several sources converge on the same layered mental model:

| Layer | Role | Analogy |
|---|---|---|
| Prompt / Instruction | The standing rules and persona | System kernel |
| Context | Live session state, conversation history, retrieved data | RAM |
| Harness | API clients, tool sandboxes, permissions, state storage | Operating system |
| Loop | Local produce → check → correct cycle inside one unit of work | CPU core |
| Graph | Coordination between units: splitting, routing, merging | Motherboard/bus |

The general principle: prompt engineering improves the instruction; harness engineering improves the conditions under which that instruction runs; loop engineering makes one unit of work correct without supervision; graph engineering decides which units of work exist, in what order, and how they connect.

A suggested project structure that maps cleanly onto this model:

```
my_agent_project/
├── harness/        # API clients, tool sandboxes, config
├── prompts/        # System personas, templates
├── context/        # Session state, schemas, vector store
├── skills/         # Atomic tool definitions with strict I/O
├── loops/          # Reflection, ReAct, validators
├── workflows/      # Task blueprints (step order)
├── graph/          # Nodes, edges, state machine
└── orchestrator/   # Entry point: runner, dispatcher, supervisor
```

Execution flow: the orchestrator loads a workflow, builds a graph from it, and dispatches to nodes. Each node pulls from the harness (API access), loads its prompt and context, runs a local loop (possibly calling skills through the harness), then hands its updated context back to the graph, which evaluates routing conditions and moves to the next node.

Rule of thumb: skills (atomic actions) should never call loops; loops call skills. Keeps the system testable and prevents runaway recursion.

---

## 2. Loop Engineering: Making One Unit of Work Correct

A loop has four parts: **produce → check → correct → repeat until green**. The check is what makes it a loop rather than a scheduler — without something capable of failing the work while you're away, you just have automation with no self-correction.

### Writing a real stop/check condition
Conditions must be machine-evaluable, not adjectives:
- Valid: "test suite exits 0," "every claim carries a source line," "40 nodes verified at 2+ sources each."
- Invalid: "the output looks good," "the model is confident," "no errors were raised" (absence of error ≠ evidence of correctness).

A good stop condition also includes hard caps to prevent runaway cost:
- A target count or quality bar to reach ("green")
- A ceiling on passes/attempts with no improvement
- Absolute limits: max agents, max wall-clock time, max retries per unit
- A defined action when a cap is hit (write a record, escalate, exit — don't just stop silently)

### Choosing the first task
Pick work that recurs often (weekly+), verifies quickly (under a minute), and is cheap to get wrong (reversible). Tracking, monitoring, enrichment, and triage tasks qualify. Anything that sends money, publishes publicly, or is otherwise hard to undo does not belong in an early, lightly-supervised loop.

### Moving work out of the prompt
A prompt is a one-off sample of intent; a versioned instruction file (e.g., `SKILL.md`) is the intent itself — reusable and loaded automatically by every agent that touches the task. It should include ordered steps, decision rules for ambiguous cases, and a self-check the agent runs before returning output (e.g., "every field must trace to a source; low-confidence output is flagged, not dropped, not silently omitted").

### The gate must live outside the model
An agent reviewing its own output tends to approve it, because it can always rationalize why it did something a certain way — this is model-agnostic. Order gate checks from cheapest to most expensive:
1. **Deterministic script** — catches schema breaks, missing fields, dead links, count mismatches. Cheap, runs forever for free.
2. **Fresh-context verifier** — a separate call/agent with no memory of producing the work checks for thin evidence, wrong entities, invented relationships.
3. **Threshold rule** — a hard confidence cutoff.
4. **Human queue** — whatever fails twice goes to a person.

### Returning failures correctly
When a unit fails, pass back what specifically failed (not just "retry"), and scope the correction narrowly ("fix this file only") so the agent doesn't expand the fix into unrelated changes. Cap retries (e.g., 2–3); repeated failure past the cap usually means the plan itself is broken, not the execution — escalate rather than retry indefinitely.

**Critical: return the failing unit, not the whole batch.** If 4 items were produced and 1 fails, only resend the 1. Resending all 4 turns one known failure into several new uncertain outcomes, since the "corrected" versions of the 3 good ones aren't guaranteed to still be correct.

### The two failure modes of loops alone
A loop with no coordinating structure around it is just "one very good step in a queue nobody designed" — it can't decide which units of work should exist, their order, or whether two steps could run in parallel. That decision belongs to the graph layer.

---

## 3. Graph Engineering: Coordinating Many Units of Work

A graph is the shape of the work: what runs, what runs concurrently, what waits on what, and how results feed back. It has two components:
- **Node** — one bounded unit of work with one input and one output.
- **Edge** — a real dependency, meaning the next node actually consumes the previous node's output.

**The most common structural mistake**: treating sequence ("do this, then that") as a dependency. If step two doesn't actually read a variable produced by step one, there's no real edge — it's an artificial wait introduced by the order tasks were written down in. Auditing existing pipelines for this is often the single biggest speedup available, since most chains have a couple of unnecessary sequential waits.

### Four kinds of nodes
1. **Splitter** — divides work into units. The most consequential node: splitting along the wrong dimension (e.g., by folder instead of by actual blast radius) causes redundant or overlapping work downstream.
2. **Worker** — executes one unit with one lens, in its own isolated context. Giving multiple parallel workers a shared context collapses their independence — they converge on whatever the first one wrote, and you pay for duplicated opinions instead of independent ones.
3. **Code node** — deterministic transformations (merge, dedupe, rank, diff). If a task can be described without words like "judge," "decide," or "summarize," it should be plain code, not a model call — cheaper, faster, zero variance.
4. **Gate** — accepts or rejects a unit's output before it merges into the shared result.

### Return paths (the part most systems skip)
A graph with no way to send information backward just produces output and forgets — it starts from scratch again next time. Two distinct return paths matter:
- **Correction edge** (short): a gate rejects a single unit back to the step that produced it; fixes the current run only.
- **Learning edge** (long): an *accepted* result becomes a constraint that lands in the splitter's brief, shaping every future run — not just the worker's instructions for one run. This is the one people skip, and skipping it is why some systems stay fast but never get smarter.

### Gating on blast radius, not confidence
Confidence scores are the weakest signal because they're the only one the model itself can influence. A stronger design sorts work into lanes by how expensive a mistake is to undo:
- **Reversible & contained** (e.g., isolated function with test coverage) — open this lane freely; a bad result just gets reverted.
- **Reversible but wide** (e.g., shared utility, schema change) — require deterministic checks plus a clean run history before merging.
- **Hard to reverse** (e.g., migrations, deletions, production writes, financial transfers) — this lane simply doesn't open regardless of score. It's a closed door, not a very high threshold — thresholds get quietly adjusted over time, closed lanes don't.

### Concrete return-path fields
When sending a unit back for correction, include: which unit, the verdict, the specific reason it failed, the evidence for that reason, and an explicit scope limiting what the retry is allowed to touch (otherwise a one-file fix can balloon into an unreviewed multi-file diff).

### Where to put a human
Put a person at the single point of highest consequence and lowest reversibility — typically approving a final merge or choosing which of several candidate fixes ships — rather than reviewing every intermediate step. A human embedded mid-graph becomes the slowest node in it.

---

## 4. Knowledge Graphs for Retrieval (vs. Standard RAG)

Standard similarity-based retrieval finds text that *looks* related but can't surface causal chains that span multiple documents with no shared vocabulary (e.g., a sales drop traced back through five unrelated documents). A knowledge-graph approach stores facts as subject–relation–object triples and lets you query the relationships directly — "walk the path from A to B" instead of "find similar paragraphs."

This distinguishes two retrieval modes:
- **Local search** — pull a node and its immediate neighbors ("what happened with X in July").
- **Global search** — surface patterns across the whole graph ("what recurring pattern shows up across all suppliers"). Similarity search handles the first poorly and the second not at all.

### Eight-layer pipeline
1. **Ingestion** — raw source material, no processing.
2. **Extraction** — pull entities and relationships as structured records, each with a confidence score and a verbatim evidence snippet from the source. Relationships without a source quote should not be inserted — this single rule eliminates most fabricated connections.
3. **Entity resolution** — merge aliases/variant names into one canonical node *before* insertion. Skipping this is the most common failure mode; retrofitting resolution onto an already-polluted graph is much harder than doing it upfront. Similar names alone are not sufficient evidence to merge — require clear proof.
4. **Storage** — a graph database (or a relational store with a graph extension).
5. **Retrieval** — combine multiple methods: fuzzy/vector search, exact entity lookup, path search for connections, community/pattern search, and time-based filtering.
6. **Agent layer** — plans a query strategy, generates graph queries, reads what comes back, and issues follow-up queries if there's a gap.
7. **Verification** — checks that conclusions are actually backed by the retrieved paths, flags contradictions, and distinguishes a causal relationship type from mere co-occurrence.
8. **Update** — write new facts in; flag contradictions for review instead of silently overwriting; timestamp superseded facts rather than deleting them.

The loop closes at step 8 and re-enters at step 2, which is what allows the graph to compound in usefulness over time. Three integration patterns exist between a model and a graph: the graph feeding the model better context, the model building/cleaning the graph, or both happening together — the synergized version is the one worth building, since the other two are just its component halves.

### Common failure modes and fixes
- **Duplicate entities** → resolve aliases as a batch step before insertion, not after.
- **Invented relationships** → require an exact evidence quote for every extracted relation.
- **Queries return nothing or everything** → always pass the literal current schema (not a description of it) into query generation, and validate generated queries against that schema before running them.
- **Confidently wrong answers** → explicitly forbid inferring causation from mere co-occurrence, and require citing the specific relationship type relied on.
- **Runaway cost** → cap traversal depth; most real questions need 2–3 hops, not 6. Rising token cost per query usually means retrieval is too broad, not that a cheaper model is needed.
- **Trust decay over time** → timestamp all facts and run a scheduled maintenance pass, the same way you'd schedule linting for a codebase.

A useful general finding from comparative studies: a well-built graph paired with a smaller model tends to outperform a larger model paired with poor retrieval structure — the retrieval architecture matters more than raw model size. When results are bad, improving the graph structure is often more effective (and cheaper) than upgrading the model.

---

## 5. From Static Pipeline to Dynamic, Scheduled Workflow

Once a graph exists as durable state, later runs can query it instead of running a fixed list every time.

### Dynamic scoping
Instead of hardcoding "process these 40 items," a launch step should query current state: dispatch work to nodes that are unverified, stale (not checked recently), or contradicted with low confidence — capped at a maximum agent count, prioritizing whichever items have the most inbound connections if the query returns more than the cap allows.

### Routing by state instead of one path for everything
| Node state | What runs | Why |
|---|---|---|
| Verified, fresh | Nothing | Already paid for |
| Verified, stale | One lightweight delta check | Cheap, catches drift |
| Thin evidence (1 source) | One targeted source-gathering pass | No need to redo everything |
| Contradicted | Two independent agents from different starting sources | Disagreement needs independent eyes |
| New | Full research pass | Nothing to reuse |

Skipping already-settled work this way is what makes a second run dramatically cheaper than the first.

### Scheduling and triggers
Combine a fixed schedule (a floor — e.g., weekly) with event-based triggers (handles spikes, e.g., "run immediately when a new filing appears"). Match the run frequency to how fast the underlying data actually changes — running a daily check on a monthly-moving dataset is a common way people conclude that automated agents are expensive.

### A living constraints file
Every correction discovered during operation should be written into a permanent, dated rules file rather than left in a chat message that disappears. This file is loaded at the start of every run and is the main mechanism by which the system stops repeating the same mistakes — a few lines in week one can grow into dozens by month three.

### The self-editing review loop
On a recurring cadence, a dedicated agent (with fresh context, not the one that did the work) reads recent run history, looks for failure reasons that recur, items repeatedly escalated to a human, and alias/merge collisions — then proposes edits to the instruction files, schema, alias table, and constraints file as a diff. A human approves or rejects; the agent should never be allowed to write directly to these files itself, since an agent that can edit its own constraints unsupervised will eventually edit away whatever constraint is inconvenient and can justify doing so.

### File ownership convention
Keep one clear author per directory/file (some files are human-authored and load-only for agents; others are agent-written and append-only) so that outputs never silently overwrite inputs, and there's always a durable trail explaining why the current state looks the way it does.

---

## 6. Harness Engineering: The Environment Around the Model

When an agent fails repeatedly, editing the prompt's wording or switching to a bigger model often isn't the fix — the surrounding operating environment (the "harness") frequently is. The same underlying model produces very different results depending on what it's given: dropped into a bare chat box it just answers questions; given terminal access, tests, browser tools, persistent memory, and a review loop, it can ship software. The model's weights didn't change — the harness around it did.

### The seven jobs of a harness
1. **Turn the request into a bounded contract** — explicit goal, inputs, required output shape, constraints, and done-conditions, so the agent can't quietly redefine the task and still claim success.
2. **Give the agent a map, not a manual** — a short root guide pointing to detailed docs (architecture, testing, security, task-specific rules), loaded only when relevant, rather than dumping everything into context at once.
3. **Expose tools with clear contracts** — every tool needs a defined purpose, predictable output, explicit failure behavior, and a permission boundary (e.g., reading files is unrestricted, deploying requires approval).
4. **Externalize memory into durable state** — store decisions, artifacts, failures, and open items outside the conversation itself, so a new session can resume from actual state rather than a lossy conversational summary.
5. **Add sensors before adding autonomy** — tests, linters, screenshots, logs, and schema checks convert vague "does this look right" into actual evidence the harness can evaluate.
6. **Enforce permissions outside the model** — the model can propose an action; a separate policy layer approves or blocks it before a tool executes it. This matters most for expensive, irreversible, or externally-visible actions.
7. **Record traces** — every run should leave a readable log of what context was pulled, which tools were called, what changed, verification results, retries, and cost, so failures become diagnosable rather than mysterious.

### Encode important rules twice
State a rule once as human-readable guidance (explains the "why") and once as a mechanical, unbypassable check (enforces the boundary regardless of whether the agent "remembers" the rule). This turns a past mistake into a permanent property of the system rather than something depending on the model re-reading and honoring a sentence in a prompt every time.

### A disciplined loop structure
A bounded loop needs: a defined artifact-producing step, a separate verification step producing real evidence, a retry cap, and an explicit escalation path (to a human) if the cap is hit — "keep trying until it works" is not itself a control mechanism.

### Convert failures into system upgrades
| Failure type | Fix |
|---|---|
| Missing context | Add a map entry / retrieval rule |
| Wrong tool used | Improve tool description or routing |
| Bad output | Add a validator or stronger contract |
| Repeated loop | Add a retry cap and escalation |
| Unsafe action attempted | Add a permission gate |
| Lost decision | Store it in durable state |
| Unexplained failure | Add tracing/evidence capture |

The immediate fix repairs one run; the systemic fix (updating the map, tool, validator, or policy) improves every future run — this compounding effect is the actual payoff of harness work.

### Separate brain, hands, and history
Keep the reasoning model, the sandbox/tools that act, and the append-only record of what happened as three distinct components. If the sandbox is destroyed, history survives. If the model is swapped, tools and policy remain unaffected and inspectable. If a run is interrupted, a fresh session can reconstruct where things stood from stored artifacts and traces rather than conversation replay.

### A change receipt
For every completed run, keep a compact record of what context sources were used, which policy version applied, which tools were invoked, test results, number of human corrections and retries, cost, the final accepted artifact, and a rollback point. This makes model or policy changes comparable over time, makes regressions traceable to a cause, and prevents a clean final answer from hiding a messy process behind it.

### Scaling harness complexity to the task
Don't build a full platform before the first task exists. Start minimal and add layers only as risk and task duration justify it:
- **Level 0**: prompt + model only
- **Level 1**: add a project guide + tools
- **Level 2**: add structured durable state + tests + a bounded loop
- **Level 3**: add permissions, tracing, recovery, and human approval gates

A short, low-risk task might need only one prompt and one review step; a long autonomous run that can edit files, hit the network, and open a pull request needs the full stack. The harness should be sized to match the failure surface it's meant to control — not bigger, not smaller.

### A pre-deployment checklist
Before trusting an agent with real work, confirm: success is defined up front; the agent can find relevant project knowledge without loading everything; every tool has a clear contract and failure state; execution is isolated from production; key decisions are stored outside the conversation; risky transitions have evidence attached; irreversible actions require approval; every loop has a retry cap and budget; a run can resume after interruption; every tool call and state change is explainable after the fact; and failures result in an update to a guide, test, tool, or policy rather than just being patched once and forgotten.

---

## 7. Multi-Agent Teams (Shared Workspace Model)

An alternative framing treats agents less like isolated tool calls and more like members of a shared team workspace (channels, threads, tasks — similar to a chat platform), where agents have persistent identity and memory rather than being redefined each session.

### Structuring principles
- **One shared workspace per team**, not one per project — splitting into many separate spaces recreates the original problem of fragmented context, since nothing shared crosses between them.
- **Agents run on infrastructure and model subscriptions you already control**, rather than a separate managed cloud layer, so there's no added intermediary between an agent and the model it calls, and no duplicated cost for work already being paid for elsewhere.
- **Mixed engines coexist**: different agents on the same team can run on different underlying model/tooling stacks simultaneously, and an agent's underlying engine can be swapped later without losing its accumulated memory or identity.

### Give agents domains, not tasks
Define each agent by an area of ownership (e.g., "you own research") rather than a single instruction that expires when the request is answered. A useful test: when new relevant work appears, it should be obvious whose responsibility it is — if it's ambiguous, roles overlap and agents will duplicate effort. Point new agents at existing project files and documentation and instruct them to read before acting, and have them persist what they learn so the next run starts from a stronger baseline.

A simple health signal (something like an online/busy/offline/error status) lets you diagnose a stuck agent by checking its state before assuming the instructions need rewriting.

### Work as tasks, not messages
A conversational reply has no persistent state; a task has an owner, a status, and a thread holding the full history of the attempt. Design agents to claim relevant work proactively rather than waiting to be explicitly assigned, and to move finished work to a review state rather than treating completion as automatic permission to ship. The lasting benefit is that reasoning stays attached to the output — someone (human or agent) picking up the thread much later can reconstruct context by reading the history instead of asking the original people involved.

### Explicit handoffs and self-scheduling
Name, in each agent's own instructions, exactly who the next owner of its output is. An agent that isn't told who to hand off to will default to routing everything back to the human, quietly recreating manual context-relaying inside a nicer interface. Agents can also be told to set their own recurring check-ins (e.g., "sweep every Monday and post results"), so routine monitoring happens without a human remembering to trigger it.

### Peer review inside the team
Because agents share threads, one can be assigned a standing reviewer role, checking others' output before it reaches a human and sending it back with specifics if it fails. Two conditions keep this useful: the reviewer must not be the same agent that produced the work, and it should be given a concrete rejection rubric ("reject if X, Y, or Z") rather than a vague quality bar — a reviewer told what specifically disqualifies work returns actionable findings, one told to vaguely "check quality" tends to rubber-stamp.

### Cross-team collaboration without merging workspaces
A narrow, purpose-built shared channel can connect a small number of separate teams' workspaces at exactly one point, without either side gaining access to the other's full space. Only content deliberately posted into that shared channel — messages, files, and the specific agents/people each side chooses to add — crosses the boundary; everything else in each team's own workspace stays private. Critically, an agent present in that shared channel can still return to its own private workspace to get additional help from its own team's other agents/humans, then come back and respond in the shared room — effectively letting an external party get a whole team's depth through a single point of contact, without anyone being pulled in ad hoc or given broader access than intended.

---

## 8. Self-Healing Agents

A basic version of resilience: rather than stopping at the first dead end, an agent should recognize a failure and attempt an alternative approach.

Four practical steps:
1. **Check its own work after each step** — verify the actual result matches what was expected, rather than assuming success and continuing.
2. **Name the specific failure type** — a timeout, an error response, an empty result, and a wrong-but-valid-looking answer are different problems requiring different fixes; the agent needs the actual error surfaced to it, not just a generic "it failed."
3. **Match the response to the failure type** — a transient glitch warrants a retry; a downed tool warrants switching to a fallback; a persistently failing task warrants breaking it into smaller pieces; anything touching money or destructive/irreversible actions warrants stopping and asking a human, never auto-resolving.
4. **Log every fix that worked** — prevents repeating the same failed approach within a session and builds a record of recurring root causes worth fixing permanently.

This overlaps directly with the harness-engineering failure table in Section 6 and the graph-level correction/learning edges in Section 3 — "self-healing" at the single-agent level is the same principle as the correction edge; logging fixes for later root-cause work is the same principle as the learning edge.

---

## 9. Self-Improving Skills

Instruction files (skill definitions) tend to be treated as static, but the environment they operate in — codebases, model behavior, the kinds of tasks being asked — keeps shifting, so a skill that worked initially can silently degrade with no obvious signal until output quality is visibly worse.

### A closed improvement loop for skill files
1. **Structure skill definitions richly** — beyond just storing an instruction file, attach semantic metadata: task patterns it applies to, summaries, and relationships to other skills, so selection/routing between skills can be more informed than plain keyword matching.
2. **Observe every execution** — record what task was attempted, which skill handled it, whether it succeeded, what error (if any) occurred, and any user feedback. Without this record, there's nothing to reason about when something underperforms.
3. **Inspect on accumulated failure** — once enough failed runs (or one significant one) build up, trace the connected history for that skill — past runs, feedback, related failures — to find the recurring factor behind bad outcomes.
4. **Propose a targeted amendment** — based on that evidence, suggest a specific change: tightening a trigger condition, adding a missing precondition, reordering steps, or changing the expected output format. This can be routed to a human for approval or (in more mature setups) applied automatically.
5. **Evaluate before keeping the change** — never trust a self-modification just because it was made. Measure whether the amended version actually reduces failures and doesn't introduce new ones elsewhere. If it doesn't measurably help, roll it back. Because every change is logged with its rationale and outcome, the original version is never lost, and the whole process stays auditable rather than being uncontrolled self-modification.

The overall discipline is: **observe → inspect → amend → evaluate**, not just "observe → inspect → amend" — evaluation is what keeps this from becoming an ungoverned self-editing system, echoing the same human-approval principle used for the graph-level weekly review loop in Section 5.

---

## 10. How the Pieces Fit Together

Reading across all seven frameworks, a few unifying threads repeat regardless of which vocabulary a given source uses:

- **Verification must come from outside the thing being verified.** A model checking its own work, an agent approving its own merge, or a skill judging its own performance all fail for the same structural reason — self-assessment is biased toward self-approval. Every framework here inserts an external check: a deterministic gate, a fresh-context reviewer, a separate evaluator agent, or a human approval step.
- **Corrections should be scoped narrowly and returned with reasons.** Whether it's a graph's return path, a self-healing agent's error type, or a skill amendment, the fix works better when it's targeted (this unit, this file, this precondition) rather than reopening everything.
- **Two timescales of improvement always exist**: a short-lived correction that fixes the current run, and a durable change (a constraint file entry, a learning edge, a skill amendment, a harness policy update) that prevents the same failure in every future run. Systems that only do the first stay reliable but never get cheaper or smarter over time.
- **Autonomy should be gated by consequence, not confidence.** Reversible, low-stakes actions can run with minimal oversight; irreversible or high-stakes ones require a human regardless of how "confident" the system reports being.
- **State needs to live outside the conversation.** Durable, inspectable records (run logs, change receipts, graph constraint files, skill observation logs) are what let a system resume, be audited, and improve — a conversation transcript alone is not a system of record.

Building any one of these layers in isolation produces a partial system: a well-checked single agent with no coordination between tasks, or a well-coordinated graph full of unverified work, or a self-modifying skill set with no evaluation gate. The frameworks above are strongest when combined — a harness supplying tools, state, and permissions; loops making each unit of work correct; a graph deciding what work exists and routing it; and a review layer (human-approved) turning accumulated failures into permanent constraints across the whole system.
